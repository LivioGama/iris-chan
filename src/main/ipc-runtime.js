const { ipcMain } = require('electron');
const { RUNTIME_CHANNELS } = require('../shared/ipc-contracts.js');
const geometryStore = require('./runtime/geometry-store');
const avatarWindow = require('./windows/avatar-window');
const taskQueueWatcher = require('./task-queue/watcher');
const settings = require('./settings');

function registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, uiTaskService, convexClient, dailyLoop, kanbanWindow }) {
	const subscriptions = new Map();

	ipcMain.handle(RUNTIME_CHANNELS.RUNTIME_GET_HEALTH, async () => healthService.getHealth());

	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_GET_MODE, () => behaviorEngine.getMode());
	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_SET_MODE, (_, mode) => {
		const result = settings.updateSettings({ behavior: { mode } }, { source: 'ipc:behavior:set-mode' });
		const win = avatarWindow.get();
		if (result?.ok && win && !win.isDestroyed()) {
			win.webContents.send('mode-changed', settings.getNamespace('behavior')?.mode || mode);
		}
		return { ok: true, mode: settings.getNamespace('behavior')?.mode || mode, restartRequired: result.restartRequired };
	});

	ipcMain.handle(RUNTIME_CHANNELS.EVENTS_SUBSCRIBE, (evt) => {
		const webContentsId = evt.sender.id;
		if (subscriptions.has(webContentsId)) return { ok: true };
		const listener = (runtimeEvent) => {
			if (runtimeEvent?.source === 'benchmark' || runtimeEvent?.type === '__IRIS_BENCHMARK_PING__') return;
			evt.sender.send(RUNTIME_CHANNELS.EVENTS_STREAM, runtimeEvent);
		};
		eventBus.on('event', listener);
		subscriptions.set(webContentsId, listener);
		evt.sender.once('destroyed', () => {
			const stale = subscriptions.get(webContentsId);
			if (!stale) return;
			eventBus.off('event', stale);
			subscriptions.delete(webContentsId);
		});
		return { ok: true };
	});

	ipcMain.handle(RUNTIME_CHANNELS.EVENTS_UNSUBSCRIBE, (evt) => {
		const webContentsId = evt.sender.id;
		const listener = subscriptions.get(webContentsId);
		if (!listener) return { ok: true };
		eventBus.off('event', listener);
		subscriptions.delete(webContentsId);
		return { ok: true };
	});

	ipcMain.handle(RUNTIME_CHANNELS.TASKS_RUN, (_, taskId, payload) => taskEngine.runTask(taskId, payload));
	ipcMain.handle(RUNTIME_CHANNELS.TASKS_STOP, (_, taskId) => taskEngine.stopTask(taskId));
	ipcMain.handle(RUNTIME_CHANNELS.TASKS_STREAM, () => ({ ok: true, channel: RUNTIME_CHANNELS.TASKS_STREAM }));
	ipcMain.handle(RUNTIME_CHANNELS.UI_TASK_RUN, (_, goal, opts = {}) => uiTaskService.runTask({ goal, ...(opts || {}) }));
	ipcMain.handle(RUNTIME_CHANNELS.UI_TASK_STOP, (_, reason) => uiTaskService.stopActiveTask(reason));
	ipcMain.handle(RUNTIME_CHANNELS.UI_STATE_GET, () => uiTaskService.getState());

	taskEngine.subscribeStream((data) => {
		const kWin = kanbanWindow.get();
		if (kWin && !kWin.isDestroyed()) {
			kWin.webContents.send(RUNTIME_CHANNELS.TASKS_STREAM, data);
		}
		const aWin = avatarWindow.get();
		if (aWin && !aWin.isDestroyed()) {
			aWin.webContents.send(RUNTIME_CHANNELS.TASKS_STREAM, data);
		}
	});

	uiTaskService.subscribeStream((data) => {
		const kWin = kanbanWindow.get();
		if (kWin && !kWin.isDestroyed()) {
			kWin.webContents.send(RUNTIME_CHANNELS.UI_TASK_STREAM, data);
		}
		const aWin = avatarWindow.get();
		if (aWin && !aWin.isDestroyed()) {
			aWin.webContents.send(RUNTIME_CHANNELS.UI_TASK_STREAM, data);
		}
	});

	ipcMain.handle(RUNTIME_CHANNELS.HISTORY_VERIFY_IMPORT, async () => convexClient.verifyHistoryImport());

	ipcMain.handle(RUNTIME_CHANNELS.WINDOW_GET_GEOMETRY, (_, windowId) => geometryStore.getGeometry(windowId));
	ipcMain.handle(RUNTIME_CHANNELS.WINDOW_SET_GEOMETRY, (_, windowId, bounds) => geometryStore.setGeometry(windowId, bounds));

	ipcMain.handle(RUNTIME_CHANNELS.BLOG_CREATE_DAILY_DRAFT, async () => {
		await dailyLoop.tick();
		return { ok: true };
	});

	// Direct mode: get/set
	ipcMain.handle(RUNTIME_CHANNELS.DIRECT_MODE_GET, () => behaviorEngine.getDirectMode());
	ipcMain.handle(RUNTIME_CHANNELS.DIRECT_MODE_SET, (_, enabled) => {
		const result = settings.updateSettings({ behavior: { directMode: !!enabled } }, { source: 'ipc:direct-mode:set' });
		const win = avatarWindow.get();
		const directMode = settings.getNamespace('behavior')?.directMode ?? !!enabled;
		if (win) win.webContents.send('direct-mode-changed', directMode);
		return { ok: true, directMode, restartRequired: result.restartRequired };
	});
}

module.exports = { registerIpc };
