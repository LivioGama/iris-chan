const fs = require('fs');
const os = require('os');
const path = require('path');
const configModule = require('../shared/config');
const config = configModule.default || configModule;

const SETTINGS_PATH = process.env.IRIS_SETTINGS_PATH || path.join(os.homedir(), '.iris', 'settings.json');
const LEGACY_LOG_SETTINGS_PATH = process.env.IRIS_LOG_SETTINGS_PATH || path.join(os.homedir(), '.iris', 'logging-settings.json');

const LEVEL_RANK = { info: 0, warn: 1, error: 2, silent: 3 };
const AVATAR_VALUES = new Set(['original', 'tripo3d']);
const MODE_VALUES = new Set(['silent', 'passive', 'proactive']);
const VOICE_PRESETS = Object.freeze(deepClone(config.voicePresets || []));
const LEGACY_MODE_ALIASES = Object.freeze({
	silent: 'silent',
	attentive: 'passive',
	passive: 'passive',
	autonomous: 'proactive',
	proactive: 'proactive',
});

const DEFAULT_SETTINGS = Object.freeze({
	voice: {
		modelVoiceName: config.voice.modelVoiceName,
		speechProfile: deepClone(config.voice.speechProfile),
		volumeThreshold: config.voice.volumeThreshold,
		screenCaptureInterval: config.voice.screenCaptureInterval,
		newTurnThresholdMs: config.voice.newTurnThresholdMs,
		replyCooldownMs: config.voice.replyCooldownMs,
		speechReleaseMs: config.voice.speechReleaseMs,
		echoSuppressionGain: config.voice.echoSuppressionGain,
		recentSeen: deepClone(config.voice.recentSeen),
		listeningGate: deepClone(config.voice.listeningGate),
		bargeIn: deepClone(config.voice.bargeIn),
	},
	avatar: {
		current: config.avatar.current,
	},
	behavior: {
		mode: 'silent',
		directMode: false,
		feedbackEnabled: false,
		introversionEnabled: false,
	},
	logging: {
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
	},
});

const REGISTRY = Object.freeze({
	voice: {
		liveApply: true,
		normalize: normalizeVoiceSettings,
		capabilities: {
			queryIntents: ['list voice presets', 'what voice presets are available', 'what voice options do you have'],
			mutationIntents: ['switch voice preset', 'change voice', 'adjust pitch', 'adjust playback rate', 'adjust EQ warmth/brightness', 'adjust compression'],
			examples: ['list available voice presets', 'switch to soft bloom', 'make it warmer and slower'],
			keyPaths: ['voice.modelVoiceName', 'voice.speechProfile.*'],
		},
	},
	avatar: {
		liveApply: true,
		normalize: normalizeAvatarSettings,
		capabilities: {
			queryIntents: ['what avatar is selected'],
			mutationIntents: ['switch avatar', 'change avatar'],
			examples: ['set avatar to tripo3d'],
			keyPaths: ['avatar.current'],
		},
	},
	behavior: {
		liveApply: true,
		normalize: normalizeBehaviorSettings,
		capabilities: {
			queryIntents: ['what mode are you in', 'is direct mode on', 'is feedback mode on', 'is introversion mode on'],
			mutationIntents: ['change behavior mode', 'toggle direct mode', 'set passive mode', 'set proactive mode', 'turn feedback mode on', 'turn introversion mode on'],
			examples: ['turn direct mode on', 'set mode to proactive', 'turn feedback mode on'],
			keyPaths: ['behavior.mode', 'behavior.directMode', 'behavior.feedbackEnabled', 'behavior.introversionEnabled'],
		},
	},
	logging: {
		liveApply: true,
		normalize: normalizeLoggingSettings,
		capabilities: {
			queryIntents: ['what logging level are you using'],
			mutationIntents: ['change logging level', 'turn logging off'],
			examples: ['set logging.console.level = warn'],
			keyPaths: ['logging.console.*', 'logging.persist.*', 'logging.sources.*', 'logging.categories.*'],
		},
	},
});

