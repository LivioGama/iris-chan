const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PATH = process.env.IRIS_LOG_PATH || path.join(os.homedir(), 'Desktop', 'consolidated_messages.log');
const SETTINGS_PATH = process.env.IRIS_LOG_SETTINGS_PATH || path.join(os.homedir(), '.iris', 'logging-settings.json');
const MAX_SIZE = 2 * 1024 * 1024;
const LEVEL_RANK = { info: 0, warn: 1, error: 2, silent: 3 };

const DEFAULT_SETTINGS = Object.freeze({
	console: {
		enabled: true,
		level: 'info',
	},
	persist: {
		enabled: true,
		level: 'info',
	},
	sources: {
		mainConsole: true,
		rendererConsole: true,
		rendererConsoleCapture: true,
	},
	categories: {
		conversation: true,
		voice: true,
		gemini: true,
		vocab: true,
		tools: true,
		runtime: true,
		ui: true,
		system: true,
		other: true,
	},
});

let stdoutOk = true;
let stderrOk = true;
let writeCount = 0;
let settingsBroadcaster = null;
let consoleInterceptorInstalled = false;
const nativeConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};

if (process.stdout) process.stdout.on('error', () => { stdoutOk = false; });
if (process.stderr) process.stderr.on('error', () => { stderrOk = false; });

function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function mergeSettings(base, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return deepClone(base);
	const out = Array.isArray(base) ? [...base] : { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
			out[key] = mergeSettings(base[key], value);
		} else {
			out[key] = value;
		}
	}
	return out;
}

function normalizeLevel(level, fallback = 'info') {
	return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : fallback;
}

function normalizeSettings(input = {}) {
	const merged = mergeSettings(DEFAULT_SETTINGS, input);
	merged.console.enabled = !!merged.console.enabled;
	merged.console.level = normalizeLevel(merged.console.level);
	merged.persist.enabled = !!merged.persist.enabled;
	merged.persist.level = normalizeLevel(merged.persist.level);
	merged.sources.mainConsole = !!merged.sources.mainConsole;
	merged.sources.rendererConsole = !!merged.sources.rendererConsole;
	merged.sources.rendererConsoleCapture = !!merged.sources.rendererConsoleCapture;
	for (const key of Object.keys(DEFAULT_SETTINGS.categories)) {
		merged.categories[key] = merged.categories[key] !== false;
	}
	return merged;
}

function loadSettings() {
	try {
		const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return normalizeSettings();
	}
}

let currentSettings = loadSettings();

