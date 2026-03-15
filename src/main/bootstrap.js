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
const { setUiTaskService, setSelfImprovementManager, setMemoryStore, setLearningManager, setNativeFallbackManager, setEpisodeRecorder, setConvexClient, setIntentPredictionEngine, setFeedbackStore } = require('./automation/service-ref');
const { FeedbackStore } = require('./feedback/store');
const { GroqClient } = require('./automation/groq-client');
const { IntentPredictionEngine } = require('./automation/intent-prediction-engine');
const { WorldState } = require('./automation/world-state');
const { setConvexClient: setUnifiedConvexClient } = require('./runtime/convex-adapter');
const taskQueueWatcher = require('./task-queue/watcher');
const { RuntimeEventPersistence } = require('./runtime/event-persistence');
const settings = require('./settings');
const taskQueueService = require('./task-queue/service');
const twoFA = require('./two-fa');
const vocabMonitor = require('./vocab/monitor');
const { LinkCapturePoller } = require('./link-capture/poller');
const appConfig = require('../shared/config').default;

function startRuntime({ apiKey }) {
	const eventBus = new RuntimeEventBus();
	const convexClient = new ConvexClient({ eventBus });
	setUnifiedConvexClient(convexClient);
	const taskEngine = new TaskEngine({ eventBus });
	const behaviorEngine = new BehaviorModeState();
	const memoryStore = new MemoryStore();
	const feedbackStore = new FeedbackStore();
	const nativeFallbackManager = new NativeFallbackManager();
	const episodeRecorder = new EpisodeRecorder();
	const selfImprovementManager = new SelfImprovementManager({ skillsEngine: skills });
	const learningManager = new LearningManager({ memoryStore, selfImprovementManager });
	const groqClient = new GroqClient({ apiKey: process.env.GROQ_API_KEY || '' });
	const worldState = new WorldState();
	const intentEngine = new IntentPredictionEngine({ groqClient, learningManager, memoryStore, eventBus, worldState });
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
	setFeedbackStore(feedbackStore);
	setLearningManager(learningManager);
	setNativeFallbackManager(nativeFallbackManager);
	setEpisodeRecorder(episodeRecorder);
	setConvexClient(convexClient);
	setIntentPredictionEngine(intentEngine);
	legacyIpc.register(apiKey);
	registerIpc({ healthService, behaviorEngine, eventBus, taskEngine, uiTaskService, convexClient, dailyLoop, kanbanWindow, intentEngine });
	taskQueueService.setBehaviorEngine(behaviorEngine);

	const linkCfg = appConfig.linkCapture || {};
	const linkCapturePoller = linkCfg.enabled !== false
		? new LinkCapturePoller({
			pollIntervalMs: linkCfg.pollIntervalMs || 10000,
			maxSeenCacheSize: linkCfg.maxSeenCacheSize || 5000,
		})
		: null;

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
		if (intentEngine.available) intentEngine.startPredictionLoop();
		taskQueueWatcher.start(undefined, behaviorEngine);

		registerShortcuts({ behaviorEngine });
		vocabMonitor.start(apiKey, () => avatarWindow.get());
		if (linkCapturePoller) {
			try {
				linkCapturePoller.start();
			} catch (err) {
				console.error('[LinkCapture] Failed to start:', err.message);
			}
		} else {
			console.log('[LinkCapture] Disabled by config');
		}
	});

	app.on('will-quit', () => {
		unregisterShortcuts();
		healthService.stop();
		dailyLoop.stop();
		intentEngine.stopPredictionLoop();
		twoFA.shutdown();
		vocabMonitor.stop();
		if (linkCapturePoller) linkCapturePoller.stop();
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
