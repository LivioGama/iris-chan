// All ipcMain handler registrations (thin dispatch layer)
const { ipcMain } = require('electron');
const ch = require('../shared/channels');
const toolExecutor = require('./tools');
const screenCapture = require('./screen-capture');
const vocabStore = require('./vocab/store');
const searchWindow = require('./windows/search-window');
const skills = require('./skills');
const avatarWindow = require('./windows/avatar-window');
const log = require('./logger');
const config = require('../shared/config');

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

	ipcMain.handle(ch.GET_SKILL_DECLARATIONS, () => skills.getDeclarations());
	ipcMain.handle(ch.GET_SKILL_PROMPTS, () => skills.getSystemPrompts());
	ipcMain.handle(ch.GET_SKILL_CATALOG, () => skills.getCatalog());

	ipcMain.on(ch.SET_IGNORE_MOUSE, (_, ignore) => {
		const win = avatarWindow.get();
		if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
	});

	// Renderer log forwarding
	ipcMain.on(ch.LOG_TO_FILE, (_, level, tag, message) => {
		if (level === 'error') log.error(tag, message);
		else if (level === 'warn') log.warn(tag, message);
		else log.info(tag, message);
	});

	ipcMain.handle(ch.KILL_SKILL, () => skills.killSkill());

	ipcMain.handle(ch.RELOAD_SESSION, () => {
		toolExecutor.reload();
		skills.scan();
		const win = avatarWindow.get();
		if (win) win.webContents.send(ch.RELOAD_SESSION);
		return { ok: true };
	});

	// Avatar configuration
	ipcMain.handle('get-avatar-config', () => config.avatar);

	ipcMain.handle(ch.TOGGLE_AVATAR, () => {
		// Toggle between 'tripo3d' and 'original'
		const current = config.avatar.current;
		config.avatar.current = current === 'tripo3d' ? 'original' : 'tripo3d';
		log.info('Avatar', `Switched to ${config.avatar.current}`);

		// Reload the avatar window
		const win = avatarWindow.get();
		if (win) {
			win.reload();
		}

		return config.avatar.current;
	});
}

module.exports = { register };
