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

// On startup, reset orphaned IN_PROGRESS tasks to PENDING (they were interrupted by app restart)
function resetOrphanedTasks() {
	const tasksPath = path.join(process.cwd(), 'tasks.json');
	try {
		if (!fs.existsSync(tasksPath)) return;
		const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		const tasks = data.tasks || [];
		let resetCount = 0;
		for (const task of tasks) {
			if (task.status === 'IN_PROGRESS') {
				task.status = 'PENDING';
				task.logs = (task.logs || '') + '\n⚠️ Reset from IN_PROGRESS (app restarted during execution)';
				task.updatedAt = new Date().toISOString();
				resetCount++;
			}
		}
		if (resetCount > 0) {
			data.updatedAt = new Date().toISOString();
			fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');
			log.info('Kanban', `Reset ${resetCount} orphaned IN_PROGRESS tasks to PENDING`);
		}
	} catch (err) {
		log.warn('Kanban', `Could not reset orphaned tasks: ${err.message}`);
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

	// Load the kanban board HTML
	win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'kanban.html'));

	// Forward renderer console output to unified log
	win.webContents.on('console-message', (ev) => {
		const m = ev.message;
		if (!m) return;
		const level = ev.level >= 3 ? 'error' : ev.level >= 2 ? 'warn' : 'info';
		log[level]('Kanban', m);
	});

	// Reset orphaned IN_PROGRESS tasks from previous session, then watch for changes
	resetOrphanedTasks();
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