const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	getApiKey: () => ipcRenderer.invoke('get-api-key'),
	onToggleVoice: (cb) => ipcRenderer.on('toggle-voice', cb),
	executeTool: (name, args) => ipcRenderer.invoke('execute-tool', name, args),
	captureScreen: () => ipcRenderer.invoke('capture-screen'),
});
