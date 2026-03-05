const log = require('../logger');
const { executeTask } = require('./executor');
const path = require('node:path');
const fs = require('node:fs');

const POLL_INTERVAL_NORMAL_MS = 3000;
const POLL_INTERVAL_DIRECT_MS = 1000;
let pollTimer = null;
let convex = null;
let behaviorEngineRef = null;
const projectLocks = new Map(); // projectPath → boolean

function buildPrompt(task) {
	const prompt = task.enrichedPrompt || task.rawPrompt;
	const projectPath = task.projectPath;

	let context = '';
	const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
	if (fs.existsSync(claudeMdPath)) {
		try {
			context += `Project instructions (CLAUDE.md):\n${fs.readFileSync(claudeMdPath, 'utf8').substring(0, 3000)}\n\n`;
		} catch {}
	}
	const pkgPath = path.join(projectPath, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			context += `Project: ${pkg.name || 'unknown'} — ${pkg.description || ''}\n\n`;
		} catch {}
	}

	return `Working directory: ${projectPath}\n${context}\nTask:\n${prompt}\n\nInstructions: Work autonomously. Edit files directly. Run lint/typecheck after changes. Do not ask questions — make reasonable decisions and proceed.`;
}

async function poll() {
	if (!convex) return;

	try {
		const result = await convex.getQueuedTasks();
		if (!result.ok || !result.value?.length) return;

		for (const task of result.value) {
			const projectPath = task.projectPath;

			// Skip if this project already has a running task
			if (projectLocks.get(projectPath)) continue;

			// Claim the task
			projectLocks.set(projectPath, true);
			log.info('TaskQueue', `Claiming task ${task._id} for ${projectPath}`);

			// Set running
			await convex.updateQueueTask(task._id, { status: 'running', updatedAt: Date.now() });

			// Execute in background (don't block the poll loop)
			(async () => {
				try {
					const prompt = buildPrompt(task);
					const result = await executeTask(task._id, prompt, projectPath, (line) => {
						log.info('TaskQueue', `[${task._id}] ${line.substring(0, 100)}`);
					});

					await convex.updateQueueTask(task._id, {
						status: result.status || 'done',
						result: result.summary || '',
						updatedAt: Date.now(),
					});
				} catch (err) {
					log.error('TaskQueue', `Task ${task._id} failed: ${err.message}`);
					await convex.updateQueueTask(task._id, {
						status: 'failed',
						errorMessage: err.message,
						updatedAt: Date.now(),
					}).catch(() => {});
				} finally {
					projectLocks.set(projectPath, false);
				}
			})();
		}
	} catch (err) {
		log.error('TaskQueue', `Poll error: ${err.message}`);
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
	pollTimer = setInterval(poll, getCurrentPollInterval());
}

function restartWithNewInterval() {
	if (!convex) return;
	if (pollTimer) clearInterval(pollTimer);
	const interval = getCurrentPollInterval();
	log.info('TaskQueue', `Watcher restarted with poll interval: ${interval}ms`);
	pollTimer = setInterval(poll, interval);
}

function stop() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	log.info('TaskQueue', 'Watcher stopped');
}

module.exports = { start, stop, restartWithNewInterval };
