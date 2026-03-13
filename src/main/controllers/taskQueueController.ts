import { ipcMain } from 'electron';
import * as log from '../logger';
const taskQueueService = require('../task-queue/service');

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

export function setConvexClient(client: any) {
	taskQueueService.setConvexClient(client);
}

export function setBehaviorEngine(engine: any) {
	taskQueueService.setBehaviorEngine(engine);
}

export function register() {
	// Create a new task: detect path, create draft, enrich, start countdown
	ipcMain.handle(TQ_CHANNELS.CREATE_TASK, async (_, rawPrompt: string, projectPathOverride?: string) => {
		try {
			const created = await taskQueueService.createQueuedTask({
				rawPrompt,
				projectPath: projectPathOverride,
				origin: 'ipc:create-task',
				resolveProjectPath: async () => {
					const { detectHoveredPath } = require('../task-queue/path-detector');
					const detection = await detectHoveredPath();
					if (!detection.ok) {
						throw new Error(detection.error || 'Could not detect project path');
					}
					return detection.projectPath;
				},
			});
			return { ok: true, taskId: created.taskId, projectPath: created.projectPath };
		} catch (err: any) {
			log.error('TaskQueue', `Create task error: ${err.message}`);
			return { ok: false, error: err.message };
		}
	});

	// Approve task immediately (skip countdown)
	ipcMain.handle(TQ_CHANNELS.APPROVE_TASK, async (_, taskId: string) => {
		return taskQueueService.approveQueuedTask(taskId);
	});

	// Cancel task
	ipcMain.handle(TQ_CHANNELS.CANCEL_TASK, async (_, taskId: string) => {
		return taskQueueService.cancelQueuedTask(taskId);
	});

	// Detect hovered path
	ipcMain.handle(TQ_CHANNELS.DETECT_PATH, async () => {
		const { detectHoveredPath } = require('../task-queue/path-detector');
		return detectHoveredPath();
	});

	// Get all tasks
	ipcMain.handle(TQ_CHANNELS.GET_ALL, async () => {
		const convexClient = taskQueueService.getConvexClient();
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		return convexClient.getAllQueueTasks();
	});

	// Get by project
	ipcMain.handle(TQ_CHANNELS.GET_BY_PROJECT, async (_, projectPath: string) => {
		const convexClient = taskQueueService.getConvexClient();
		if (!convexClient) return { ok: false, error: 'No Convex client' };
		return convexClient.getQueueTasksByProject(projectPath);
	});
}

export { TQ_CHANNELS };
