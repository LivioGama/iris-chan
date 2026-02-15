// Suppress EPIPE crashes (broken stdout/stderr pipe in packaged Electron)
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
process.on('uncaughtException', (err) => {
	if (err.code === 'EPIPE') return;
	try { require('./logger').error('Uncaught', err.stack || err.message); } catch {}
});

// App lifecycle only: ready, quit, permissions
const { app, session, systemPreferences, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Force ANGLE Metal backend before any window is created
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-features', 'Metal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Load API keys from .env or process.env
let apiKey = process.env.GEMINI_API_KEY || '';
let ollamaApiKey = process.env.OLLAMA_API_KEY || '';
try {
	const envPath = path.join(__dirname, '..', '..', '.env');
	const envContent = fs.readFileSync(envPath, 'utf-8');
	for (const line of envContent.split('\n')) {
		const geminiMatch = line.match(/^GEMINI_API_KEY=(.+)$/);
		if (geminiMatch) apiKey = geminiMatch[1].trim();
		const ollamaMatch = line.match(/^OLLAMA_API_KEY=(.+)$/);
		if (ollamaMatch) ollamaApiKey = ollamaMatch[1].trim();
	}
} catch {}

// Make API keys available to skill scripts (child processes)
process.env.GEMINI_API_KEY = apiKey;
process.env.OLLAMA_API_KEY = ollamaApiKey;

const ipc = require('./ipc');
const avatarWindow = require('./windows/avatar-window');
const vocabStore = require('./vocab/store');
const vocabMonitor = require('./vocab/monitor');
const skills = require('./skills');
skills.scan();

// Register all IPC handlers
ipc.register(apiKey);

// Sync vocabulary from source
vocabStore.syncFromSource();

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

	// Set mic input volume to max
	exec('osascript -e "set volume input volume 100"', () => {});

	const win = avatarWindow.create();
	vocabMonitor.start(apiKey, () => avatarWindow.get());

	// Ctrl+I toggles voice on/off
	globalShortcut.register('CommandOrControl+I', () => {
		if (win) win.webContents.send('toggle-voice');
	});

	// Ctrl+Shift+A toggles between avatars
	globalShortcut.register('CommandOrControl+Shift+A', () => {
		if (win) {
			win.webContents.invoke('toggle-avatar').then(newAvatarType => {
				console.log(`Avatar toggled to: ${newAvatarType}`);
			});
		}
	});
});

// Watch tool modules for changes and auto-reload
const toolsDir = path.join(__dirname, 'tools');
let reloadDebounce = null;
fs.watch(toolsDir, { recursive: true }, (eventType, filename) => {
	if (!filename || !filename.endsWith('.js')) return;
	clearTimeout(reloadDebounce);
	reloadDebounce = setTimeout(() => {
		const toolExecutor = require('./tools');
		toolExecutor.reload();
		skills.scan();
		const win = avatarWindow.get();
		if (win) win.webContents.send('reload-session');
	}, 500);
});

app.on('window-all-closed', () => {
	app.quit();
});
