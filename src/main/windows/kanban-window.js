// Kanban overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../../shared/config').default;
const log = require('../logger');

let win = null;
let currentDisplayId = null;

const GEOMETRY_PATH = path.join(config.paths.irisDir, 'kanban-geometry.json');

function loadGeometry() {
	try {
		return JSON.parse(fs.readFileSync(GEOMETRY_PATH, 'utf-8'));
	} catch {
		return null;
	}
}

function saveGeometry() {
	if (!win || win.isDestroyed()) return;
	try {
		const bounds = win.getBounds();
		fs.writeFileSync(GEOMETRY_PATH, JSON.stringify(bounds), 'utf-8');
	} catch { }
}

function getDefaultPosition(display) {
	const { x, y, width } = display.bounds;
	return {
		x: x + width - 740, // right side of screen
		y: y + 40,
	};
}

function watchTasksFile() {
	const tasksPath = path.join(process.cwd(), 'tasks.json');

	try {
		// Use fs.watchFile with polling for more reliable detection
		fs.watchFile(tasksPath, { interval: 1000 }, (curr, prev) => {
			// Only trigger if the file actually changed (size or mtime different)
			if (curr.size !== prev.size || curr.mtime !== prev.mtime) {
				if (win && !win.isDestroyed()) {
					log.info('Kanban', 'Tasks file changed, notifying renderer');
					win.webContents.send('tasks-file-updated');
				}
			}
		});
		log.info('Kanban', 'Watching tasks.json for changes');
	} catch (err) {
		log.warn('Kanban', `Could not watch tasks.json: ${err.message}`);
	}
}

function create() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const saved = loadGeometry();
	const pos = saved || getDefaultPosition(primaryDisplay);
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: saved?.width || 720,
		height: saved?.height || 200,
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
			sandbox: false,
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

	// Watch tasks.json for changes
	watchTasksFile();

	// Save geometry on resize/move (debounced)
	let geoDebounce = null;
	const persistGeo = () => { clearTimeout(geoDebounce); geoDebounce = setTimeout(saveGeometry, 300); };
	win.on('resize', persistGeo);
	win.on('move', persistGeo);

	// Clean up file watcher on window close
	win.on('closed', () => {
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		fs.unwatchFile(tasksPath);
	});

	return win;
}

function get() {
	return win;
}

module.exports = { create, get };