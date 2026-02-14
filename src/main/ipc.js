// All ipcMain handler registrations (thin dispatch layer)
const { ipcMain } = require('electron');
const ch = require('../shared/channels');
const toolExecutor = require('./tools');
const screenCapture = require('./screen-capture');
const vocabStore = require('./vocab/store');
const searchWindow = require('./windows/search-window');

function register(apiKey) {
	ipcMain.handle(ch.GET_API_KEY, () => apiKey);
	ipcMain.handle(ch.EXECUTE_TOOL, (_, name, args) => toolExecutor.execute(name, args));
	ipcMain.handle(ch.CAPTURE_SCREEN, () => screenCapture.capture());

	// Vocabulary tracking
	ipcMain.on(ch.TRACK_VOCABULARY, (_, terms) => vocabStore.trackTerms(terms));
	ipcMain.handle(ch.GET_VOCABULARY, () => vocabStore.loadTerms());
	ipcMain.handle(ch.GET_HOT_VOCABULARY, () => Object.keys(vocabStore.loadHot()));
	ipcMain.handle(ch.GET_VOCABULARY_STATS, () => vocabStore.loadStats());
	ipcMain.handle(ch.GET_VOCABULARY_CORRECTIONS, () => vocabStore.loadCorrections());
	ipcMain.handle(ch.GET_VOCABULARY_CORE, () => vocabStore.loadCore());
	ipcMain.on(ch.ADD_CORRECTION, (_, wrong, right) => vocabStore.addCorrection(wrong, right));

	// Search overlay
	ipcMain.on(ch.SEARCH_SPINNER, (_, query) => searchWindow.show(query, null));
	ipcMain.on(ch.SEARCH_RESULT, (_, query, content) => searchWindow.show(query, content));
	ipcMain.on(ch.SEARCH_HIDE, () => searchWindow.hide());
}

module.exports = { register };
