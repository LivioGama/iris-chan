const path = require('node:path');
const os = require('node:os');
const { createJsonStore } = require('../../shared/json-store');

const STORE_PATH = path.join(os.homedir(), '.iris', 'window-geometry.json');
const store = createJsonStore(STORE_PATH, { windows: {} });

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
