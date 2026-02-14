const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	getApiKey: () => ipcRenderer.invoke('get-api-key'),
	onToggleVoice: (cb) => ipcRenderer.on('toggle-voice', cb),
	executeTool: (name, args) => ipcRenderer.invoke('execute-tool', name, args),
	captureScreen: () => ipcRenderer.invoke('capture-screen'),
	searchSpinner: (query) => ipcRenderer.send('search-spinner', query),
	searchResult: (query, content) => ipcRenderer.send('search-result', query, content),
	searchHide: () => ipcRenderer.send('search-hide'),
	trackVocabulary: (terms) => ipcRenderer.send('track-vocabulary', terms),
	getVocabulary: () => ipcRenderer.invoke('get-vocabulary'),
	getHotVocabulary: () => ipcRenderer.invoke('get-hot-vocabulary'),
	getVocabularyStats: () => ipcRenderer.invoke('get-vocabulary-stats'),
	getVocabularyCorrections: () => ipcRenderer.invoke('get-vocabulary-corrections'),
	getVocabularyCore: () => ipcRenderer.invoke('get-vocabulary-core'),
	addCorrection: (wrong, right) => ipcRenderer.send('add-correction', wrong, right),
	onMessagingAppFocused: (cb) => ipcRenderer.on('messaging-app-focused', (_, app) => cb(app)),
	onMessagingAppLeft: (cb) => ipcRenderer.on('messaging-app-left', cb),
});
