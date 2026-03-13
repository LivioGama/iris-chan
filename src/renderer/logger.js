const DEFAULT_SETTINGS = {
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
		metrics: true,
		other: true,
	},
};

const LEVEL_RANK = { info: 0, warn: 1, error: 2, silent: 3 };

let currentSettings = structuredClone(DEFAULT_SETTINGS);
let initialized = false;
const pendingMetricFlush = new Map();
let metricFlushTimer = null;

function fmt(args) {
	return args.map((arg) => {
		if (arg instanceof Error) return arg.stack || arg.message;
		if (typeof arg === 'object') {
			try { return JSON.stringify(arg); } catch { return String(arg); }
		}
		return String(arg);
	}).join(' ');
}

function normalizeLevel(level) {
	return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : 'info';
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

function rank(level) {
	return LEVEL_RANK[normalizeLevel(level)] ?? LEVEL_RANK.info;
}

function setSettings(settings) {
	if (!settings || typeof settings !== 'object') return;
	currentSettings = {
		...structuredClone(DEFAULT_SETTINGS),
		...settings,
		console: { ...DEFAULT_SETTINGS.console, ...(settings.console || {}) },
		persist: { ...DEFAULT_SETTINGS.persist, ...(settings.persist || {}) },
		sources: { ...DEFAULT_SETTINGS.sources, ...(settings.sources || {}) },
		categories: { ...DEFAULT_SETTINGS.categories, ...(settings.categories || {}) },
	};
}

export async function initLogger() {
	if (initialized) return currentSettings;
	initialized = true;
	try {
		const api = globalThis.window?.electronAPI;
		const settings = await api?.getLogSettings?.();
		setSettings(settings);
		api?.onLogSettingsChanged?.((nextSettings) => {
			setSettings(nextSettings);
			globalThis.window?.dispatchEvent?.(new CustomEvent('iris-log-settings-changed', { detail: currentSettings }));
		});
	} catch {}
	return currentSettings;
}

export function getLogSettings() {
	return currentSettings;
}

function shouldConsole(level, tag) {
	if (!currentSettings.console.enabled) return false;
	if (!currentSettings.sources.rendererConsole) return false;
	if (rank(level) < rank(currentSettings.console.level)) return false;
	const category = deriveCategory(tag);
	return currentSettings.categories[category] !== false;
}

function write(level, tag, args) {
	if (shouldConsole(level, tag)) {
		const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
		console[method](`[${tag}]`, ...args);
	}
	globalThis.window?.electronAPI?.logToFile?.(level, tag, fmt(args));
}

function flushMetrics() {
	metricFlushTimer = null;
	for (const [tag, entry] of pendingMetricFlush.entries()) {
		write(entry.level, `${tag}Metric`, [entry.payload]);
	}
	pendingMetricFlush.clear();
}

export function info(tag, ...args) {
	write('info', tag, args);
}

export function warn(tag, ...args) {
	write('warn', tag, args);
}

export function error(tag, ...args) {
	write('error', tag, args);
}

export function metric(tag, payload, { level = 'info', flushMs = 5000 } = {}) {
	pendingMetricFlush.set(tag, { level, payload });
	if (metricFlushTimer) return;
	metricFlushTimer = setTimeout(flushMetrics, flushMs);
}
