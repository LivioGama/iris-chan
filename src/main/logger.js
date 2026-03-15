const fs = require('fs');
const path = require('path');
const os = require('os');
const settings = require('./settings');

const LOG_PATH = process.env.IRIS_LOG_PATH || path.join(os.homedir(), 'Desktop', 'consolidated_messages.log');
const MAX_SIZE = 2 * 1024 * 1024;
const LEVEL_RANK = { debug: -1, info: 0, warn: 1, error: 2, silent: 3 };

let stdoutOk = true;
let stderrOk = true;
let writeCount = 0;
let consoleInterceptorInstalled = false;
const nativeConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};

if (process.stdout) process.stdout.on('error', () => { stdoutOk = false; });
if (process.stderr) process.stderr.on('error', () => { stderrOk = false; });

let currentSettings = settings.getNamespace('logging') || settings.DEFAULT_SETTINGS.logging;
settings.onChange((nextSettings) => {
	if (!nextSettings?.logging) return;
	currentSettings = nextSettings.logging;
});

function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function normalizeLevel(level, fallback = 'info') {
	return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : fallback;
}

function getSettings() {
	return deepClone(currentSettings);
}

function updateSettings(patch = {}) {
	const result = settings.updateSettings({ logging: patch }, { source: 'logger:updateSettings' });
	currentSettings = result.settings.logging;
	return deepClone(currentSettings);
}

function resetSettings() {
	const result = settings.updateSettings({ logging: settings.DEFAULT_SETTINGS.logging }, { source: 'logger:resetSettings' });
	currentSettings = result.settings.logging;
	return deepClone(currentSettings);
}

function setSettingsBroadcaster(fn) {
	settings.setSettingsBroadcaster((nextSettings) => {
		try {
			fn(nextSettings?.logging || getSettings());
		} catch {}
	});
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
	if (normalized.includes('metric') || normalized.includes('benchmark')) return 'metrics';
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

function debug(tag, ...args) {
	write('debug', tag, args);
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
	return updateSettings({ console: { level: next, enabled: next !== 'silent' } });
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
	DEFAULT_SETTINGS: deepClone(settings.DEFAULT_SETTINGS.logging),
	deriveCategory,
	getSettings,
	updateSettings,
	resetSettings,
	setSettingsBroadcaster,
	shouldEmit,
	cycleConsoleLevel,
	installConsoleInterceptor,
	log,
	debug,
	info,
	warn,
	error,
	logFromRenderer,
	captureRendererConsole,
};
