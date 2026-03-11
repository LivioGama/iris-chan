// Tool handlers: open_app, get_frontmost_app, window_manage
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHelper } = require('../native-helper');
const { getMemoryStore } = require('../automation/service-ref');

function runAppleScript(script, timeout = 5000) {
	const proc = spawnSync('osascript', ['-e', script], { timeout, encoding: 'utf-8' });
	if (proc.error) throw proc.error;
	if (proc.status !== 0) throw new Error((proc.stderr || proc.stdout || 'AppleScript failed').trim());
	return (proc.stdout || '').trim();
}

function normalizeText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isDefaultAppRequest(name = '') {
	const normalized = normalizeText(name);
	return normalized.includes('default browser') || normalized.includes('default mail');
}

function resolveDefaultAppBundleId(kind) {
	const script = `
import plistlib, pathlib, json, os, sys
kind = sys.argv[1]
plist_path = pathlib.Path.home() / "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
bundle = ""
if plist_path.exists():
    with plist_path.open("rb") as fh:
        data = plistlib.load(fh)
    handlers = data.get("LSHandlers", [])
    targets = ["http", "https"] if kind == "browser" else ["mailto"]
    for scheme in targets:
        for item in handlers:
            if item.get("LSHandlerURLScheme") == scheme and item.get("LSHandlerRoleAll"):
                bundle = item.get("LSHandlerRoleAll")
                break
        if bundle:
            break
print(bundle)
`.trim();
	const proc = spawnSync('python3', ['-c', script, kind], { timeout: 5000, encoding: 'utf-8' });
	if (proc.error) throw proc.error;
	if (proc.status !== 0) throw new Error((proc.stderr || 'python3 failed').trim());
	return (proc.stdout || '').trim();
}

function appNameForBundleId(bundleId = '') {
	if (!bundleId) return '';
	const proc = spawnSync('mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`], { timeout: 5000, encoding: 'utf-8' });
	const firstPath = (proc.stdout || '').split('\n').find(Boolean) || '';
	return firstPath ? path.basename(firstPath, '.app') : '';
}

function activateBundleId(bundleId = '') {
	return runAppleScript(`tell application id "${String(bundleId || '').replace(/"/g, '\\"')}" to activate`, 5000);
}

function resolveDefaultApp(name = '') {
	const normalized = normalizeText(name);
	const kind = normalized.includes('mail') ? 'mail' : 'browser';
	const memoryStore = getMemoryStore();
	const bundleKey = kind === 'browser' ? 'environment.default_browser.bundle_id' : 'environment.default_mail.bundle_id';
	const appNameKey = kind === 'browser' ? 'environment.default_browser.app_name' : 'environment.default_mail.app_name';
	const cachedBundleId = memoryStore?.getValue?.(bundleKey, '') || '';
	const cachedAppName = memoryStore?.getValue?.(appNameKey, '') || '';
	if (cachedBundleId) {
		return {
			ok: true,
			kind,
			bundleId: cachedBundleId,
			appName: appNameForBundleId(cachedBundleId) || cachedAppName || name,
			source: 'memory',
		};
	}
	if (cachedAppName) {
		return {
			ok: true,
			kind,
			bundleId: '',
			appName: cachedAppName,
			source: 'memory',
		};
	}
	const bundleId = resolveDefaultAppBundleId(kind);
	if (!bundleId) return { ok: false, error: `Could not resolve default ${kind}` };
	const appName = appNameForBundleId(bundleId) || name;
	memoryStore?.upsert?.({
		kind: 'environment_fact',
		scope: 'machine',
		key: bundleKey,
		value: bundleId,
		source: 'observed_success',
		confidence: 0.95,
		evidence: `Resolved default ${kind} on ${os.hostname()}`,
	});
	memoryStore?.upsert?.({
		kind: 'environment_fact',
		scope: 'machine',
		key: appNameKey,
		value: appName,
		source: 'observed_success',
		confidence: 0.9,
		evidence: `Resolved default ${kind} name on ${os.hostname()}`,
	});
	return { ok: true, kind, bundleId, appName, source: 'native' };
}

async function open_app(args) {
	const name = args.name || '';
	if (isDefaultAppRequest(name)) {
		try {
			const resolved = resolveDefaultApp(name);
			if (!resolved.ok) return { ok: false, result: resolved.error || `Could not resolve ${name}` };
			activateBundleId(resolved.bundleId);
			return {
				ok: true,
				result: `Opened ${resolved.appName} (${resolved.kind}) via ${resolved.source} resolution`,
				resolved_name: resolved.appName,
				resolved_bundle_id: resolved.bundleId,
			};
		} catch (err) {
			return { ok: false, result: `Error: ${err.message}` };
		}
	}
	return runHelper({ action: 'open_app', name });
}

async function get_default_app(args) {
	const requested = String(args?.kind || '').trim().toLowerCase() || 'browser';
	const name = requested === 'mail' ? 'default mail' : 'default browser';
	try {
		const resolved = resolveDefaultApp(name);
		if (!resolved.ok) return { ok: false, result: resolved.error || `Could not resolve ${name}` };
		return {
			ok: true,
			result: `Default ${resolved.kind} app is ${resolved.appName}`,
			kind: resolved.kind,
			app_name: resolved.appName,
			bundle_id: resolved.bundleId,
			source: resolved.source,
		};
	} catch (err) {
		return { ok: false, result: `Error: ${err.message}` };
	}
}

async function get_frontmost_app() {
	return runHelper({ action: 'get_frontmost_app' });
}

async function window_manage(args) {
	return runHelper({ action: 'window_manage', position: args.position || 'maximize' });
}

module.exports = {
	open_app,
	get_default_app,
	get_frontmost_app,
	window_manage,
	resolveDefaultApp,
};