let currentSettings = null;
let watcher = null;
let broadcaster = null;
const listeners = new Set();
const applyHandlers = new Map();
let writing = false;
let pendingWatchReload = false;

function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return deepClone(base);
	const out = Array.isArray(base) ? [...base] : { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const baseValue = base?.[key];
		if (
			value
			&& typeof value === 'object'
			&& !Array.isArray(value)
			&& baseValue
			&& typeof baseValue === 'object'
			&& !Array.isArray(baseValue)
		) {
			out[key] = mergeDeep(baseValue, value);
		} else {
			out[key] = value;
		}
	}
	return out;
}

function normalizeLevel(level, fallback = 'info') {
	return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : fallback;
}

function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(max, Math.max(min, numeric));
}

function normalizeBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;
	return fallback;
}

function sanitizeKeys(namespace, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
	const defaults = DEFAULT_SETTINGS[namespace];
	const out = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
		if (
			value
			&& typeof value === 'object'
			&& !Array.isArray(value)
			&& defaults[key]
			&& typeof defaults[key] === 'object'
			&& !Array.isArray(defaults[key])
		) {
			const nested = sanitizeNested(defaults[key], value);
			if (Object.keys(nested).length) out[key] = nested;
		} else {
			out[key] = value;
		}
	}
	return out;
}

function sanitizeNested(defaults, patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
	const out = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
		if (
			value
			&& typeof value === 'object'
			&& !Array.isArray(value)
			&& defaults[key]
			&& typeof defaults[key] === 'object'
			&& !Array.isArray(defaults[key])
		) {
			const nested = sanitizeNested(defaults[key], value);
			if (Object.keys(nested).length) out[key] = nested;
		} else {
			out[key] = value;
		}
	}
	return out;
}

function normalizeVoiceSettings(input = {}) {
	const merged = mergeDeep(DEFAULT_SETTINGS.voice, sanitizeKeys('voice', input));
	merged.modelVoiceName = String(merged.modelVoiceName || '').trim() || DEFAULT_SETTINGS.voice.modelVoiceName;
	merged.volumeThreshold = clampNumber(merged.volumeThreshold, DEFAULT_SETTINGS.voice.volumeThreshold, 0, 1);
	merged.screenCaptureInterval = clampNumber(merged.screenCaptureInterval, DEFAULT_SETTINGS.voice.screenCaptureInterval, 250, 120000);
	merged.newTurnThresholdMs = clampNumber(merged.newTurnThresholdMs, DEFAULT_SETTINGS.voice.newTurnThresholdMs, 0, 60000);
	merged.replyCooldownMs = clampNumber(merged.replyCooldownMs, DEFAULT_SETTINGS.voice.replyCooldownMs, 0, 300000);
	merged.speechReleaseMs = clampNumber(merged.speechReleaseMs, DEFAULT_SETTINGS.voice.speechReleaseMs, 0, 5000);
	merged.echoSuppressionGain = clampNumber(merged.echoSuppressionGain, DEFAULT_SETTINGS.voice.echoSuppressionGain, 0, 2);
	merged.recentSeen.ttlMs = clampNumber(merged.recentSeen.ttlMs, DEFAULT_SETTINGS.voice.recentSeen.ttlMs, 0, 300000);
	merged.recentSeen.maxTerms = clampNumber(merged.recentSeen.maxTerms, DEFAULT_SETTINGS.voice.recentSeen.maxTerms, 0, 500);
	merged.recentSeen.extractIntervalMs = clampNumber(merged.recentSeen.extractIntervalMs, DEFAULT_SETTINGS.voice.recentSeen.extractIntervalMs, 250, 120000);
	merged.recentSeen.minConfidence = clampNumber(merged.recentSeen.minConfidence, DEFAULT_SETTINGS.voice.recentSeen.minConfidence, 0, 1);
	merged.recentSeen.rewriteDistance = clampNumber(merged.recentSeen.rewriteDistance, DEFAULT_SETTINGS.voice.recentSeen.rewriteDistance, 0, 20);
	merged.recentSeen.persistEnabled = normalizeBoolean(merged.recentSeen.persistEnabled, DEFAULT_SETTINGS.voice.recentSeen.persistEnabled);
	for (const key of Object.keys(DEFAULT_SETTINGS.voice.listeningGate)) {
		const fallback = DEFAULT_SETTINGS.voice.listeningGate[key];
		merged.listeningGate[key] = clampNumber(merged.listeningGate[key], fallback, 0, 100000);
	}
	for (const key of Object.keys(DEFAULT_SETTINGS.voice.bargeIn)) {
		const fallback = DEFAULT_SETTINGS.voice.bargeIn[key];
		merged.bargeIn[key] = clampNumber(merged.bargeIn[key], fallback, 0, 100000);
	}
	for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS.voice.speechProfile)) {
		const min = key === 'playbackRate' ? 0.8 : -60;
		const max = key === 'playbackRate' ? 1.08 : 20000;
		merged.speechProfile[key] = clampNumber(merged.speechProfile[key], fallback, min, max);
	}
	return merged;
}

