// App exclusion — prevents Iris from sending input events to or querying the
// accessibility tree of specified applications when they are in the foreground.
//
// SuperRun is excluded by default because Iris's CGEvent posting and AX queries
// conflict with its own accessibility-based interaction model.

const { execFile } = require('child_process');
const log = require('./logger');

// ── Exclusion list ──────────────────────────────────────────────────────────
const EXCLUDED_APPS = new Set(['SuperRun']);

// ── Frontmost-app cache (fully async — never blocks the main thread) ────────
let _cachedApp = '';
let _cachedAt = 0;
let _refreshInFlight = false;
const CACHE_TTL_MS = 1500; // refresh at most every 1.5 s

/** Trigger a background refresh of the frontmost app name (non-blocking). */
function _triggerRefresh() {
	if (_refreshInFlight) return;
	_refreshInFlight = true;

	execFile('osascript', [
		'-e',
		'tell application "System Events" to get name of first application process whose frontmost is true',
	], { timeout: 2000, encoding: 'utf8' }, (err, stdout) => {
		_refreshInFlight = false;
		if (!err && stdout) {
			_cachedApp = stdout.trim();
			_cachedAt = Date.now();
		}
		// On failure keep the stale cached value rather than blocking
	});
}

/**
 * Returns the cached frontmost app name (instant, never blocks).
 * Kicks off a background refresh when the cache is stale.
 */
function getFrontmostAppName() {
	const now = Date.now();
	if (now - _cachedAt >= CACHE_TTL_MS) {
		_triggerRefresh();
	}
	return _cachedApp;
}

// ── Public helpers ──────────────────────────────────────────────────────────

/** True when the current frontmost app is in the exclusion list. */
function isFrontmostExcluded() {
	const app = getFrontmostAppName();
	return EXCLUDED_APPS.has(app);
}

/** Check a specific app name against the exclusion list (no osascript call). */
function isAppExcluded(appName) {
	return EXCLUDED_APPS.has(appName);
}

function addExcludedApp(name) {
	EXCLUDED_APPS.add(name);
	log.info('AppExclusion', `Added "${name}" to exclusion list`);
}

function removeExcludedApp(name) {
	EXCLUDED_APPS.delete(name);
	log.info('AppExclusion', `Removed "${name}" from exclusion list`);
}

function getExcludedApps() {
	return [...EXCLUDED_APPS];
}

// ── Tool-name classification ────────────────────────────────────────────────
// Tools that post CGEvents (keyboard / mouse) into the focused app.
// These MUST be blocked when an excluded app is in the foreground.
const INPUT_TOOLS = new Set([
	'type_text',
	'press_key',
	'click_at',
	'double_click',
	'mouse_move',
	'drag',
	'scroll',
	'activate_app',
]);

/** True if the named tool sends input events to the focused app. */
function isInputTool(name) {
	return INPUT_TOOLS.has(name);
}

module.exports = {
	getFrontmostAppName,
	isFrontmostExcluded,
	isAppExcluded,
	isInputTool,
	addExcludedApp,
	removeExcludedApp,
	getExcludedApps,
};
