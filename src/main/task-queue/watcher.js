const log = require('../logger');
const { executeTask } = require('./executor');
const { buildCodingPrompt } = require('../coding/prompt');
const avatarWindow = require('../windows/avatar-window');
const kanbanWindow = require('../windows/kanban-window');
const {
	READY_STATUSES,
	classifyDependencyState,
	getTaskIdentifier,
	inferDependencies,
} = require('./dependency-manager');

const POLL_INTERVAL_NORMAL_MS = 3000;
const POLL_INTERVAL_DIRECT_MS = 1000;

let pollTimer = null;
let convex = null;
let behaviorEngineRef = null;
let polling = false;
const activeTaskIds = new Set();

function broadcastTaskUpdate(update) {
	const seen = new Set();
	[avatarWindow.get(), kanbanWindow.get()].forEach((win) => {
		if (!win || win.isDestroyed()) return;
		const webContentsId = win.webContents?.id;
		if (seen.has(webContentsId)) return;
		seen.add(webContentsId);
		win.webContents.send('tq:task-update', update);
	});
}

function buildPrompt(task) {
	return buildCodingPrompt({
		description: task.enrichedPrompt || task.rawPrompt,
		cwd: task.projectPath,
	});
}

function isTerminalStatus(status = '') {
	return ['completed', 'failed', 'cancelled'].includes(String(status).toLowerCase());
}

async function syncDependencyStates(tasks = []) {
	const taskMap = new Map(tasks.map((task) => [getTaskIdentifier(task), task]));
	for (const task of tasks) {
		const taskId = getTaskIdentifier(task);
		const status = String(task.status || '').toLowerCase();
		if (!taskId || status === 'draft' || isTerminalStatus(status)) continue;

		const inferredDependencies = inferDependencies(task, tasks);
		const normalizedTask = {
			...task,
			inferredDependencies,
		};
		const { blockedBy, dependencyState } = classifyDependencyState(normalizedTask, taskMap);
		const shouldBlock = blockedBy.length > 0;
		const nextStatus = shouldBlock ? 'blocked' : (status === 'blocked' ? 'queued' : status);
		const statusChanged = nextStatus !== status;
		const dependenciesChanged = JSON.stringify(task.inferredDependencies || []) !== JSON.stringify(inferredDependencies)
			|| JSON.stringify(task.blockedBy || []) !== JSON.stringify(blockedBy)
			|| String(task.dependencyState || '') !== dependencyState;
		if (!statusChanged && !dependenciesChanged) continue;

		await convex.updateQueueTask(task._id, {
			status: nextStatus,
			inferredDependencies,
			blockedBy,
			dependencyState,
			updatedAt: Date.now(),
		});
			task.status = nextStatus;
			task.inferredDependencies = inferredDependencies;
			task.blockedBy = blockedBy;
			task.dependencyState = dependencyState;
			broadcastTaskUpdate({
				taskId,
				status: nextStatus,
				inferredDependencies,
				blockedBy,
				dependencyState,
			});
			log.info('TaskQueue', `Updated dependency state for ${taskId}: ${nextStatus} (${blockedBy.length} blockers)`);
	}
}

