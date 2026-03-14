const { ipcMain } = require('electron');
const { performance } = require('node:perf_hooks');
const { RUNTIME_CHANNELS } = require('../shared/ipc-contracts.js');
const geometryStore = require('./runtime/geometry-store');
const avatarWindow = require('./windows/avatar-window');
const taskQueueWatcher = require('./task-queue/watcher');
const settings = require('./settings');

function registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, uiTaskService, convexClient, dailyLoop, kanbanWindow, intentEngine }) {
	const subscriptions = new Map();

	ipcMain.handle(RUNTIME_CHANNELS.RUNTIME_GET_HEALTH, async () => healthService.getHealth());

	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_GET_STATE, () => behaviorEngine.getState());
	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_SET_STATE, (_, statePatch = {}) => {
		const result = settings.updateSettings({ behavior: { ...(statePatch || {}) } }, { source: 'ipc:behavior:set-state' });
		const state = settings.getNamespace('behavior') || behaviorEngine.getState();
		const win = avatarWindow.get();
		if (result?.ok && win && !win.isDestroyed()) {
			win.webContents.send('behavior-state-changed', state);
			win.webContents.send('mode-changed', state.mode);
			win.webContents.send('direct-mode-changed', state.directMode);
		}
		return { ok: true, state, restartRequired: result.restartRequired };
	});
	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_GET_MODE, () => behaviorEngine.getMode());
	ipcMain.handle(RUNTIME_CHANNELS.BEHAVIOR_SET_MODE, (_, mode) => {
		const result = settings.updateSettings({ behavior: { mode } }, { source: 'ipc:behavior:set-mode' });
		const win = avatarWindow.get();
		const state = settings.getNamespace('behavior') || behaviorEngine.getState();
		if (result?.ok && win && !win.isDestroyed()) {
			win.webContents.send('behavior-state-changed', state);
			win.webContents.send('mode-changed', state.mode || mode);
			win.webContents.send('direct-mode-changed', state.directMode);
		}
		return { ok: true, mode: state.mode || mode, state, restartRequired: result.restartRequired };
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

	ipcMain.handle(RUNTIME_CHANNELS.EVENTS_BENCHMARK_PING, () => new Promise((resolve) => {
		const id = `bench-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const startedAt = performance.now();
		const listener = (runtimeEvent) => {
			if (runtimeEvent?.type !== '__IRIS_BENCHMARK_PING__') return;
			if (runtimeEvent?.payload?.id !== id) return;
			eventBus.off('event', listener);
			resolve({
				mainEventBusRoundTripMs: performance.now() - startedAt,
			});
		};
		eventBus.on('event', listener);
		eventBus.emitEvent('__IRIS_BENCHMARK_PING__', { id }, 'benchmark');
	}));

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

	// Intent prediction
	ipcMain.handle(RUNTIME_CHANNELS.INTENT_PREDICT, async (_, params = {}) => {
		if (!intentEngine) return { intents: [], toolHints: [], contextFingerprint: '' };
		return intentEngine.predict(params);
	});

	// Direct mode: get/set
	ipcMain.handle(RUNTIME_CHANNELS.DIRECT_MODE_GET, () => behaviorEngine.getDirectMode());
	ipcMain.handle(RUNTIME_CHANNELS.DIRECT_MODE_SET, (_, enabled) => {
		const result = settings.updateSettings({ behavior: { directMode: !!enabled } }, { source: 'ipc:direct-mode:set' });
		const win = avatarWindow.get();
		const state = settings.getNamespace('behavior') || behaviorEngine.getState();
		const directMode = state.directMode ?? !!enabled;
		if (win && !win.isDestroyed()) {
			win.webContents.send('behavior-state-changed', state);
			win.webContents.send('direct-mode-changed', directMode);
		}
		return { ok: true, directMode, state, restartRequired: result.restartRequired };
	});
}

module.exports = { registerIpc };
