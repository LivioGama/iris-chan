// Suppress EPIPE crashes (broken stdout/stderr pipe in packaged Electron)
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
process.on('uncaughtException', (err) => {
	if (err.code === 'EPIPE') return;
	try { require('./logger').error('Uncaught', err.stack || err.message); } catch {}
});

// Enable TypeScript imports via require()
require('ts-node').register({ transpileOnly: true });

const { app } = require('electron');

// Force ANGLE Metal backend before any window is created
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-features', 'Metal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const { loadEnv } = require('../shared/env-loader');
loadEnv();

const apiKey = process.env.GEMINI_API_KEY || '';

const { startRuntime } = require('./bootstrap');
startRuntime({ apiKey });
