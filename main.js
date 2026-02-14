const { app, BrowserWindow, screen } = require('electron');

// Force ANGLE Metal backend before any window is created
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-features', 'Metal');

const winW = 400;
const winH = 600;
let win = null;
let currentDisplayId = null;

function getBottomLeftPosition(display) {
	const { x, y, height } = display.bounds;
	return {
		x: x + 40,
		y: y + height - winH,
	};
}

function moveToDisplay(display) {
	if (!win || display.id === currentDisplayId) return;
	currentDisplayId = display.id;
	const pos = getBottomLeftPosition(display);
	win.setPosition(pos.x, pos.y, false);
}

function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const pos = getBottomLeftPosition(primaryDisplay);
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: winW,
		height: winH,
		x: pos.x,
		y: pos.y,
		transparent: true,
		frame: false,
		hasShadow: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		focusable: false,
		webPreferences: {
			webgl: true,
			webSecurity: true,
		},
	});

	win.setIgnoreMouseEvents(true, { forward: true });
	win.loadFile('index.html');

	// Poll cursor position to follow it across displays
	setInterval(() => {
		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		moveToDisplay(display);
	}, 500);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
	app.quit();
});
