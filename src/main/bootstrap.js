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
const { createTrayController } = require('./status-tray');
const { registerIpc } = require('./ipc-runtime');
const { BehaviorModeState } = require('./runtime/behavior-mode');
const { UITaskService } = require('./automation/ui-task-service');
const { SelfImprovementManager } = require('./automation/self-improvement-manager');
const { MemoryStore } = require('./automation/memory-store');
const { LearningManager } = require('./automation/learning-manager');
const { NativeFallbackManager } = require('./automation/native-fallback-manager');
const { EpisodeRecorder } = require('./automation/episode-recorder');
const { setUiTaskService, setSelfImprovementManager, setMemoryStore, setLearningManager, setNativeFallbackManager, setEpisodeRecorder } = require('./automation/service-ref');
const taskQueueWatcher = require('./task-queue/watcher');
const { setConvexClient: setTqControllerClient, setBehaviorEngine: setTqBehaviorEngine } = require('./controllers/taskQueueController');
const { setConvexClient: setTqToolClient } = require('./tools/task-queue');

function startRuntime({ apiKey }) {
	const eventBus = new RuntimeEventBus();
	const convexClient = new ConvexClient({ eventBus });
	const taskEngine = new TaskEngine({ eventBus });
	const behaviorEngine = new BehaviorModeState();
	const memoryStore = new MemoryStore();
	const nativeFallbackManager = new NativeFallbackManager();
	const episodeRecorder = new EpisodeRecorder();
	const selfImprovementManager = new SelfImprovementManager({ skillsEngine: skills });
	const learningManager = new LearningManager({ memoryStore, selfImprovementManager });
	const uiTaskService = new UITaskService({ eventBus, selfImprovementManager, nativeFallbackManager, episodeRecorder });
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
	const statusTray = createTrayController();
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
	setUiTaskService(uiTaskService);
	setSelfImprovementManager(selfImprovementManager);
	setMemoryStore(memoryStore);
	setLearningManager(learningManager);
	setNativeFallbackManager(nativeFallbackManager);
	setEpisodeRecorder(episodeRecorder);
	legacyIpc.register(apiKey);
	registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, uiTaskService, convexClient, dailyLoop, kanbanWindow });
	setTqControllerClient(convexClient);
	setTqBehaviorEngine(behaviorEngine);
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
		statusTray.create();
		healthService.start();
		dailyLoop.start();
		taskQueueWatcher.start(convexClient, behaviorEngine);

		globalShortcut.register('CommandOrControl+I', () => {
			const w = avatarWindow.get();
			if (w) w.webContents.send('toggle-voice');
		});
		globalShortcut.register('CommandOrControl+K', () => {
			const kWin = kanbanWindow.get();
			if (kWin) {
				if (kWin.isVisible()) {
					kWin.hide();
				} else {
					kWin.showInactive();
					kWin.focus();
				}
			}
		});
		globalShortcut.register('CommandOrControl+Shift+M', () => {
			const nextMode = behaviorEngine.getMode() === 'autonomous' ? 'silent' : 'autonomous';
			behaviorEngine.setMode(nextMode);
			if (win) win.webContents.send('mode-changed', nextMode);
		});
		globalShortcut.register('CommandOrControl+Shift+D', () => {
			const next = !behaviorEngine.getDirectMode();
			behaviorEngine.setDirectMode(next);
			taskQueueWatcher.restartWithNewInterval();
			if (win) win.webContents.send('direct-mode-changed', next);
		});
	});

	app.on('will-quit', () => {
		globalShortcut.unregisterAll();
		healthService.stop();
		dailyLoop.stop();
		taskQueueWatcher.stop();
		statusTray.destroy();
		legacyConvexStore.shutdown();
	});

	app.on('window-all-closed', () => {
		if (statusTray.shouldKeepAlive()) return;
		app.quit();
	});

	return { apiKey };
}

module.exports = { startRuntime };
