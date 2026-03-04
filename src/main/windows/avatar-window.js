// Avatar overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('../../shared/config').default;
const log = require('../logger');

let win = null;
let currentDisplayId = null;

function getBottomLeftPosition(display) {
	const { x, y, height } = display.bounds;
	return {
		x: x - 60,
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
			sandbox: false,
			preload: path.join(__dirname, '..', '..', 'preload.js'),
		},
	});

	win.setIgnoreMouseEvents(true, { forward: true });
	const rendererPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
	win.loadFile(rendererPath);

	// Forward renderer console output to unified log (skip messages already sent via IPC logToFile)
	win.webContents.on('console-message', (ev) => {
		const m = ev.message;
		if (!m) return;
		// Skip messages already logged via IPC (renderer logger calls console.log then sends IPC)
		// Only forward messages NOT from our renderer logger (those that don't have [Tag] prefix)
		const tagMatch = m.match(/^\[(\w+)\]\s*(.*)/s);
		if (tagMatch) return; // already forwarded by renderer logger via IPC
		const level = ev.level <= 0 ? 'info' : ev.level === 1 ? 'warn' : 'error';
		log[level]('Renderer', m);
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
