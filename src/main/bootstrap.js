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
const { registerSettingsHandlers } = require('./runtime/settings-handlers');
const { registerShortcuts, unregisterShortcuts } = require('./runtime/shortcut-manager');
const { UITaskService } = require('./automation/ui-task-service');
const { SelfImprovementManager } = require('./automation/self-improvement-manager');
const { MemoryStore } = require('./automation/memory-store');
const { LearningManager } = require('./automation/learning-manager');
const { NativeFallbackManager } = require('./automation/native-fallback-manager');
const { EpisodeRecorder } = require('./automation/episode-recorder');
const { setUiTaskService, setSelfImprovementManager, setMemoryStore, setLearningManager, setNativeFallbackManager, setEpisodeRecorder, setConvexClient } = require('./automation/service-ref');
const { setConvexClient: setUnifiedConvexClient } = require('./runtime/convex-adapter');
const taskQueueWatcher = require('./task-queue/watcher');
const { RuntimeEventPersistence } = require('./runtime/event-persistence');
const settings = require('./settings');
const taskQueueService = require('./task-queue/service');
const twoFA = require('./two-fa');
const vocabMonitor = require('./vocab/monitor');

function startRuntime({ apiKey }) {
	const eventBus = new RuntimeEventBus();
	const convexClient = new ConvexClient({ eventBus });
	setUnifiedConvexClient(convexClient);
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
	const eventPersistence = new RuntimeEventPersistence({ eventBus, convexClient });

	registerSettingsHandlers({ behaviorEngine });
	const initialSettings = settings.init();
	behaviorEngine.setState(initialSettings.behavior);
	eventPersistence.start();
	twoFA.init({ eventBus, behaviorEngine, settings: initialSettings.twoFA });

	skills.scan();
	legacyConvexStore.init();
	setUiTaskService(uiTaskService);
	setSelfImprovementManager(selfImprovementManager);
	setMemoryStore(memoryStore);
	setLearningManager(learningManager);
	setNativeFallbackManager(nativeFallbackManager);
	setEpisodeRecorder(episodeRecorder);
	setConvexClient(convexClient);
	legacyIpc.register(apiKey);
	registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, uiTaskService, convexClient, dailyLoop, kanbanWindow });
	taskQueueService.setBehaviorEngine(behaviorEngine);

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
		taskQueueWatcher.start(undefined, behaviorEngine);

		registerShortcuts({ behaviorEngine });
		vocabMonitor.start(apiKey, () => avatarWindow.getWindow());
	});

	app.on('will-quit', () => {
		unregisterShortcuts();
		healthService.stop();
		dailyLoop.stop();
		twoFA.shutdown();
		vocabMonitor.stop();
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
