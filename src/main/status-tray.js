const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR42mNgGKzgPw5MtkaiDcKniKABxNiAVw2x/hwJBpAdiBRHI1USEsVJmf4AAE67R7lG/1fUAAAAAElFTkSuQmCC';

function createTrayController({
	electron,
	avatarWindowModule,
	kanbanWindowModule,
	logModule,
} = {}) {
	const { app, Menu, Tray, nativeImage } = electron || require('electron');
	const avatarWindow = avatarWindowModule || require('./windows/avatar-window');
	const kanbanWindow = kanbanWindowModule || require('./windows/kanban-window');
	const log = logModule || require('./logger');

	let tray = null;
	let isQuitting = false;

	function getWindow(module, { createIfMissing = false } = {}) {
		if (!module || typeof module.get !== 'function') return null;
		const win = module.get();
		if (createIfMissing && (!win || isWindowDestroyed(win)) && typeof module.create === 'function') {
			const created = module.create();
			bindWindowVisibility(created);
			return created;
		}
		return win;
	}

	function isWindowDestroyed(win) {
		if (!win) return true;
		if (typeof win.isDestroyed === 'function') return win.isDestroyed();
		return false;
	}

	function isWindowVisible(win) {
		if (!win || isWindowDestroyed(win)) return false;
		if (typeof win.isVisible === 'function') return win.isVisible();
		return Boolean(win.visible);
	}

	function showWindow(win, { focus = false } = {}) {
		if (!win || isWindowDestroyed(win)) return false;
		if (typeof win.isMinimized === 'function' && win.isMinimized()) {
			win.restore?.();
		}
		if (!isWindowVisible(win)) {
			if (!focus && typeof win.showInactive === 'function') win.showInactive();
			else win.show?.();
		}
		if (focus) win.focus?.();
		return true;
	}

	function hideWindow(win) {
		if (!win || isWindowDestroyed(win) || !isWindowVisible(win)) return false;
		win.hide?.();
		return true;
	}

	function getVisibilityState() {
		return {
			avatarVisible: isWindowVisible(getWindow(avatarWindow)),
			kanbanVisible: isWindowVisible(getWindow(kanbanWindow)),
		};
	}

	function showAvatar() {
		return showWindow(getWindow(avatarWindow, { createIfMissing: true }));
	}

	function toggleAvatar() {
		const win = getWindow(avatarWindow);
		if (isWindowVisible(win)) {
			hideWindow(win);
			return 'hidden';
		}
		showAvatar();
		return 'shown';
	}

	function showKanban() {
		return showWindow(getWindow(kanbanWindow, { createIfMissing: true }), { focus: true });
	}

	function toggleKanban() {
		const win = getWindow(kanbanWindow);
		if (isWindowVisible(win)) {
			hideWindow(win);
			return 'hidden';
		}
		showKanban();
		return 'shown';
	}

	function showAll() {
		showAvatar();
		showKanban();
	}

	function requestQuit() {
		isQuitting = true;
		app.quit();
	}

	function buildMenuTemplate() {
		const { avatarVisible, kanbanVisible } = getVisibilityState();
		return [
			{
				label: avatarVisible ? 'Hide Avatar' : 'Show Avatar',
				click: () => {
					toggleAvatar();
					refreshMenu();
				},
			},
			{
				label: kanbanVisible ? 'Hide Kanban' : 'Show Kanban',
				click: () => {
					toggleKanban();
					refreshMenu();
				},
			},
			{
				label: 'Show All',
				enabled: !avatarVisible || !kanbanVisible,
				click: () => {
					showAll();
					refreshMenu();
				},
			},
			{ type: 'separator' },
			{
				label: 'Quit Iris',
				click: requestQuit,
			},
		];
	}

	function refreshMenu() {
		if (!tray) return null;
		const menu = Menu.buildFromTemplate(buildMenuTemplate());
		tray.setContextMenu(menu);
		return menu;
	}

	function bindWindowVisibility(win) {
		if (!win || isWindowDestroyed(win) || typeof win.on !== 'function' || win.__irisTrayBound) return;
		win.__irisTrayBound = true;
		for (const eventName of ['show', 'hide', 'closed']) {
			win.on(eventName, () => refreshMenu());
		}
	}

	function buildIcon() {
		const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
		const resized = typeof icon.resize === 'function'
			? icon.resize(process.platform === 'darwin' ? { width: 18, height: 18 } : { width: 16, height: 16 })
			: icon;
		if (process.platform === 'darwin' && typeof resized.setTemplateImage === 'function') {
			resized.setTemplateImage(true);
		}
		return resized;
	}

	function create() {
		if (tray) return tray;
		tray = new Tray(buildIcon());
		app.on?.('before-quit', () => {
			isQuitting = true;
		});
		tray.setToolTip('Iris');
		if (process.platform === 'darwin' && typeof tray.setTitle === 'function') {
			tray.setTitle('Iris');
		}
		if (typeof tray.setIgnoreDoubleClickEvents === 'function') {
			tray.setIgnoreDoubleClickEvents(true);
		}
		bindWindowVisibility(getWindow(avatarWindow));
		bindWindowVisibility(getWindow(kanbanWindow));
		refreshMenu();
		log.info('Tray', 'Status tray initialized');
		return tray;
	}

	function destroy() {
		if (!tray) return;
		tray.destroy?.();
		tray = null;
	}

	return {
		create,
		destroy,
		refreshMenu,
		buildMenuTemplate,
		showAll,
		hasTray: () => Boolean(tray),
		shouldKeepAlive: () => Boolean(tray) && !isQuitting,
	};
}

module.exports = { createTrayController };