function saveSettings() {
	try {
		fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
		fs.writeFileSync(SETTINGS_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
	} catch {}
}

function setSettingsBroadcaster(fn) {
	settingsBroadcaster = typeof fn === 'function' ? fn : null;
}

function broadcastSettings() {
	if (!settingsBroadcaster) return;
	try {
		settingsBroadcaster(getSettings());
	} catch {}
}

function getSettings() {
	return deepClone(currentSettings);
}

function updateSettings(patch = {}) {
	currentSettings = normalizeSettings(mergeSettings(currentSettings, patch));
	saveSettings();
	broadcastSettings();
	return getSettings();
}

function resetSettings() {
	currentSettings = normalizeSettings();
	saveSettings();
	broadcastSettings();
	return getSettings();
}

function ts() {
	return new Date().toISOString();
}

function fmt(args) {
	return args.map((arg) => {
		if (arg instanceof Error) return arg.stack || arg.message;
		if (typeof arg === 'object') {
			try { return JSON.stringify(arg); } catch { return String(arg); }
		}
		return String(arg);
	}).join(' ');
}

function truncateIfNeeded() {
	try {
		const stat = fs.statSync(LOG_PATH);
		if (stat.size <= MAX_SIZE) return;
		const content = fs.readFileSync(LOG_PATH, 'utf-8');
		const half = content.slice(content.length - MAX_SIZE / 2);
		const firstNewline = half.indexOf('\n');
		fs.writeFileSync(LOG_PATH, '[...truncated...]\n' + half.slice(firstNewline + 1));
	} catch {}
}

function rank(level) {
	return LEVEL_RANK[normalizeLevel(level)] ?? LEVEL_RANK.info;
}

function sourceEnabled(source = 'main') {
	if (source === 'renderer-console-capture') return currentSettings.sources.rendererConsoleCapture;
	if (source === 'renderer') return currentSettings.sources.rendererConsole;
	return currentSettings.sources.mainConsole;
}

function deriveCategory(tag = '') {
	const normalized = String(tag || '').toLowerCase();
	if (normalized.includes('conversation')) return 'conversation';
	if (normalized.includes('voice') || normalized.includes('playback')) return 'voice';
	if (normalized.includes('gemini')) return 'gemini';
	if (normalized.includes('vocab') || normalized.includes('recentseen')) return 'vocab';
	if (normalized.includes('tool')) return 'tools';
	if (
		normalized.includes('runtime')
		|| normalized.includes('task')
		|| normalized.includes('health')
		|| normalized.includes('autonomous')
	) return 'runtime';
	if (
		normalized.includes('renderer')
		|| normalized.includes('ui')
		|| normalized.includes('kanban')
		|| normalized.includes('workspace')
	) return 'ui';
	if (
		normalized.includes('uncaught')
		|| normalized.includes('avatar')
		|| normalized.includes('tray')
		|| normalized.includes('convex')
		|| normalized.includes('system')
	) return 'system';
	return 'other';
}

function shouldEmit(target, level, tag, meta = {}) {
	const channel = target === 'persist' ? currentSettings.persist : currentSettings.console;
	if (!channel.enabled) return false;
	if (rank(level) < rank(channel.level)) return false;
	const source = meta.source || 'main';
	if (target === 'console' && !sourceEnabled(source)) return false;
	const category = meta.category || deriveCategory(tag);
	return currentSettings.categories[category] !== false;
}

function writeLine(level, tag, message, meta = {}) {
	const category = meta.category || deriveCategory(tag);
	const source = meta.source || 'main';
	const line = `${ts()} [${String(level).toUpperCase()}] [${tag}] [${category}] [${source}] ${message}\n`;
	try {
		fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
		fs.appendFileSync(LOG_PATH, line);
	} catch {}
}

function write(level, tag, args, meta = {}) {
	const message = fmt(args);
	if (shouldEmit('console', level, tag, meta)) {
		const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
		const streamOk = method === 'log' ? stdoutOk : stderrOk;
		if (streamOk) {
			try { nativeConsole[method](`[${tag}]`, ...args); } catch {}
		}
	}
	if (shouldEmit('persist', level, tag, meta)) {
		writeLine(level, tag, message, meta);
		if (++writeCount % 100 === 0) truncateIfNeeded();
	}
}

function log(level, tag, ...args) {
	write(normalizeLevel(level), tag, args);
}

function info(tag, ...args) {
	write('info', tag, args);
}

function warn(tag, ...args) {
	write('warn', tag, args);
}

function error(tag, ...args) {
	write('error', tag, args);
}

function logFromRenderer(level, tag, message, meta = {}) {
	write(normalizeLevel(level), tag, [message], { ...meta, source: meta.source || 'renderer' });
}

function captureRendererConsole(level, tag, message) {
	write(normalizeLevel(level), tag, [message], { source: 'renderer-console-capture' });
}

function cycleConsoleLevel() {
	const order = ['info', 'warn', 'error', 'silent'];
	const index = order.indexOf(currentSettings.console.level);
	const next = order[(index + 1) % order.length];
	return updateSettings({ console: { level: next } });
}

function installConsoleInterceptor() {
	if (consoleInterceptorInstalled) return;
	consoleInterceptorInstalled = true;
	console.log = (...args) => write('info', 'Console', args, { source: 'main', category: 'system' });
	console.info = (...args) => write('info', 'Console', args, { source: 'main', category: 'system' });
	console.warn = (...args) => write('warn', 'Console', args, { source: 'main', category: 'system' });
	console.error = (...args) => write('error', 'Console', args, { source: 'main', category: 'system' });
}

try {
	fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
	fs.appendFileSync(LOG_PATH, `\n${'='.repeat(60)}\n${ts()} [SESSION] Iris started\n${'='.repeat(60)}\n`);
} catch {}

module.exports = {
	LOG_PATH,
	SETTINGS_PATH,
	DEFAULT_SETTINGS: deepClone(DEFAULT_SETTINGS),
	deriveCategory,
	getSettings,
	updateSettings,
	resetSettings,
	setSettingsBroadcaster,
	shouldEmit,
	cycleConsoleLevel,
	installConsoleInterceptor,
	log,
	info,
	warn,
	error,
	logFromRenderer,
	captureRendererConsole,
};
