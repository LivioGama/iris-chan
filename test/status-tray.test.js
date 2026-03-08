const assert = require('node:assert');

const { createTrayController } = require('../src/main/status-tray');

console.log('Running status tray tests...');

function createFakeWindow({ visible = true } = {}) {
	const listeners = new Map();
	return {
		visible,
		destroyed: false,
		focused: false,
		hiddenCount: 0,
		shownCount: 0,
		isVisible() {
			return this.visible;
		},
		isDestroyed() {
			return this.destroyed;
		},
		hide() {
			this.visible = false;
			this.hiddenCount += 1;
			this.emit('hide');
		},
		show() {
			this.visible = true;
			this.shownCount += 1;
			this.emit('show');
		},
		showInactive() {
			this.show();
		},
		focus() {
			this.focused = true;
		},
		on(eventName, handler) {
			if (!listeners.has(eventName)) listeners.set(eventName, []);
			listeners.get(eventName).push(handler);
		},
		emit(eventName) {
			for (const handler of listeners.get(eventName) || []) handler();
		},
	};
}

class FakeTray {
	constructor(icon) {
		this.icon = icon;
		this.tooltip = null;
		this.title = null;
		this.contextMenu = null;
		this.ignoreDoubleClicks = false;
		this.destroyed = false;
	}

	setToolTip(text) {
		this.tooltip = text;
	}

	setTitle(text) {
		this.title = text;
	}

	setContextMenu(menu) {
		this.contextMenu = menu;
	}

	setIgnoreDoubleClickEvents(value) {
		this.ignoreDoubleClicks = value;
	}

	destroy() {
		this.destroyed = true;
	}
}

const electron = {
	app: {
		quitCalls: 0,
		quit() {
			this.quitCalls += 1;
		},
	},
	Menu: {
		buildFromTemplate(template) {
			return { template };
		},
	},
	Tray: FakeTray,
	nativeImage: {
		createFromDataURL(dataUrl) {
			return {
				dataUrl,
				template: false,
				resize() {
					return this;
				},
				setTemplateImage(value) {
					this.template = value;
				},
			};
		},
	},
};

const avatarWin = createFakeWindow({ visible: true });
const kanbanModule = {
	createdCount: 0,
	current: createFakeWindow({ visible: false }),
	get() {
		return this.current;
	},
	create() {
		this.createdCount += 1;
		this.current = createFakeWindow({ visible: true });
		return this.current;
	},
};
const logs = [];
const controller = createTrayController({
	electron,
	avatarWindowModule: { get: () => avatarWin },
	kanbanWindowModule: kanbanModule,
	logModule: { info: (tag, message) => logs.push([tag, message]) },
});

const tray = controller.create();
assert.ok(tray, 'tray should be created');
assert.strictEqual(tray.tooltip, 'Iris', 'tray should expose an Iris tooltip');
assert.strictEqual(tray.ignoreDoubleClicks, true, 'tray should ignore double click events');
assert.deepStrictEqual(logs, [['Tray', 'Status tray initialized']], 'tray init should be logged');

let labels = tray.contextMenu.template.map((item) => item.label || item.type);
assert.deepStrictEqual(
	labels,
	['Hide Avatar', 'Show Kanban', 'Show All', 'separator', 'Quit Iris'],
	'tray should reflect current window visibility',
);

tray.contextMenu.template[0].click();
assert.strictEqual(avatarWin.visible, false, 'avatar item should hide the overlay window');

labels = tray.contextMenu.template.map((item) => item.label || item.type);
assert.deepStrictEqual(
	labels,
	['Show Avatar', 'Show Kanban', 'Show All', 'separator', 'Quit Iris'],
	'menu should refresh after hiding the avatar',
);

tray.contextMenu.template[1].click();
assert.strictEqual(kanbanModule.current.visible, true, 'kanban item should show the board');
assert.strictEqual(kanbanModule.current.focused, true, 'kanban item should focus the board when shown');

tray.contextMenu.template[2].click();
assert.strictEqual(avatarWin.visible, true, 'Show All should restore the avatar');
assert.strictEqual(kanbanModule.current.visible, true, 'Show All should keep kanban visible');

labels = tray.contextMenu.template.map((item) => item.label || item.type);
assert.deepStrictEqual(
	labels,
	['Hide Avatar', 'Hide Kanban', 'Show All', 'separator', 'Quit Iris'],
	'menu should refresh after showing both windows',
);
assert.strictEqual(tray.contextMenu.template[2].enabled, false, 'Show All should disable once everything is visible');

kanbanModule.current.destroyed = true;
controller.refreshMenu();
tray.contextMenu.template[1].click();
assert.strictEqual(kanbanModule.createdCount, 1, 'tray should recreate a destroyed kanban window');
assert.strictEqual(kanbanModule.current.visible, true, 'recreated kanban window should be shown');

tray.contextMenu.template[4].click();
assert.strictEqual(electron.app.quitCalls, 1, 'Quit Iris should request application shutdown');
assert.strictEqual(controller.shouldKeepAlive(), false, 'controller should stop keeping the app alive once quit is requested');

controller.destroy();
assert.strictEqual(tray.destroyed, true, 'destroy should tear down the tray instance');

console.log('Status tray tests passed.');
