const os = require('node:os');
const path = require('node:path');
const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS, RUNTIME_CHANNELS } = require('./shared/ipc-contracts');

const avatarConfigPromise = ipcRenderer.invoke(CHANNELS.GET_AVATAR_CONFIG);
const irisSourceDir = path.resolve(__dirname, '..');
const homeDir = os.homedir();

function formatHomeRelativePath(targetPath) {
	const relativePath = path.relative(homeDir, targetPath);
	if (!relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
		return relativePath ? `~/${relativePath.split(path.sep).join('/')}` : '~';
	}
	return targetPath;
}

contextBridge.exposeInMainWorld('avatarConfig', null);
contextBridge.exposeInMainWorld('getAvatarConfig', () => avatarConfigPromise);
contextBridge.exposeInMainWorld('irisPaths', {
	sourceDir: irisSourceDir,
	sourceDirDisplay: formatHomeRelativePath(irisSourceDir),
});

const electronAPI = {
	getApiKey: () => ipcRenderer.invoke(CHANNELS.GET_API_KEY),
	getVoiceConfig: () => ipcRenderer.invoke(CHANNELS.GET_VOICE_CONFIG),
	onToggleVoice: (cb) => ipcRenderer.on(CHANNELS.TOGGLE_VOICE, cb),
	executeTool: (name, args) => ipcRenderer.invoke(CHANNELS.EXECUTE_TOOL, name, args),
	captureScreen: () => ipcRenderer.invoke(CHANNELS.CAPTURE_SCREEN),
	searchSpinner: (query) => ipcRenderer.send(CHANNELS.SEARCH_SPINNER, query),
	searchResult: (query, content) => ipcRenderer.send(CHANNELS.SEARCH_RESULT, query, content),
	searchHide: () => ipcRenderer.send(CHANNELS.SEARCH_HIDE),
	trackVocabulary: (terms) => ipcRenderer.send(CHANNELS.TRACK_VOCABULARY, terms),
	getVocabulary: () => ipcRenderer.invoke(CHANNELS.GET_VOCABULARY),
	getHotVocabulary: () => ipcRenderer.invoke(CHANNELS.GET_HOT_VOCABULARY),
	getVocabularyStats: () => ipcRenderer.invoke(CHANNELS.GET_VOCABULARY_STATS),
	getVocabularyCorrections: () => ipcRenderer.invoke(CHANNELS.GET_VOCABULARY_CORRECTIONS),
	getVocabularyCore: () => ipcRenderer.invoke(CHANNELS.GET_VOCABULARY_CORE),
	addCorrection: (wrong, right) => ipcRenderer.send(CHANNELS.ADD_CORRECTION, wrong, right),
	onMessagingAppFocused: (cb) => ipcRenderer.on(CHANNELS.MESSAGING_APP_FOCUSED, (_, app) => cb(app)),
	onMessagingAppLeft: (cb) => ipcRenderer.on(CHANNELS.MESSAGING_APP_LEFT, cb),
	getSkillDeclarations: () => ipcRenderer.invoke(CHANNELS.GET_SKILL_DECLARATIONS),
	getSkillPrompts: () => ipcRenderer.invoke(CHANNELS.GET_SKILL_PROMPTS),
	getSkillCatalog: () => ipcRenderer.invoke(CHANNELS.GET_SKILL_CATALOG),
	setIgnoreMouseEvents: (ignore) => ipcRenderer.send(CHANNELS.SET_IGNORE_MOUSE, ignore),
	reloadSession: () => ipcRenderer.invoke(CHANNELS.RELOAD_SESSION),
	onReloadSession: (cb) => ipcRenderer.on(CHANNELS.RELOAD_SESSION, cb),
	logToFile: (level, tag, message) => ipcRenderer.send(CHANNELS.LOG_TO_FILE, level, tag, message),
	getSettings: () => ipcRenderer.invoke(CHANNELS.GET_SETTINGS),
	updateSettings: (patch, metadata) => ipcRenderer.invoke(CHANNELS.UPDATE_SETTINGS, patch, metadata),
	onSettingsChanged: (cb) => ipcRenderer.on(CHANNELS.SETTINGS_CHANGED, (_, settings) => cb(settings)),
	getLogSettings: () => ipcRenderer.invoke(CHANNELS.GET_LOG_SETTINGS),
	updateLogSettings: (patch) => ipcRenderer.invoke(CHANNELS.UPDATE_LOG_SETTINGS, patch),
	onLogSettingsChanged: (cb) => ipcRenderer.on(CHANNELS.LOG_SETTINGS_CHANGED, (_, settings) => cb(settings)),
	killSkill: () => ipcRenderer.invoke(CHANNELS.KILL_SKILL),
	toggleAvatar: () => ipcRenderer.invoke(CHANNELS.TOGGLE_AVATAR),
	onToggleAutonomous: (cb) => ipcRenderer.on(CHANNELS.TOGGLE_AUTONOMOUS, cb),
	saveConversationTurn: (role, text) => ipcRenderer.send(CHANNELS.SAVE_CONVERSATION_TURN, role, text),
	saveToolExecution: (name, args, result, success, durationMs) => ipcRenderer.send(CHANNELS.SAVE_TOOL_EXECUTION, name, args, result, success, durationMs),
	semanticSearch: (query, limit, roleFilter) => ipcRenderer.invoke(CHANNELS.SEMANTIC_SEARCH, query, limit, roleFilter),
	newConvexSession: () => ipcRenderer.send(CHANNELS.NEW_CONVEX_SESSION),
	endSession: () => ipcRenderer.send(CHANNELS.END_CONVEX_SESSION),
	loadKanbanTasks: () => ipcRenderer.invoke(CHANNELS.LOAD_KANBAN_TASKS),
	saveKanbanTasks: (tasks) => ipcRenderer.invoke(CHANNELS.SAVE_KANBAN_TASKS, tasks),
	updateKanbanTask: (taskId, updates) => ipcRenderer.invoke(CHANNELS.UPDATE_KANBAN_TASK, taskId, updates),
	onClaudeCodeStream: (cb) => ipcRenderer.on(CHANNELS.CLAUDE_CODE_STREAM, (_, data) => cb(data)),
	kanbanRunTask: (taskId) => ipcRenderer.invoke(CHANNELS.RUN_TASK, taskId),
	kanbanDeleteTask: (taskId, source) => ipcRenderer.invoke('delete-kanban-task', taskId, source),
	kanbanAddTask: (task) => ipcRenderer.invoke('add-kanban-task', task),
	kanbanRunSkill: (skillName, opts) => ipcRenderer.invoke(CHANNELS.RUN_SKILL, skillName, opts),
	kanbanSetVisible: (visible) => ipcRenderer.invoke(CHANNELS.SET_KANBAN_VISIBLE, visible),
	kanbanResize: (width, height) => ipcRenderer.invoke(CHANNELS.RESIZE_KANBAN, width, height),
	kanbanRemoveCompleted: () => ipcRenderer.invoke(CHANNELS.REMOVE_COMPLETED_TASKS),
	kanbanSyncToConvex: (tasks) => ipcRenderer.invoke(CHANNELS.SYNC_TASKS_TO_CONVEX, tasks),
	kanbanGitCommit: (message) => ipcRenderer.invoke(CHANNELS.GIT_COMMIT, message),
	kanbanGitPush: () => ipcRenderer.invoke(CHANNELS.GIT_PUSH),
	kanbanSpecMdExists: () => ipcRenderer.invoke(CHANNELS.SPEC_MD_EXISTS),
	kanbanTasksFileExists: () => ipcRenderer.invoke(CHANNELS.TASKS_FILE_EXISTS),
	kanbanWriteSpecMd: (spec) => ipcRenderer.invoke(CHANNELS.WRITE_SPEC_MD, spec),
	kanbanDeleteTasksFile: () => ipcRenderer.invoke(CHANNELS.DELETE_TASKS_FILE),
	kanbanParseSpecMd: () => ipcRenderer.invoke(CHANNELS.PARSE_SPEC_MD),
	onKanbanTasksUpdated: (cb) => ipcRenderer.on(CHANNELS.TASKS_FILE_UPDATED, cb),
	onKanbanCodeStream: (cb) => ipcRenderer.on(CHANNELS.CLAUDE_CODE_STREAM, (_, data) => cb(data)),
	tqCreateTask: (rawPrompt, projectPath) => ipcRenderer.invoke(CHANNELS.TQ_CREATE_TASK, rawPrompt, projectPath),
	tqApproveTask: (taskId) => ipcRenderer.invoke(CHANNELS.TQ_APPROVE_TASK, taskId),
	tqCancelTask: (taskId) => ipcRenderer.invoke(CHANNELS.TQ_CANCEL_TASK, taskId),
	tqDetectPath: () => ipcRenderer.invoke(CHANNELS.TQ_DETECT_PATH),
	tqGetAll: () => ipcRenderer.invoke(CHANNELS.TQ_GET_ALL),
	tqGetByProject: (projectPath) => ipcRenderer.invoke(CHANNELS.TQ_GET_BY_PROJECT, projectPath),
	onTqTaskUpdate: (cb) => ipcRenderer.on(CHANNELS.TQ_TASK_UPDATE, (_, data) => cb(data)),
	onTqCountdownState: (cb) => ipcRenderer.on(CHANNELS.TQ_COUNTDOWN_STATE, (_, data) => cb(data)),
	getRuntimeHealth: () => ipcRenderer.invoke(RUNTIME_CHANNELS.RUNTIME_GET_HEALTH),
	getBenchmarkProcessMetrics: async () => {
		const processMemory = typeof process.getProcessMemoryInfo === 'function'
			? await process.getProcessMemoryInfo().catch(() => null)
			: null;
		const nodeMemory = typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
		const cpuRaw = typeof process.getCPUUsage === 'function' ? process.getCPUUsage() : null;
		return {
			sampledAt: Date.now(),
			processMemory,
			nodeMemory,
			cpu: cpuRaw ? {
				percentCPUUsage: cpuRaw.percentCPUUsage,
				cumulativeCPUUsage: cpuRaw.cumulativeCPUUsage,
				timestampMicros: Math.round(performance.now() * 1000),
			} : null,
			rendererPerformanceMemory: globalThis.performance?.memory || null,
		};
	},
	benchmarkRuntimeEventPing: async () => {
		const startedAt = performance.now();
		const result = await ipcRenderer.invoke(RUNTIME_CHANNELS.EVENTS_BENCHMARK_PING);
		return {
			...result,
			rendererRoundTripMs: performance.now() - startedAt,
		};
	},
	getBehaviorState: () => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_GET_STATE),
	setBehaviorState: (state) => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_SET_STATE, state),
	getBehaviorMode: () => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_GET_MODE),
	setBehaviorMode: (mode) => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_SET_MODE, mode),
	onBehaviorStateChanged: (cb) => ipcRenderer.on('behavior-state-changed', (_, state) => cb(state)),
	onBehaviorModeChanged: (cb) => ipcRenderer.on('mode-changed', (_, mode) => cb(mode)),
	subscribeEvents: () => ipcRenderer.invoke(RUNTIME_CHANNELS.EVENTS_SUBSCRIBE),
	unsubscribeEvents: () => ipcRenderer.invoke(RUNTIME_CHANNELS.EVENTS_UNSUBSCRIBE),
	onEvent: (cb) => ipcRenderer.on(RUNTIME_CHANNELS.EVENTS_STREAM, (_, data) => cb(data)),
	runTask: (taskId, payload) => ipcRenderer.invoke(RUNTIME_CHANNELS.TASKS_RUN, taskId, payload),
	stopTask: (taskId) => ipcRenderer.invoke(RUNTIME_CHANNELS.TASKS_STOP, taskId),
	onTaskStream: (cb) => ipcRenderer.on(RUNTIME_CHANNELS.TASKS_STREAM, (_, data) => cb(data)),
	runUiTask: (goal, opts) => ipcRenderer.invoke(RUNTIME_CHANNELS.UI_TASK_RUN, goal, opts),
	stopUiTask: (reason) => ipcRenderer.invoke(RUNTIME_CHANNELS.UI_TASK_STOP, reason),
	getUiState: () => ipcRenderer.invoke(RUNTIME_CHANNELS.UI_STATE_GET),
	onUiTaskStream: (cb) => ipcRenderer.on(RUNTIME_CHANNELS.UI_TASK_STREAM, (_, data) => cb(data)),
	verifyHistoryImport: () => ipcRenderer.invoke(RUNTIME_CHANNELS.HISTORY_VERIFY_IMPORT),
	getWindowGeometry: (windowId) => ipcRenderer.invoke(RUNTIME_CHANNELS.WINDOW_GET_GEOMETRY, windowId),
	setWindowGeometry: (windowId, bounds) => ipcRenderer.invoke(RUNTIME_CHANNELS.WINDOW_SET_GEOMETRY, windowId, bounds),
	createDailyDraft: () => ipcRenderer.invoke(RUNTIME_CHANNELS.BLOG_CREATE_DAILY_DRAFT),
	getDirectMode: () => ipcRenderer.invoke(RUNTIME_CHANNELS.DIRECT_MODE_GET),
	setDirectMode: (enabled) => ipcRenderer.invoke(RUNTIME_CHANNELS.DIRECT_MODE_SET, enabled),
	onDirectModeChanged: (cb) => ipcRenderer.on('direct-mode-changed', (_, enabled) => cb(enabled)),
};