async function dispatchRunnableTasks(tasks = []) {
	const runnable = tasks.filter((task) => {
		const taskId = getTaskIdentifier(task);
		const status = String(task.status || '').toLowerCase();
		return taskId
			&& READY_STATUSES.has(status)
			&& !activeTaskIds.has(taskId)
			&& String(task.dependencyState || 'ready') === 'ready';
	});

	for (const task of runnable) {
		const taskId = getTaskIdentifier(task);
		const currentStatus = String(task.status || '').toLowerCase();
		const claim = await convex.claimQueueTask(task._id, [currentStatus], {
			status: 'running',
			startedAt: task.startedAt || Date.now(),
			resumedAt: currentStatus === 'resuming' ? Date.now() : undefined,
			updatedAt: Date.now(),
		});
			if (!claim.ok || claim.value?.ok === false) continue;

			activeTaskIds.add(taskId);
			broadcastTaskUpdate({
				taskId,
				status: 'running',
				startedAt: task.startedAt || Date.now(),
			});
			log.info('TaskQueue', `Dispatching task ${taskId} (${currentStatus}) for ${task.projectPath}`);

		(async () => {
			try {
				const prompt = buildPrompt(task);
				const result = await executeTask(taskId, prompt, task.projectPath, (line) => {
					log.info('TaskQueue', `[${taskId}] ${line.substring(0, 100)}`);
				});
					await convex.updateQueueTask(task._id, {
						status: (result.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
						result: result.summary || '',
						dependencyState: 'ready',
						updatedAt: Date.now(),
					});
					broadcastTaskUpdate({
						taskId,
						status: (result.status || '').toUpperCase() === 'COMPLETED' ? 'completed' : 'failed',
						result: result.summary || '',
						dependencyState: 'ready',
					});
				} catch (err) {
					log.error('TaskQueue', `Task ${taskId} failed: ${err.message}`);
					await convex.updateQueueTask(task._id, {
						status: 'failed',
						errorMessage: err.message,
						dependencyState: 'ready',
						updatedAt: Date.now(),
					}).catch(() => {});
					broadcastTaskUpdate({
						taskId,
						status: 'failed',
						errorMessage: err.message,
						dependencyState: 'ready',
					});
				} finally {
					activeTaskIds.delete(taskId);
				}
		})();
	}
}

async function recoverInterruptedTasks() {
	const result = await convex.getAllQueueTasks();
	if (!result.ok || !Array.isArray(result.value)) return;
	const interrupted = result.value.filter((task) => String(task.status || '').toLowerCase() === 'running' && task.resumable !== false);
	for (const task of interrupted) {
		const taskId = getTaskIdentifier(task);
		await convex.updateQueueTask(task._id, {
			status: 'resuming',
			resumeCount: Number(task.resumeCount || 0) + 1,
			updatedAt: Date.now(),
		});
		broadcastTaskUpdate({
			taskId,
			status: 'resuming',
			resumeCount: Number(task.resumeCount || 0) + 1,
		});
	}
	if (interrupted.length) {
		log.info('TaskQueue', `Recovered ${interrupted.length} interrupted queued task(s)`);
	}
}

async function poll() {
	if (!convex || polling) return;
	polling = true;
	try {
		const result = await convex.getAllQueueTasks();
		if (!result.ok || !Array.isArray(result.value) || result.value.length === 0) return;
		const tasks = result.value;
		await syncDependencyStates(tasks);
		await dispatchRunnableTasks(tasks);
	} catch (err) {
		log.error('TaskQueue', `Poll error: ${err.message}`);
	} finally {
		polling = false;
	}
}

function getCurrentPollInterval() {
	const isDirect = behaviorEngineRef?.getDirectMode?.() ?? false;
	return isDirect ? POLL_INTERVAL_DIRECT_MS : POLL_INTERVAL_NORMAL_MS;
}

function start(convexClient, behaviorEngine) {
	convex = convexClient;
	behaviorEngineRef = behaviorEngine || null;
	log.info('TaskQueue', `Watcher started (poll interval: ${getCurrentPollInterval()}ms)`);
	recoverInterruptedTasks().catch((err) => {
		log.warn('TaskQueue', `Recovery failed: ${err.message}`);
	});
	pollTimer = setInterval(poll, getCurrentPollInterval());
	setTimeout(() => poll(), 0);
}

function restartWithNewInterval() {
	if (!convex) return;
	if (pollTimer) clearInterval(pollTimer);
	const interval = getCurrentPollInterval();
	log.info('TaskQueue', `Watcher restarted with poll interval: ${interval}ms`);
	pollTimer = setInterval(poll, interval);
	setTimeout(() => poll(), 0);
}

function stop() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	activeTaskIds.clear();
	log.info('TaskQueue', 'Watcher stopped');
}

module.exports = { start, stop, restartWithNewInterval };
