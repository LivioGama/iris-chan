// Kanban overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const config = require('../../shared/config');
const log = require('../logger');

let win = null;
let currentDisplayId = null;

function getTopCenteredPosition(display) {
	const { x, y, width } = display.bounds;
	return {
		x: x + (width - 900) / 2,
		y: y + 40,
	};
}

function moveToDisplay(display) {
	if (!win || display.id === currentDisplayId) return;
	currentDisplayId = display.id;
	const pos = getTopCenteredPosition(display);
	win.setPosition(pos.x, pos.y, false);
}

function create() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const pos = getTopCenteredPosition(primaryDisplay);
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: 900,
		height: 440,
		x: pos.x,
		y: pos.y,
		transparent: true,
		frame: false,
		hasShadow: true,
		alwaysOnTop: true,
		skipTaskbar: false,
		resizable: true,
		focusable: true,
		vibrancy: 'under-window',
		visualEffectState: 'active',
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, '..', '..', 'preload.js'),
		},
	});

	// Load the kanban board HTML
	win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'kanban.html'));

	// Forward renderer console output to unified log
	win.webContents.on('console-message', (ev) => {
		const m = ev.message;
		if (!m) return;
		const level = ev.level <= 0 ? 'info' : ev.level === 1 ? 'warn' : 'error';
		log[level]('Kanban', m);
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