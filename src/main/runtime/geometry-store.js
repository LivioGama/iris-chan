const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createJsonStore } = require('../../shared/json-store');

const STORE_PATH = path.join(os.homedir(), '.iris', 'window-geometry.json');
const KANBAN_LEGACY_PATH = path.join(os.homedir(), '.iris', 'kanban-geometry.json');
const store = createJsonStore(STORE_PATH, { windows: {} });

async function migrateLegacy() {
	try {
		if (fs.existsSync(KANBAN_LEGACY_PATH)) {
			const data = JSON.parse(fs.readFileSync(KANBAN_LEGACY_PATH, 'utf8'));
			const windows = (await store.get('windows')) || {};
			if (!windows.kanban) {
				windows.kanban = data;
				await store.set('windows', windows);
			}
			// We keep the file for safety/backward compatibility for now, 
			// but the store will be the source of truth.
		}
	} catch (err) {
		// Silent fail
	}
}

// Run migration on load
migrateLegacy();

async function getGeometry(windowId) {
	const windows = await store.get('windows');
	return windows?.[windowId] || null;
}

async function setGeometry(windowId, bounds) {
	const windows = (await store.get('windows')) || {};
	windows[windowId] = {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
	};
	await store.set('windows', windows);
	return windows[windowId];
}

module.exports = { getGeometry, setGeometry, STORE_PATH };
