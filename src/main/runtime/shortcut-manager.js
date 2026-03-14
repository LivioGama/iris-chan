const { globalShortcut } = require('electron');
const avatarWindow = require('../windows/avatar-window');
const kanbanWindow = require('../windows/kanban-window');
const settings = require('../settings');

function registerShortcuts({ behaviorEngine }) {
	globalShortcut.register('CommandOrControl+I', () => {
		const w = avatarWindow.get();
		if (w) w.webContents.send('toggle-voice');
	});

	globalShortcut.register('CommandOrControl+K', () => {
		const kWin = kanbanWindow.get();
		if (kWin) {
			if (kWin.isVisible()) {
				kWin.hide();
			} else {
				kWin.showInactive();
				kWin.focus();
			}
		}
	});

	globalShortcut.register('CommandOrControl+Shift+M', () => {
		const nextMode = behaviorEngine.getMode() === 'proactive' ? 'silent' : 'proactive';
		settings.updateSettings({ behavior: { mode: nextMode } }, { source: 'shortcut:mode-toggle' });
	});

	globalShortcut.register('CommandOrControl+Shift+D', () => {
		const next = !behaviorEngine.getDirectMode();
		settings.updateSettings({ behavior: { directMode: next } }, { source: 'shortcut:direct-mode-toggle' });
	});
}

function unregisterShortcuts() {
	globalShortcut.unregisterAll();
}

module.exports = { registerShortcuts, unregisterShortcuts };
