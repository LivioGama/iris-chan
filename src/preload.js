// Context bridge — uses shared channel names
const { contextBridge, ipcRenderer } = require('electron');
try { require('ts-node').register({ transpileOnly: true }); } catch {}
let ch;
try {
	ch = require('./shared/channels');
} catch (e) {
	console.error('[Preload] Failed to load channels:', e.message);
	// Fallback to inline channel names
	ch = {
		GET_API_KEY: 'get-api-key', EXECUTE_TOOL: 'execute-tool', CAPTURE_SCREEN: 'capture-screen',
		TOGGLE_VOICE: 'toggle-voice', TRACK_VOCABULARY: 'track-vocabulary',
		GET_VOCABULARY: 'get-vocabulary', GET_HOT_VOCABULARY: 'get-hot-vocabulary',
		GET_VOCABULARY_STATS: 'get-vocabulary-stats', GET_VOCABULARY_CORRECTIONS: 'get-vocabulary-corrections',
		GET_VOCABULARY_CORE: 'get-vocabulary-core', ADD_CORRECTION: 'add-correction',
		SEARCH_SPINNER: 'search-spinner', SEARCH_RESULT: 'search-result', SEARCH_HIDE: 'search-hide',
		MESSAGING_APP_FOCUSED: 'messaging-app-focused', MESSAGING_APP_LEFT: 'messaging-app-left',
		GET_SKILL_DECLARATIONS: 'get-skill-declarations', GET_SKILL_PROMPTS: 'get-skill-prompts',
		GET_SKILL_CATALOG: 'get-skill-catalog', SET_IGNORE_MOUSE: 'set-ignore-mouse',
		RELOAD_SESSION: 'reload-session',
		LOG_TO_FILE: 'log-to-file',
		KILL_SKILL: 'kill-skill',
		TOGGLE_AVATAR: 'toggle-avatar',
		TOGGLE_AUTONOMOUS: 'toggle-autonomous',
		SAVE_CONVERSATION_TURN: 'save-conversation-turn',
		SAVE_TOOL_EXECUTION: 'save-tool-execution',
		SEMANTIC_SEARCH: 'semantic-search',
		NEW_CONVEX_SESSION: 'new-convex-session',
		END_CONVEX_SESSION: 'end-convex-session',
		LOAD_KANBAN_TASKS: 'load-kanban-tasks',
		SAVE_KANBAN_TASKS: 'save-kanban-tasks',
		UPDATE_KANBAN_TASK: 'update-kanban-task',
	};
}

// Get avatar config from main process (async, exposed as a promise)
const avatarConfigPromise = ipcRenderer.invoke('get-avatar-config');

contextBridge.exposeInMainWorld('avatarConfig', null);
contextBridge.exposeInMainWorld('getAvatarConfig', () => avatarConfigPromise);

contextBridge.exposeInMainWorld('electronAPI', {
	getApiKey: () => ipcRenderer.invoke(ch.GET_API_KEY),
	onToggleVoice: (cb) => ipcRenderer.on(ch.TOGGLE_VOICE, cb),
	executeTool: (name, args) => ipcRenderer.invoke(ch.EXECUTE_TOOL, name, args),
	captureScreen: () => ipcRenderer.invoke(ch.CAPTURE_SCREEN),
	searchSpinner: (query) => ipcRenderer.send(ch.SEARCH_SPINNER, query),
	searchResult: (query, content) => ipcRenderer.send(ch.SEARCH_RESULT, query, content),
	searchHide: () => ipcRenderer.send(ch.SEARCH_HIDE),
	trackVocabulary: (terms) => ipcRenderer.send(ch.TRACK_VOCABULARY, terms),
	getVocabulary: () => ipcRenderer.invoke(ch.GET_VOCABULARY),
	getHotVocabulary: () => ipcRenderer.invoke(ch.GET_HOT_VOCABULARY),
	getVocabularyStats: () => ipcRenderer.invoke(ch.GET_VOCABULARY_STATS),
	getVocabularyCorrections: () => ipcRenderer.invoke(ch.GET_VOCABULARY_CORRECTIONS),
	getVocabularyCore: () => ipcRenderer.invoke(ch.GET_VOCABULARY_CORE),
	addCorrection: (wrong, right) => ipcRenderer.send(ch.ADD_CORRECTION, wrong, right),
	onMessagingAppFocused: (cb) => ipcRenderer.on(ch.MESSAGING_APP_FOCUSED, (_, app) => cb(app)),
	onMessagingAppLeft: (cb) => ipcRenderer.on(ch.MESSAGING_APP_LEFT, cb),
	getSkillDeclarations: () => ipcRenderer.invoke(ch.GET_SKILL_DECLARATIONS),
	getSkillPrompts: () => ipcRenderer.invoke(ch.GET_SKILL_PROMPTS),
	getSkillCatalog: () => ipcRenderer.invoke(ch.GET_SKILL_CATALOG),
	setIgnoreMouseEvents: (ignore) => ipcRenderer.send(ch.SET_IGNORE_MOUSE, ignore),
	reloadSession: () => ipcRenderer.invoke(ch.RELOAD_SESSION),
	onReloadSession: (cb) => ipcRenderer.on(ch.RELOAD_SESSION, cb),
	logToFile: (level, tag, message) => ipcRenderer.send(ch.LOG_TO_FILE, level, tag, message),
	killSkill: () => ipcRenderer.invoke(ch.KILL_SKILL),
	toggleAvatar: () => ipcRenderer.invoke(ch.TOGGLE_AVATAR),
	onToggleAutonomous: (cb) => ipcRenderer.on('toggle-autonomous', cb),
	saveConversationTurn: (role, text) => ipcRenderer.send(ch.SAVE_CONVERSATION_TURN, role, text),
	saveToolExecution: (name, args, result, success, durationMs) => ipcRenderer.send(ch.SAVE_TOOL_EXECUTION, name, args, result, success, durationMs),
	semanticSearch: (query, limit, roleFilter) => ipcRenderer.invoke(ch.SEMANTIC_SEARCH, query, limit, roleFilter),
	newConvexSession: () => ipcRenderer.send(ch.NEW_CONVEX_SESSION),
	endSession: () => ipcRenderer.send(ch.END_CONVEX_SESSION),
	loadKanbanTasks: () => ipcRenderer.invoke(ch.LOAD_KANBAN_TASKS),
	saveKanbanTasks: (tasks) => ipcRenderer.invoke(ch.SAVE_KANBAN_TASKS, tasks),
	updateKanbanTask: (taskId, updates) => ipcRenderer.invoke(ch.UPDATE_KANBAN_TASK, taskId, updates),
});

// Also expose ipcRenderer directly for kanban.html compatibility
contextBridge.exposeInMainWorld('electron', {
	ipcRenderer: {
		invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
		send: (channel, ...args) => ipcRenderer.send(channel, ...args),
		on: (channel, listener) => ipcRenderer.on(channel, listener),
		off: (channel, listener) => ipcRenderer.off(channel, listener),
	},
});
