// Search overlay window management
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('../../shared/config');

let searchWin = null;
let searchHideTimeout = null;

function show(query, content) {
	const cursor = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursor);
	const { width: dw, height: dh } = display.workAreaSize;
	const { x: dx, y: dy } = display.workArea;
	const ow = Math.min(650, dw - 80);
	const oh = Math.min(520, dh - 80);

	if (!searchWin || searchWin.isDestroyed()) {
		searchWin = new BrowserWindow({
			width: ow,
			height: oh,
			x: dx + Math.round((dw - ow) / 2),
			y: dy + Math.round((dh - oh) / 2),
			transparent: true,
			frame: false,
			hasShadow: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			resizable: false,
			focusable: true,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});
		searchWin.loadFile(path.join(__dirname, '..', '..', 'renderer', 'search-overlay', 'index.html'));
		searchWin.webContents.on('did-finish-load', () => {
			if (content !== null) {
				searchWin.webContents.send('search-result', query, content);
			} else {
				searchWin.webContents.send('search-spinner', query);
			}
		});
	} else {
		searchWin.setBounds({
			x: dx + Math.round((dw - ow) / 2),
			y: dy + Math.round((dh - oh) / 2),
			width: ow,
			height: oh,
		});
		searchWin.show();
		if (content !== null) {
			searchWin.webContents.send('search-result', query, content);
		} else {
			searchWin.webContents.send('search-spinner', query);
		}
	}

	clearTimeout(searchHideTimeout);
	if (content !== null) {
		searchHideTimeout = setTimeout(() => hide(), config.search.autoHideMs);
	}
}

function hide() {
	clearTimeout(searchHideTimeout);
	if (searchWin && !searchWin.isDestroyed()) {
		searchWin.webContents.send('search-hide');
		setTimeout(() => {
			if (searchWin && !searchWin.isDestroyed()) searchWin.hide();
		}, 350);
	}
}

module.exports = { show, hide };
