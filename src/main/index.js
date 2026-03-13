// Suppress EPIPE crashes (broken stdout/stderr pipe in packaged Electron)
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
process.on('uncaughtException', (err) => {
	if (err.code === 'EPIPE') return;
	try { require('./logger').error('Uncaught', err.stack || err.message); } catch {}
});

try { require('./logger').installConsoleInterceptor(); } catch {}

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

process.env.IRIS_TOOL_SLOW_MS ||= '1200';
process.env.IRIS_RUNTIME_LOG_CONTEXT_LINES ||= '180';
process.env.IRIS_RUNTIME_LOG_CONTEXT_BYTES ||= '24000';
process.env.IRIS_SEMANTIC_UI_FAST_PATH ||= '1';
process.env.IRIS_SCIENTIFIC_SELF_REVIEW ||= '1';
process.env.IRIS_WORKSPACE_FAST_SEARCH ||= 'rg';
process.env.IRIS_GEMINI_SETUP_MAX_SYSTEM_CHARS ||= '24000';
process.env.IRIS_GEMINI_SETUP_COMPACT_SYSTEM_CHARS ||= '14000';
process.env.IRIS_AUTONOMOUS_LOOP_INTERVAL_MS ||= '600000';
process.env.IRIS_IDLE_RESPONSE_SUPPRESSION_MS ||= '10000';
process.env.IRIS_INTERRUPT_IDLE_COOLDOWN_MS ||= '12000';
process.env.IRIS_VOCAB_REFRESH_INTERVAL_MS ||= '60000';
process.env.IRIS_VOCAB_EMPTY_LOG_INTERVAL_MS ||= '300000';

const apiKey = process.env.GEMINI_API_KEY || '';

const { startRuntime } = require('./bootstrap');
startRuntime({ apiKey });
