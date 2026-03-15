const assert = require('node:assert');
const Module = require('node:module');

console.log('Running avatar window tests...');

const originalLoad = Module._load;
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

let nextTimerId = 1;
const activeTimers = new Set();
const clearedTimers = [];
const createdWindows = [];

class FakeBrowserWindow {
	constructor(options) {
		this.options = options;
		this.destroyed = false;
		this.listeners = new Map();
		this.webContents = {
			on: () => {},
		};
		createdWindows.push(this);
	}

	setIgnoreMouseEvents() {}

	loadFile(filePath) {
		this.loadedFile = filePath;
	}

	setPosition(x, y, animate) {
		this.position = { x, y, animate };
	}

	on(eventName, handler) {
		if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
		this.listeners.get(eventName).push(handler);
	}

	emit(eventName) {
		for (const handler of this.listeners.get(eventName) || []) handler();
	}

	setBounds(bounds) {
		this.bounds = bounds;
	}

	show() {
		this.visible = true;
	}

	isDestroyed() {
		return this.destroyed;
	}

	destroy() {
		this.destroyed = true;
		this.emit('closed');
	}
}

global.setInterval = (fn, delay) => {
	const timer = { id: nextTimerId += 1, fn, delay };
	activeTimers.add(timer);
	return timer;
};

global.clearInterval = (timer) => {
	if (!timer) return;
	clearedTimers.push(timer);
	activeTimers.delete(timer);
};

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'electron') {
		return {
			BrowserWindow: FakeBrowserWindow,
			screen: {
				getPrimaryDisplay() {
					return { id: 1, bounds: { x: 0, y: 0, height: 1080 } };
				},
				getCursorScreenPoint() {
					return { x: 10, y: 10 };
				},
				getDisplayNearestPoint() {
					return { id: 1, bounds: { x: 0, y: 0, height: 1080 } };
				},
			},
		};
	}
	if (request === '../logger') {
		return { captureRendererConsole() {} };
	}
	if (request === '../runtime/geometry-store') {
		return {
			getGeometry: () => Promise.resolve(null),
			setGeometry: () => Promise.resolve(),
		};
	}
	return originalLoad.apply(this, arguments);
};

const avatarWindow = require('../src/main/windows/avatar-window');

const first = avatarWindow.create();
assert.ok(first, 'create should return a BrowserWindow instance');

setTimeout(() => {
	assert.strictEqual(activeTimers.size, 1, 'create should start one display polling timer');

	const second = avatarWindow.create();
	assert.strictEqual(second, first, 'create should reuse the existing live window');
	assert.strictEqual(activeTimers.size, 1, 'recreating a live window must not add another timer');

	first.destroy();
	assert.strictEqual(activeTimers.size, 0, 'closing the window should clear the display polling timer');
	assert.strictEqual(clearedTimers.length, 1, 'closing should clear the active timer exactly once');
	assert.strictEqual(avatarWindow.get(), null, 'closed window should be released from the module cache');

	const third = avatarWindow.create();
	assert.notStrictEqual(third, first, 'create after close should build a new BrowserWindow');

	setTimeout(() => {
		assert.strictEqual(activeTimers.size, 1, 'recreated window should start a fresh timer');
		assert.strictEqual(createdWindows.length, 2, 'only two BrowserWindow instances should be created across the lifecycle');

		Module._load = originalLoad;
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;

		console.log('Avatar window tests passed.');
	}, 50);
}, 50);