function normalizePresetName(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getVoicePresets() {
	return deepClone(VOICE_PRESETS);
}

function resolveVoicePreset(name = '') {
	const target = normalizePresetName(name);
	if (!target) return null;
	return VOICE_PRESETS.find((preset) => {
		if (normalizePresetName(preset.name) === target) return true;
		return Array.isArray(preset.aliases) && preset.aliases.some((alias) => normalizePresetName(alias) === target);
	}) || null;
}

function buildVoicePresetPatch(name = '') {
	const preset = resolveVoicePreset(name);
	if (!preset) return null;
	return {
		voice: {
			modelVoiceName: preset.modelVoiceName,
			speechProfile: deepClone(preset.speechProfile),
		},
	};
}

function normalizeAvatarSettings(input = {}) {
	const merged = mergeDeep(DEFAULT_SETTINGS.avatar, sanitizeKeys('avatar', input));
	merged.current = AVATAR_VALUES.has(merged.current) ? merged.current : DEFAULT_SETTINGS.avatar.current;
	return merged;
}

function normalizeBehaviorSettings(input = {}) {
	const merged = mergeDeep(DEFAULT_SETTINGS.behavior, sanitizeKeys('behavior', input));
	const normalizedMode = LEGACY_MODE_ALIASES[String(merged.mode || '').trim().toLowerCase()];
	merged.mode = MODE_VALUES.has(normalizedMode) ? normalizedMode : DEFAULT_SETTINGS.behavior.mode;
	merged.directMode = normalizeBoolean(merged.directMode, DEFAULT_SETTINGS.behavior.directMode);
	merged.feedbackEnabled = normalizeBoolean(merged.feedbackEnabled, DEFAULT_SETTINGS.behavior.feedbackEnabled);
	merged.introversionEnabled = normalizeBoolean(merged.introversionEnabled, DEFAULT_SETTINGS.behavior.introversionEnabled);
	return merged;
}

function normalizeLoggingSettings(input = {}) {
	const merged = mergeDeep(DEFAULT_SETTINGS.logging, sanitizeKeys('logging', input));
	merged.console.enabled = normalizeBoolean(merged.console.enabled, DEFAULT_SETTINGS.logging.console.enabled);
	merged.console.level = normalizeLevel(merged.console.level, DEFAULT_SETTINGS.logging.console.level);
	merged.persist.enabled = normalizeBoolean(merged.persist.enabled, DEFAULT_SETTINGS.logging.persist.enabled);
	merged.persist.level = normalizeLevel(merged.persist.level, DEFAULT_SETTINGS.logging.persist.level);
	merged.sources.mainConsole = normalizeBoolean(merged.sources.mainConsole, DEFAULT_SETTINGS.logging.sources.mainConsole);
	merged.sources.rendererConsole = normalizeBoolean(merged.sources.rendererConsole, DEFAULT_SETTINGS.logging.sources.rendererConsole);
	merged.sources.rendererConsoleCapture = normalizeBoolean(merged.sources.rendererConsoleCapture, DEFAULT_SETTINGS.logging.sources.rendererConsoleCapture);
	for (const key of Object.keys(DEFAULT_SETTINGS.logging.categories)) {
		merged.categories[key] = normalizeBoolean(merged.categories[key], DEFAULT_SETTINGS.logging.categories[key]);
	}
	return merged;
}

function normalizeSettings(input = {}) {
	const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
	return {
		voice: normalizeVoiceSettings(raw.voice),
		avatar: normalizeAvatarSettings(raw.avatar),
		behavior: normalizeBehaviorSettings(raw.behavior),
		logging: normalizeLoggingSettings(raw.logging),
	};
}

function ensureDir() {
	fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
}

function migrateLegacyLogging(rawSettings) {
	if (!fs.existsSync(LEGACY_LOG_SETTINGS_PATH)) return rawSettings;
	try {
		const legacyRaw = JSON.parse(fs.readFileSync(LEGACY_LOG_SETTINGS_PATH, 'utf-8'));
		return mergeDeep(rawSettings, { logging: legacyRaw });
	} catch {
		return rawSettings;
	}
}

function loadSettingsFromDisk() {
	let raw = {};
	try {
		raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
	} catch {}
	raw = migrateLegacyLogging(raw);
	return normalizeSettings(raw);
}

function writeCurrentSettings() {
	ensureDir();
	writing = true;
	try {
		fs.writeFileSync(SETTINGS_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
	} finally {
		setTimeout(() => {
			writing = false;
			if (pendingWatchReload) {
				pendingWatchReload = false;
				reloadFromDisk({ source: 'watch' });
			}
		}, 30);
	}
}

function diffChangedKeys(previous, next, prefix = '') {
	const changed = [];
	const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
	for (const key of keys) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		const prevValue = previous?.[key];
		const nextValue = next?.[key];
		const bothObjects = prevValue && nextValue
			&& typeof prevValue === 'object'
			&& typeof nextValue === 'object'
			&& !Array.isArray(prevValue)
			&& !Array.isArray(nextValue);
		if (bothObjects) {
			changed.push(...diffChangedKeys(prevValue, nextValue, fullKey));
			continue;
		}
		if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
			changed.push(fullKey);
		}
	}
	return changed;
}

