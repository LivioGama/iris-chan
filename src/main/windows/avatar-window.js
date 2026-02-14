// Avatar overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('../../shared/config');

let win = null;
let currentDisplayId = null;

function getBottomLeftPosition(display) {
	const { x, y, height } = display.bounds;
	return {
		x: x + 40,
		y: y + height - config.window.avatarHeight,
	};
}

function moveToDisplay(display) {
	if (!win || display.id === currentDisplayId) return;
	currentDisplayId = display.id;
	const pos = getBottomLeftPosition(display);
	win.setPosition(pos.x, pos.y, false);
}

function create() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const pos = getBottomLeftPosition(primaryDisplay);
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: config.window.avatarWidth,
		height: config.window.avatarHeight,
		x: pos.x,
		y: pos.y,
		transparent: true,
		frame: false,
		hasShadow: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		focusable: false,
		webPreferences: {
			webgl: true,
			webSecurity: true,
			preload: path.join(__dirname, '..', '..', 'preload.js'),
		},
	});

	win.setIgnoreMouseEvents(true, { forward: true });
	win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

	// Forward renderer console to main process stdout
	win.webContents.on('console-message', (ev) => {
		if (ev.message.startsWith('[Vocab]') || ev.message.startsWith('[Voice]'))
			console.log(ev.message);
	});

	// Poll cursor position to follow it across displays
	setInterval(() => {
		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		moveToDisplay(display);
	}, 500);

	return win;
}

function get() {
	return win;
}

module.exports = { create, get };
