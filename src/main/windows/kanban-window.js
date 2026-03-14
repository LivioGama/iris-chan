// Kanban overlay window creation & display tracking
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../../shared/config').default;
const log = require('../logger');
const { getGeometry, setGeometry } = require('../runtime/geometry-store');

let win = null;
let currentDisplayId = null;

async function saveGeometry() {
	if (!win || win.isDestroyed()) return;
	try {
		const bounds = win.getBounds();
		await setGeometry('kanban', bounds);
	} catch { }
}

function getDefaultPosition(display) {
	const { x, y, width } = display.bounds;
	return {
		x: x + width - 740, // right side of screen
		y: y + 40,
	};
}

function resumeInterruptedTasks() {
	try {
		const fixProject = require('../tools/fix-project');
		const result = fixProject.resumeImmediateTasks({ cwd: process.cwd() });
		if (result?.resumed) {
			log.info('Kanban', `Resumed ${result.resumed} interrupted immediate task(s)`);
		}
	} catch (err) {
		log.warn('Kanban', `Could not resume interrupted tasks: ${err.message}`);
	}
}

let watchDebounce = null;

function watchTasksFile() {
	const tasksPath = path.join(process.cwd(), 'tasks.json');

	try {
		// Use fs.watchFile with polling — 2s interval to reduce spam during SDK execution
		fs.watchFile(tasksPath, { interval: 2000 }, (curr, prev) => {
			// Only trigger if the file actually changed (size or mtime different)
			if (curr.size !== prev.size || curr.mtime !== prev.mtime) {
				// Debounce notifications to avoid rapid successive reloads
				clearTimeout(watchDebounce);
				watchDebounce = setTimeout(() => {
					if (win && !win.isDestroyed()) {
						log.info('Kanban', 'Tasks file changed, notifying renderer');
						win.webContents.send('tasks-file-updated');
					}
				}, 800);
			}
		});
		log.info('Kanban', 'Watching tasks.json for changes');
	} catch (err) {
		log.warn('Kanban', `Could not watch tasks.json: ${err.message}`);
	}
}

function create() {
	const primaryDisplay = screen.getPrimaryDisplay();
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: 720,
		height: 200,
		transparent: true,
		frame: false,
		show: false, // Don't show until geometry loaded
		hasShadow: true,
		alwaysOnTop: false,
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

	// Load geometry and apply
	getGeometry('kanban').then(saved => {
		if (win && !win.isDestroyed()) {
			const pos = saved || getDefaultPosition(primaryDisplay);
			win.setBounds({
				x: pos.x,
				y: pos.y,
				width: saved?.width || 720,
				height: saved?.height || 200
			});
			win.show();
		}
	});

	// Load the kanban board HTML
	win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'kanban.html'));

	// Forward renderer console output to unified log
	win.webContents.on('console-message', (ev) => {
		const m = ev.message;
		if (!m) return;
		const level = ev.level >= 3 ? 'error' : ev.level >= 2 ? 'warn' : 'info';
		log[level]('Kanban', m);
	});

	// Resume immediate tasks from the previous session, then watch for changes
	resumeInterruptedTasks();
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
