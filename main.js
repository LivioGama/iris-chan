const { app, BrowserWindow, screen, ipcMain, session, systemPreferences, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// Force ANGLE Metal backend before any window is created
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-features', 'Metal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Load API key from .env or process.env
let apiKey = process.env.GEMINI_API_KEY || '';
try {
	const envPath = path.join(__dirname, '.env');
	const envContent = fs.readFileSync(envPath, 'utf-8');
	for (const line of envContent.split('\n')) {
		const match = line.match(/^GEMINI_API_KEY=(.+)$/);
		if (match) apiKey = match[1].trim();
	}
} catch {}

const toolExecutor = require('./tool-executor');
const screenCapture = require('./screen-capture');

ipcMain.handle('get-api-key', () => apiKey);
ipcMain.handle('execute-tool', (_, name, args) => toolExecutor.execute(name, args));
ipcMain.handle('capture-screen', () => screenCapture.capture());

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
			preload: path.join(__dirname, 'preload.js'),
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

app.whenReady().then(async () => {
	// Request mic permission on macOS
	if (process.platform === 'darwin') {
		await systemPreferences.askForMediaAccess('microphone');
	}

	// Grant media permissions automatically
	session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
		if (permission === 'media') {
			callback(true);
		} else {
			callback(false);
		}
	});

	createWindow();

	// Ctrl+I toggles voice on/off
	globalShortcut.register('CommandOrControl+I', () => {
		if (win) win.webContents.send('toggle-voice');
	});

	// Hot reload: watch renderer files and reload window on change
	const watchFiles = ['index.html', 'voice-pipeline.js', 'gemini-client.js', 'audio-capture.js', 'audio-playback.js', 'screen-capture.js', 'tool-executor.js'];
	let reloadTimeout = null;
	for (const file of watchFiles) {
		fs.watch(path.join(__dirname, file), () => {
			clearTimeout(reloadTimeout);
			reloadTimeout = setTimeout(() => {
				if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache();
			}, 300);
		});
	}
});

app.on('window-all-closed', () => {
	app.quit();
});