// Namespaced API
electronAPI.runtime = {
	getHealth: electronAPI.getRuntimeHealth,
	getProcessMetrics: electronAPI.getBenchmarkProcessMetrics,
	eventPing: electronAPI.benchmarkRuntimeEventPing,
	getBehaviorState: electronAPI.getBehaviorState,
	setBehaviorState: electronAPI.setBehaviorState,
	getBehaviorMode: electronAPI.getBehaviorMode,
	setBehaviorMode: electronAPI.setBehaviorMode,
	onBehaviorStateChanged: electronAPI.onBehaviorStateChanged,
	onBehaviorModeChanged: electronAPI.onBehaviorModeChanged,
	subscribeEvents: electronAPI.subscribeEvents,
	unsubscribeEvents: electronAPI.unsubscribeEvents,
	onEvent: electronAPI.onEvent,
	runTask: electronAPI.runTask,
	stopTask: electronAPI.stopTask,
	onTaskStream: electronAPI.onTaskStream,
	runUiTask: electronAPI.runUiTask,
	stopUiTask: electronAPI.stopUiTask,
	getUiState: electronAPI.getUiState,
	onUiTaskStream: electronAPI.onUiTaskStream,
	verifyHistoryImport: electronAPI.verifyHistoryImport,
	createDailyDraft: electronAPI.createDailyDraft,
	getDirectMode: electronAPI.getDirectMode,
	setDirectMode: electronAPI.setDirectMode,
	onDirectModeChanged: electronAPI.onDirectModeChanged,
	reloadSession: electronAPI.reloadSession,
	onReloadSession: electronAPI.onReloadSession,
	executeTool: electronAPI.executeTool,
	getSkillDeclarations: electronAPI.getSkillDeclarations,
	getSkillPrompts: electronAPI.getSkillPrompts,
	getSkillCatalog: electronAPI.getSkillCatalog,
	killSkill: electronAPI.killSkill,
};

