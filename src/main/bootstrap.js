const { app, session, systemPreferences, globalShortcut } = require('electron');
const { exec } = require('child_process');
const avatarWindow = require('./windows/avatar-window');
const skills = require('./skills');
const legacyIpc = require('./ipc');
const legacyConvexStore = require('./convex-store');
const { RuntimeEventBus } = require('../shared/event-bus');
const { ConvexClient } = require('./convex-client');
const { TaskEngine } = require('./tasks/task-engine');
const { HealthService } = require('./runtime/health-service');
const { DailyLoop } = require('./autonomy/daily-loop');
const { createGhostDraft } = require('./autonomy/ghost-draft-publisher');
const kanbanWindow = require('./windows/kanban-window');
const { registerIpc } = require('./ipc-runtime');
const { BehaviorModeState } = require('./runtime/behavior-mode');
const taskQueueWatcher = require('./task-queue/watcher');
const { setConvexClient: setTqControllerClient } = require('./controllers/taskQueueController');
const { setConvexClient: setTqToolClient } = require('./tools/task-queue');

function startRuntime({ apiKey }) {
	const eventBus = new RuntimeEventBus();
	const convexClient = new ConvexClient({ eventBus });
	const taskEngine = new TaskEngine({ eventBus });
	const behaviorEngine = new BehaviorModeState();
	const healthService = new HealthService({
		convexClient,
		taskEngine,
		skillEngine: { getHealth: () => 'ok' },
		eventBus,
	});
	const dailyLoop = new DailyLoop({
		taskEngine,
		createGhostDraft,
		convexClient,
		eventBus,
	});
	let runtimeEventSeq = 0;

	eventBus.on('event', (evt) => {
		const idempotencyKey = `runtime_evt_${evt.timestamp}_${runtimeEventSeq++}_${evt.type}`;
		const serializedEvent = {
			type: evt.type,
			timestamp: evt.timestamp,
			payload: JSON.stringify(evt.payload || {}),
			source: evt.source || 'runtime',
		};

		convexClient.saveRuntimeEvent(serializedEvent, idempotencyKey).catch(() => {});

		if (evt.type === 'TASK_MILESTONE' || evt.type === 'TASK_DONE') {
			const taskId = evt.payload?.taskId || 'unknown';
			convexClient.saveTaskMilestone({
				taskId,
				message: evt.payload?.message || '',
				importance: evt.payload?.importance || 'medium',
				status: evt.payload?.status,
				timestamp: evt.timestamp,
			}, `task_milestone_${taskId}_${evt.timestamp}`).catch(() => {});
		}

		if (evt.type === 'PROACTIVE_SUGGESTION') {
			convexClient.saveProactiveSuggestion({
				text: evt.payload?.suggestion || evt.payload?.text || '',
				confidence: Number(evt.payload?.confidence || 0),
				context: evt.payload?.context ? JSON.stringify(evt.payload.context) : undefined,
				accepted: evt.payload?.accepted,
				timestamp: evt.timestamp,
			}, `proactive_${evt.timestamp}`).catch(() => {});
		}
	});

	skills.scan();
	legacyConvexStore.init();
	legacyIpc.register(apiKey);
	registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, convexClient, dailyLoop, kanbanWindow });
	setTqControllerClient(convexClient);
	setTqToolClient(convexClient);

	app.whenReady().then(async () => {
		if (process.platform === 'darwin') {
			await systemPreferences.askForMediaAccess('microphone');
		}
		session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
			callback(permission === 'media');
		});
		exec('osascript -e "set volume input volume 100"', () => {});

		const win = avatarWindow.create();
		kanbanWindow.create();
		healthService.start();
		dailyLoop.start();
		taskQueueWatcher.start(convexClient);

		globalShortcut.register('CommandOrControl+I', () => {
			const w = avatarWindow.get();
			if (w) w.webContents.send('toggle-voice');
		});
		globalShortcut.register('CommandOrControl+K', () => {
			const kWin = kanbanWindow.get();
			if (kWin) (kWin.isVisible() ? kWin.hide() : kWin.show());
		});
		globalShortcut.register('CommandOrControl+Shift+M', () => {
			const nextMode = behaviorEngine.getMode() === 'autonomous' ? 'silent' : 'autonomous';
			behaviorEngine.setMode(nextMode);
			if (win) win.webContents.send('mode-changed', nextMode);
		});
	});

	app.on('will-quit', () => {
		globalShortcut.unregisterAll();
		healthService.stop();
		dailyLoop.stop();
		taskQueueWatcher.stop();
	});

	app.on('window-all-closed', () => {
		legacyConvexStore.shutdown();
		app.quit();
	});

	return { apiKey };
}

module.exports = { startRuntime };
