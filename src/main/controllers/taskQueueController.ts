import { ipcMain } from 'electron';
import * as log from '../logger';
import * as avatarWindow from '../windows/avatar-window';

const TQ_CHANNELS = {
	CREATE_TASK: 'tq:create-task',
	APPROVE_TASK: 'tq:approve-task',
	CANCEL_TASK: 'tq:cancel-task',
	DETECT_PATH: 'tq:detect-path',
	GET_ALL: 'tq:get-all',
	GET_BY_PROJECT: 'tq:get-by-project',
	TASK_UPDATE: 'tq:task-update',
	COUNTDOWN_STATE: 'tq:countdown-state',
};

// Countdown timers by task ID
const countdowns = new Map<string, { timer: ReturnType<typeof setInterval>; remaining: number }>();

function broadcastCountdown(taskId: string, remaining: number) {
	const win = avatarWindow.get();
	if (win) win.webContents.send(TQ_CHANNELS.COUNTDOWN_STATE, { taskId, remaining });
}

function broadcastTaskUpdate(update: any) {
	const win = avatarWindow.get();
	if (win) win.webContents.send(TQ_CHANNELS.TASK_UPDATE, update);
}

let convexClient: any = null;

export function setConvexClient(client: any) {
	convexClient = client;
}

export function register() {
	// Create a new task: detect path, create draft, enrich, start countdown
	ipcMain.handle(TQ_CHANNELS.CREATE_TASK, async (_, rawPrompt: string, projectPathOverride?: string) => {
		try {
			let projectPath = projectPathOverride;

			if (!projectPath) {
				const { detectHoveredPath } = require('../task-queue/path-detector');
				const detection = await detectHoveredPath();
				if (!detection.ok) {
					return { ok: false, error: detection.error || 'Could not detect project path' };
				}
				projectPath = detection.projectPath;
			}

			if (!convexClient) {
				return { ok: false, error: 'Convex client not initialized' };
			}

			// Create draft task in Convex
			const idempotencyKey = `tq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			const result = await convexClient.createQueueTask({
				projectPath,
				rawPrompt,
				status: 'draft',
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}, idempotencyKey);

			if (!result.ok) {
				return { ok: false, error: result.error || 'Failed to create task' };
			}

			const taskId = result.value;

			// Start enrichment async
			(async () => {
				try {
					const { enrichPrompt } = require('../task-queue/enricher');
					const enriched = await enrichPrompt(rawPrompt, projectPath!);
					await convexClient.updateQueueTask(taskId, {
						enrichedPrompt: enriched.enrichedPrompt,
						impactedFiles: enriched.impactedFiles,
						complexity: enriched.complexity,
						updatedAt: Date.now(),
					});
					broadcastTaskUpdate({ taskId, enriched: true, ...enriched });
					log.info('TaskQueue', `Enriched task ${taskId}: ${enriched.complexity}`);
				} catch (err: any) {
					log.warn('TaskQueue', `Enrichment failed for ${taskId}: ${err.message}`);
				}

				// Start countdown after enrichment (or enrichment failure)
				startCountdown(taskId);
			})();

			return { ok: true, taskId, projectPath };
		} catch (err: any) {
			log.error('TaskQueue', `Create task error: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Approve task immediately (skip countdown)
	ipcMain.handle(TQ_CHANNELS.APPROVE_TASK, async (_, taskId: string) => {
		clearCountdown(taskId);
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		const result = await convexClient.updateQueueTask(taskId, { status: 'queued', updatedAt: Date.now() });
		broadcastTaskUpdate({ taskId, status: 'queued' });
		return { ok: result.ok };
	});

	// Cancel task
	ipcMain.handle(TQ_CHANNELS.CANCEL_TASK, async (_, taskId: string) => {
		clearCountdown(taskId);
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		const result = await convexClient.updateQueueTask(taskId, { status: 'failed', errorMessage: 'Cancelled by user', updatedAt: Date.now() });
		broadcastTaskUpdate({ taskId, status: 'failed' });
		return { ok: result.ok };
	});

	// Detect hovered path
	ipcMain.handle(TQ_CHANNELS.DETECT_PATH, async () => {
		const { detectHoveredPath } = require('../task-queue/path-detector');
		return detectHoveredPath();
	});

	// Get all tasks
	ipcMain.handle(TQ_CHANNELS.GET_ALL, async () => {
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		return convexClient.getAllQueueTasks();
	});

	// Get by project
	ipcMain.handle(TQ_CHANNELS.GET_BY_PROJECT, async (_, projectPath: string) => {
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		return convexClient.getQueueTasksByProject(projectPath);
	});
}

function startCountdown(taskId: string) {
	clearCountdown(taskId);
	let remaining = 10;

	const timer = setInterval(async () => {
		remaining--;
		broadcastCountdown(taskId, remaining);

		if (remaining <= 0) {
			clearCountdown(taskId);
			// Auto-approve
			if (convexClient) {
				await convexClient.updateQueueTask(taskId, { status: 'queued', updatedAt: Date.now() });
				broadcastTaskUpdate({ taskId, status: 'queued' });
				log.info('TaskQueue', `Auto-approved task ${taskId}`);
			}
		}
	}, 1000);

	countdowns.set(taskId, { timer, remaining });
}

function clearCountdown(taskId: string) {
	const cd = countdowns.get(taskId);
	if (cd) {
		clearInterval(cd.timer);
		countdowns.delete(taskId);
	}
}

export { TQ_CHANNELS };