electronAPI.kanban = {
	loadTasks: electronAPI.loadKanbanTasks,
	saveTasks: electronAPI.saveKanbanTasks,
	updateTask: electronAPI.updateKanbanTask,
	deleteTask: electronAPI.kanbanDeleteTask,
	addTask: electronAPI.kanbanAddTask,
	runTask: electronAPI.kanbanRunTask,
	runSkill: electronAPI.kanbanRunSkill,
	setVisible: electronAPI.kanbanSetVisible,
	resize: electronAPI.kanbanResize,
	removeCompleted: electronAPI.kanbanRemoveCompleted,
	syncToConvex: electronAPI.kanbanSyncToConvex,
	gitCommit: electronAPI.kanbanGitCommit,
	gitPush: electronAPI.kanbanGitPush,
	specMdExists: electronAPI.kanbanSpecMdExists,
	tasksFileExists: electronAPI.kanbanTasksFileExists,
	writeSpecMd: electronAPI.kanbanWriteSpecMd,
	deleteTasksFile: electronAPI.kanbanDeleteTasksFile,
	parseSpecMd: electronAPI.kanbanParseSpecMd,
	onTasksUpdated: electronAPI.onKanbanTasksUpdated,
	onCodeStream: electronAPI.onKanbanCodeStream,
};

