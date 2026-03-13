const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'electron') {
		return {
			BrowserWindow: function BrowserWindow() {},
			screen: {
				getPrimaryDisplay() {
					return { id: 1, bounds: { x: 0, y: 0, height: 1080 } };
				},
			},
		};
	}
	if (request === '../logger') {
		return { captureRendererConsole() {} };
	}
	return originalLoad.apply(this, arguments);
};

const avatarWindow = require('../src/main/windows/avatar-window');
Module._load = originalLoad;

assert.ok(avatarWindow);
assert.strictEqual(typeof avatarWindow.create, 'function');
assert.strictEqual(typeof avatarWindow.get, 'function');
