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

contextBridge.exposeInMainWorld('electronAPI', {
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
	getBehaviorMode: () => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_GET_MODE),
	setBehaviorMode: (mode) => ipcRenderer.invoke(RUNTIME_CHANNELS.BEHAVIOR_SET_MODE, mode),
	subscribeEvents: () => ipcRenderer.invoke(RUNTIME_CHANNELS.EVENTS_SUBSCRIBE),
	unsubscribeEvents: () => ipcRenderer.invoke(RUNTIME_CHANNELS.EVENTS_UNSUBSCRIBE),
	onEvent: (cb) => ipcRenderer.on(RUNTIME_CHANNELS.EVENTS_STREAM, (_, data) => cb(data)),
	runTask: (taskId, payload) => ipcRenderer.invoke(RUNTIME_CHANNELS.TASKS_RUN, taskId, payload),
	stopTask: (taskId) => ipcRenderer.invoke(RUNTIME_CHANNELS.TASKS_STOP, taskId),
	onTaskStream: (cb) => ipcRenderer.on(RUNTIME_CHANNELS.TASKS_STREAM, (_, data) => cb(data)),
	verifyHistoryImport: () => ipcRenderer.invoke(RUNTIME_CHANNELS.HISTORY_VERIFY_IMPORT),
	getWindowGeometry: (windowId) => ipcRenderer.invoke(RUNTIME_CHANNELS.WINDOW_GET_GEOMETRY, windowId),
	setWindowGeometry: (windowId, bounds) => ipcRenderer.invoke(RUNTIME_CHANNELS.WINDOW_SET_GEOMETRY, windowId, bounds),
	createDailyDraft: () => ipcRenderer.invoke(RUNTIME_CHANNELS.BLOG_CREATE_DAILY_DRAFT),
	getDirectMode: () => ipcRenderer.invoke(RUNTIME_CHANNELS.DIRECT_MODE_GET),
	setDirectMode: (enabled) => ipcRenderer.invoke(RUNTIME_CHANNELS.DIRECT_MODE_SET, enabled),
	onDirectModeChanged: (cb) => ipcRenderer.on('direct-mode-changed', (_, enabled) => cb(enabled)),
});
