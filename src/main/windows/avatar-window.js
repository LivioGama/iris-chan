// Avatar overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const config = require('../../shared/config').default;
const log = require('../logger');
const { getGeometry, setGeometry } = require('../runtime/geometry-store');

let win = null;
let currentDisplayId = null;
let displayPollTimer = null;
let initialized = false;

async function saveGeometry() {
	if (!initialized || !win || win.isDestroyed()) return;
	try {
		const bounds = win.getBounds();
		await setGeometry('avatar', bounds);
	} catch { }
}

function getBottomLeftPosition(display) {
	const { x, y, height } = display.bounds;
	// Push window past screen bottom so empty space below the 3D model is off-screen
	const bottomOverflow = 80;
	return {
		x: x - 60,
		y: y + height - config.window.avatarHeight + bottomOverflow,
	};
}

function moveToDisplay(display) {
	if (!win || display.id === currentDisplayId) return;
	currentDisplayId = display.id;
	const pos = getBottomLeftPosition(display);
	win.setPosition(pos.x, pos.y, false);
}

function stopDisplayPolling() {
	if (!displayPollTimer) return;
	clearInterval(displayPollTimer);
	displayPollTimer = null;
}

function startDisplayPolling() {
	stopDisplayPolling();
	displayPollTimer = setInterval(() => {
		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		moveToDisplay(display);
	}, 500);
}

function create() {
	if (win && typeof win.isDestroyed === 'function' && !win.isDestroyed()) {
		return win;
	}

	const primaryDisplay = screen.getPrimaryDisplay();
	currentDisplayId = primaryDisplay.id;
	win = new BrowserWindow({
		width: config.window.avatarWidth,
		height: config.window.avatarHeight,
		transparent: true,
		frame: false,
		show: false, // Wait for geometry
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

	// Load geometry and apply
	getGeometry('avatar').then(saved => {
		if (win && !win.isDestroyed()) {
			const pos = saved || getBottomLeftPosition(primaryDisplay);
			win.setBounds({
				x: pos.x,
				y: pos.y,
				width: config.window.avatarWidth,
				height: config.window.avatarHeight
			});
			win.show();

			// Defer listener attachment by one tick so the setBounds 'move' event
			// doesn't immediately trigger a save
			setImmediate(() => {
				initialized = true;
				let geoDebounce = null;
				const persistGeo = () => { clearTimeout(geoDebounce); geoDebounce = setTimeout(saveGeometry, 300); };
				win.on('resize', persistGeo);
				win.on('move', persistGeo);
				startDisplayPolling();
			});
		}
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
		log.captureRendererConsole(level, 'Renderer', m);
	});

	win.on('closed', () => {
		stopDisplayPolling();
		initialized = false;
		win = null;
		currentDisplayId = null;
	});

	return win;
}

function get() {
	return win;
}

module.exports = { create, get };