electronAPI.queue = {
	createTask: electronAPI.tqCreateTask,
	approveTask: electronAPI.tqApproveTask,
	cancelTask: electronAPI.tqCancelTask,
	detectPath: electronAPI.tqDetectPath,
	getAll: electronAPI.tqGetAll,
	getByProject: electronAPI.tqGetByProject,
	onTaskUpdate: electronAPI.onTqTaskUpdate,
	onCountdownState: electronAPI.onTqCountdownState,
};

electronAPI.voice = {
	getVoiceConfig: electronAPI.getVoiceConfig,
	onToggleVoice: electronAPI.onToggleVoice,
	trackVocabulary: electronAPI.trackVocabulary,
	getVocabulary: electronAPI.getVocabulary,
	getHotVocabulary: electronAPI.getHotVocabulary,
	getVocabularyStats: electronAPI.getVocabularyStats,
	getVocabularyCorrections: electronAPI.getVocabularyCorrections,
	getVocabularyCore: electronAPI.getVocabularyCore,
	addCorrection: electronAPI.addCorrection,
};

electronAPI.window = {
	captureScreen: electronAPI.captureScreen,
	setIgnoreMouseEvents: electronAPI.setIgnoreMouseEvents,
	toggleAvatar: electronAPI.toggleAvatar,
	onToggleAutonomous: electronAPI.onToggleAutonomous,
	getWindowGeometry: electronAPI.getWindowGeometry,
	setWindowGeometry: electronAPI.setWindowGeometry,
};

electronAPI.search = {
	spinner: electronAPI.searchSpinner,
	result: electronAPI.searchResult,
	hide: electronAPI.searchHide,
	semantic: electronAPI.semanticSearch,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
