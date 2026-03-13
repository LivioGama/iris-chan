const log = require('../logger');
const avatarWindow = require('../windows/avatar-window');
const kanbanWindow = require('../windows/kanban-window');

const DEFAULT_COUNTDOWN_SECONDS = 10;
const DEFAULT_COUNTDOWN_TICK_MS = 1000;
const QUEUE_TASK_FIELDS = new Set([
	'projectPath',
	'rawPrompt',
	'enrichedPrompt',
	'impactedFiles',
	'complexity',
	'status',
	'origin',
	'launchMode',
	'resumable',
	'resumeCount',
	'dependencyState',
	'dependencies',
	'inferredDependencies',
	'blockedBy',
	'startedAt',
	'resumedAt',
	'result',
	'errorMessage',
	'createdAt',
	'updatedAt',
]);

let convexClient = null;
let behaviorEngineRef = null;
const countdowns = new Map();

function setConvexClient(client) {
	convexClient = client;
}

function setBehaviorEngine(engine) {
	behaviorEngineRef = engine;
}

function getConvexClient() {
	return convexClient;
}

function getBehaviorEngine() {
	return behaviorEngineRef;
}

function sanitizeQueueTaskFields(record = {}) {
	return Object.fromEntries(
		Object.entries(record).filter(([key, value]) => QUEUE_TASK_FIELDS.has(key) && value !== undefined)
	);
}

function getBroadcastTargets() {
	return [avatarWindow.get(), kanbanWindow.get()].filter((win, index, all) => {
		return Boolean(win) && all.findIndex((candidate) => candidate?.webContents?.id === win?.webContents?.id) === index;
	});
}

function broadcastTaskUpdate(update) {
	getBroadcastTargets().forEach((win) => {
		if (win && !win.isDestroyed()) {
			win.webContents.send('tq:task-update', update);
		}
	});
}

function broadcastCountdown(taskId, remaining) {
	getBroadcastTargets().forEach((win) => {
		if (win && !win.isDestroyed()) {
			win.webContents.send('tq:countdown-state', { taskId, remaining });
		}
	});
}

function clearCountdown(taskId) {
	const cd = countdowns.get(taskId);
	if (cd) {
		clearInterval(cd.timer);
		countdowns.delete(taskId);
	}
}

async function approveQueuedTask(taskId, patch = {}) {
	clearCountdown(taskId);
	if (!convexClient) return { ok: false, error: 'No Convex client' };
	const result = await convexClient.updateQueueTask(taskId, {
		status: 'queued',
		dependencyState: 'ready',
		updatedAt: Date.now(),
		...patch,
	});
	broadcastTaskUpdate({ taskId, status: 'queued', dependencyState: 'ready', ...patch });
	return { ok: result.ok };
}

async function cancelQueuedTask(taskId, reason = 'Cancelled by user') {
	clearCountdown(taskId);
	if (!convexClient) return { ok: false, error: 'No Convex client' };
	const result = await convexClient.updateQueueTask(taskId, {
		status: 'cancelled',
		errorMessage: reason,
		updatedAt: Date.now(),
	});
	broadcastTaskUpdate({ taskId, status: 'cancelled', errorMessage: reason });
	return { ok: result.ok };
}

async function resolveProjectPath({ projectPath, resolveProjectPath: resolver }) {
	if (projectPath) return projectPath;
	if (typeof resolver === 'function') {
		const resolved = await resolver();
		if (resolved) return resolved;
	}
	throw new Error('Could not resolve project path');
}