function setSettingsBroadcaster(fn) {
	broadcaster = typeof fn === 'function' ? fn : null;
}

function broadcastSettings(payload = getSettings(), meta = {}) {
	const snapshot = deepClone(payload);
	for (const listener of listeners) {
		try {
			listener(snapshot, meta);
		} catch {}
	}
	if (broadcaster) {
		try {
			broadcaster(snapshot, meta);
		} catch {}
	}
}

function applyNamespaces(previous, next) {
	const namespaceStatuses = [];
	for (const namespace of Object.keys(REGISTRY)) {
		const changed = JSON.stringify(previous?.[namespace]) !== JSON.stringify(next?.[namespace]);
		if (!changed) continue;
		const handler = applyHandlers.get(namespace);
		if (!handler) {
			namespaceStatuses.push({
				namespace,
				applied: true,
				liveApply: !!REGISTRY[namespace]?.liveApply,
				restartRequired: !REGISTRY[namespace]?.liveApply,
			});
			continue;
		}
		try {
			const result = handler(deepClone(next[namespace]), deepClone(previous?.[namespace])) || {};
			const status = {
				namespace,
				applied: result?.applied !== false,
				liveApply: result?.liveApply !== false,
				restartRequired: !!result?.restartRequired,
			};
			for (const [key, value] of Object.entries(result)) {
				if (['applied', 'liveApply', 'restartRequired'].includes(key)) continue;
				status[key] = deepClone(value);
			}
			namespaceStatuses.push(status);
		} catch {
			namespaceStatuses.push({ namespace, applied: false, liveApply: !!REGISTRY[namespace]?.liveApply });
		}
	}
	return namespaceStatuses;
}

