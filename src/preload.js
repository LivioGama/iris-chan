// Context bridge — uses shared channel names
const { contextBridge, ipcRenderer } = require('electron');
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
	};
}

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
});