function startCountdown(taskId, options = {}) {
	clearCountdown(taskId);
	let remaining = Number(options.countdownSeconds || DEFAULT_COUNTDOWN_SECONDS);
	const tickMs = Number(options.countdownTickMs || DEFAULT_COUNTDOWN_TICK_MS);

	const timer = setInterval(async () => {
		remaining--;
		broadcastCountdown(taskId, remaining);

		if (remaining <= 0) {
			clearCountdown(taskId);
			if (!convexClient) return;
			try {
				const allTasks = await convexClient.getAllQueueTasks();
				const current = allTasks.ok && allTasks.value?.find((task) => String(task._id) === String(taskId));
				if (current && current.status === 'draft') {
					await approveQueuedTask(taskId);
					log.info('TaskQueue', `Auto-approved task ${taskId}`);
				} else {
					log.info('TaskQueue', `Skipped auto-approve for ${taskId} (status: ${current?.status || 'not found'})`);
				}
			} catch (err) {
				log.warn('TaskQueue', `Auto-approve check failed for ${taskId}: ${err.message}`);
			}
		}
	}, tickMs);

	countdowns.set(taskId, { timer, remaining });
}

async function createQueuedTask(options) {
	const {
		rawPrompt,
		projectPath,
		resolveProjectPath: resolver,
		origin,
		dependencies = [],
		extraTaskFields = {},
		buildEnrichmentPatch,
		countdownSeconds,
		countdownTickMs,
	} = options || {};

	if (!convexClient) {
		throw new Error('Convex client not initialized');
	}

	const resolvedPath = await resolveProjectPath({ projectPath, resolveProjectPath: resolver });
	const createdAt = Date.now();
	const taskRecord = {
		projectPath: resolvedPath,
		rawPrompt,
		status: 'draft',
		origin,
		launchMode: 'queued',
		resumable: true,
		resumeCount: 0,
		dependencyState: 'pending',
		dependencies: Array.isArray(dependencies) ? dependencies.filter(Boolean) : [],
		inferredDependencies: [],
		blockedBy: [],
		createdAt,
		updatedAt: createdAt,
		...extraTaskFields,
	};
	const persistedTaskRecord = sanitizeQueueTaskFields(taskRecord);
	const idempotencyKey = `tq_${createdAt}_${Math.random().toString(36).slice(2, 8)}`;
	const result = await convexClient.createQueueTask(persistedTaskRecord, idempotencyKey);

	if (!result.ok) {
		throw new Error(result.error || 'Failed to create task');
	}

	const taskId = result.value;
	broadcastTaskUpdate({
		taskId,
		created: true,
		status: 'draft',
		task: {
			_id: taskId,
			...persistedTaskRecord,
		},
	});

	const isDirectMode = behaviorEngineRef?.getDirectMode?.() ?? false;

	(async () => {
		try {
			const { enrichPrompt } = require('../task-queue/enricher');
			const enriched = await enrichPrompt(rawPrompt, resolvedPath);
			const enrichmentPatch = sanitizeQueueTaskFields({
				enrichedPrompt: enriched.enrichedPrompt,
				impactedFiles: enriched.impactedFiles,
				complexity: enriched.complexity,
				dependencyState: 'ready',
				updatedAt: Date.now(),
				...(typeof buildEnrichmentPatch === 'function' ? buildEnrichmentPatch(enriched) : {}),
			});
			await convexClient.updateQueueTask(taskId, enrichmentPatch);
			broadcastTaskUpdate({
				taskId,
				enriched: true,
				...enrichmentPatch,
			});
			log.info('TaskQueue', `Enriched task ${taskId}: ${enriched.complexity}`);
		} catch (err) {
			log.warn('TaskQueue', `Enrichment failed for ${taskId}: ${err.message}`);
		}

		if (isDirectMode) {
			log.info('TaskQueue', `Direct mode: auto-queuing task ${taskId} (no countdown)`);
			await approveQueuedTask(taskId);
		} else {
			startCountdown(taskId, { countdownSeconds, countdownTickMs });
		}
	})().catch((err) => {
		log.warn('TaskQueue', `Background task flow failed for ${taskId}: ${err.message}`);
	});

	return { taskId, projectPath: resolvedPath };
}

module.exports = {
	setConvexClient,
	setBehaviorEngine,
	getConvexClient,
	getBehaviorEngine,
	broadcastTaskUpdate,
	broadcastCountdown,
	createQueuedTask,
	approveQueuedTask,
	cancelQueuedTask,
	clearCountdown,
	startCountdown,
};