function getSettings() {
	if (!currentSettings) {
		currentSettings = loadSettingsFromDisk();
	}
	return deepClone(currentSettings);
}

function init() {
	if (currentSettings) return getSettings();
	currentSettings = loadSettingsFromDisk();
	if (!fs.existsSync(SETTINGS_PATH)) {
		writeCurrentSettings();
	}
	startWatcher();
	return getSettings();
}

function startWatcher() {
	if (watcher) return;
	ensureDir();
	try {
		const settingsDir = path.dirname(SETTINGS_PATH);
		const settingsFileName = path.basename(SETTINGS_PATH);
		watcher = fs.watch(settingsDir, (_eventType, filename) => {
			if (filename && String(filename) !== settingsFileName) return;
			if (writing) {
				pendingWatchReload = true;
				return;
			}
			reloadFromDisk({ source: 'watch' });
		});
	} catch {
		watcher = null;
	}
}

function shutdown() {
	if (watcher) {
		try {
			watcher.close();
		} catch {}
		watcher = null;
	}
}

function reloadFromDisk(meta = {}) {
	const previous = getSettings();
	currentSettings = loadSettingsFromDisk();
	const changedKeys = diffChangedKeys(previous, currentSettings);
	if (!changedKeys.length) return {
		ok: true,
		applied: true,
		restartRequired: false,
		changedKeys: [],
	};
	const namespaceStatuses = applyNamespaces(previous, currentSettings);
	const restartRequired = namespaceStatuses.some((status) => status.restartRequired || status.applied === false);
	broadcastSettings(currentSettings, { ...meta, changedKeys, namespaceStatuses, restartRequired });
	return {
		ok: true,
		applied: !restartRequired,
		restartRequired,
		changedKeys,
		namespaceStatuses,
	};
}

function updateSettings(patch = {}, meta = {}) {
	const sanitizedPatch = normalizeSettings(mergeDeep(currentSettings || DEFAULT_SETTINGS, patch));
	const previous = getSettings();
	currentSettings = normalizeSettings(mergeDeep(previous, sanitizedPatch));
	writeCurrentSettings();
	const changedKeys = diffChangedKeys(previous, currentSettings);
	const namespaceStatuses = applyNamespaces(previous, currentSettings);
	const restartRequired = namespaceStatuses.some((status) => status.restartRequired || status.applied === false);
	broadcastSettings(currentSettings, { ...meta, changedKeys, namespaceStatuses, restartRequired });
	return {
		ok: true,
		applied: !restartRequired,
		restartRequired,
		changedKeys,
		namespaceStatuses,
		settings: getSettings(),
	};
}

function getNamespace(namespace) {
	return getSettings()?.[namespace];
}

function onChange(listener) {
	if (typeof listener !== 'function') return () => {};
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function registerApplyHandler(namespace, handler) {
	if (!REGISTRY[namespace]) throw new Error(`Unknown settings namespace: ${namespace}`);
	if (typeof handler !== 'function') throw new Error(`Settings apply handler for ${namespace} must be a function`);
	applyHandlers.set(namespace, handler);
	return () => applyHandlers.delete(namespace);
}

function getMetadata() {
	return {
		path: SETTINGS_PATH,
		registry: deepClone(Object.fromEntries(
			Object.entries(REGISTRY).map(([namespace, value]) => [
				namespace,
				{
					liveApply: !!value.liveApply,
					restartRequired: !value.liveApply,
					capabilities: deepClone(value.capabilities || {}),
				},
			]),
		)),
	};
}

module.exports = {
	DEFAULT_SETTINGS,
	SETTINGS_PATH,
	init,
	getSettings,
	getNamespace,
	updateSettings,
	reloadFromDisk,
	shutdown,
	onChange,
	setSettingsBroadcaster,
	registerApplyHandler,
	getMetadata,
	getVoicePresets,
	resolveVoicePreset,
	buildVoicePresetPatch,
	normalizeSettings,
	normalizeLoggingSettings,
	normalizeVoiceSettings,
};
