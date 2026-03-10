// Tool handlers: macos_prefs_snapshot, macos_prefs_restore, macos_prefs_list
// Backup and restore macOS Finder preferences, recent folders, and window styles.

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../logger');

const SNAPSHOT_PATH = path.join(os.homedir(), '.iris', 'macos-prefs-snapshot.json');

// ── Finder preference keys ────────────────────────────────────────────
// Each entry: [domain, key, type] where type is for `defaults write`.
const FINDER_PREFS = [
	// View settings
	['com.apple.finder', 'FXPreferredViewStyle', 'string'],      // Nlsv|icnv|clmv|glyv
	['com.apple.finder', 'FXPreferredGroupBy', 'string'],         // None|Name|Kind|Date Last Opened|...
	['com.apple.finder', 'ShowPathbar', 'bool'],
	['com.apple.finder', 'ShowStatusBar', 'bool'],
	['com.apple.finder', 'ShowTabView', 'bool'],
	['com.apple.finder', '_FXShowPosixPathInTitle', 'bool'],
	['com.apple.finder', '_FXSortFoldersFirst', 'bool'],
	['com.apple.finder', '_FXSortFoldersFirstOnDesktop', 'bool'],
	['com.apple.finder', 'AppleShowAllFiles', 'bool'],

	// New window behaviour
	['com.apple.finder', 'NewWindowTarget', 'string'],            // PfHm|PfDe|PfDo|PfLo|PfAF
	['com.apple.finder', 'NewWindowTargetPath', 'string'],

	// Search scope
	['com.apple.finder', 'FXDefaultSearchScope', 'string'],       // SCcf|SCsp|SCev

	// Desktop icons
	['com.apple.finder', 'ShowExternalHardDrivesOnDesktop', 'bool'],
	['com.apple.finder', 'ShowHardDrivesOnDesktop', 'bool'],
	['com.apple.finder', 'ShowMountedServersOnDesktop', 'bool'],
	['com.apple.finder', 'ShowRemovableMediaOnDesktop', 'bool'],

	// Misc
	['com.apple.finder', 'QuitMenuItem', 'bool'],
	['com.apple.finder', 'WarnOnEmptyTrash', 'bool'],
	['com.apple.finder', 'FXEnableExtensionChangeWarning', 'bool'],

	// Global extensions visibility
	['NSGlobalDomain', 'AppleShowAllExtensions', 'bool'],
];

// ── Dock / window-related keys ────────────────────────────────────────
const WINDOW_PREFS = [
	// Dock behaviour affects window layout
	['com.apple.dock', 'autohide', 'bool'],
	['com.apple.dock', 'tilesize', 'integer'],
	['com.apple.dock', 'largesize', 'integer'],
	['com.apple.dock', 'magnification', 'bool'],
	['com.apple.dock', 'orientation', 'string'],                   // left|bottom|right
	['com.apple.dock', 'mineffect', 'string'],                     // genie|scale|suck
	['com.apple.dock', 'minimize-to-application', 'bool'],

	// Window manager (Stage Manager, etc.)
	['com.apple.WindowManager', 'GloballyEnabled', 'bool'],
	['com.apple.WindowManager', 'EnableStandardClickToShowDesktop', 'bool'],
	['com.apple.WindowManager', 'StandardHideDesktopIcons', 'bool'],
	['com.apple.WindowManager', 'HideDesktop', 'bool'],
	['com.apple.WindowManager', 'StageManagerHideWidgets', 'bool'],
	['com.apple.WindowManager', 'StandardHideWidgets', 'bool'],

	// Global window appearance
	['NSGlobalDomain', 'AppleInterfaceStyle', 'string'],          // Dark (absent = Light)
	['NSGlobalDomain', 'AppleReduceDesktopTinting', 'bool'],
	['NSGlobalDomain', 'NSTableViewDefaultSizeMode', 'integer'],  // 1=small 2=medium 3=large
	['NSGlobalDomain', 'AppleShowScrollBars', 'string'],          // WhenScrolling|Automatic|Always
];

// ── helpers ───────────────────────────────────────────────────────────

function readDefault(domain, key) {
	const result = spawnSync('defaults', ['read', domain, key], {
		encoding: 'utf8',
		timeout: 5000,
	});
	if (result.status !== 0) return undefined;
	return result.stdout.trim();
}

function writeDefault(domain, key, type, value) {
	if (value === undefined || value === null) return false;

	// `defaults write` needs -bool, -string, -int, etc.
	const typeFlag = type === 'integer' ? '-int' : `-${type}`;
	const result = spawnSync('defaults', ['write', domain, key, typeFlag, String(value)], {
		encoding: 'utf8',
		timeout: 5000,
	});
	return result.status === 0;
}

function deleteDefault(domain, key) {
	spawnSync('defaults', ['delete', domain, key], { encoding: 'utf8', timeout: 5000 });
}

function readRecentFolders() {
	// FXRecentFolders is a plist array — `defaults read` prints it as a
	// multi-line pseudo-plist.  Instead, use PlistBuddy on the plist file
	// for reliable results, falling back to `defaults` export.
	const plistPath = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.finder.plist');
	try {
		// Export the whole domain as XML, then extract the FXRecentFolders array
		const raw = execSync('defaults export com.apple.finder -', {
			encoding: 'utf8',
			timeout: 10000,
		});
		const match = raw.match(/<key>FXRecentFolders<\/key>\s*(<array>[\s\S]*?<\/array>)/);
		if (match) return match[1];
	} catch {}

	// Fallback: read the raw value (may be a bplist representation)
	try {
		const raw = execSync(`defaults read com.apple.finder FXRecentFolders 2>/dev/null || true`, {
			encoding: 'utf8',
			timeout: 5000,
		});
		return raw.trim() || null;
	} catch {}

	return null;
}

function readRecentPlaces() {
	try {
		const raw = execSync('defaults read NSGlobalDomain NSNavRecentPlaces 2>/dev/null || true', {
			encoding: 'utf8',
			timeout: 5000,
		});
		const trimmed = raw.trim();
		if (!trimmed || trimmed === '') return [];
		// Parse the defaults-printed array format: ( "path1", "path2" )
		const inner = trimmed.replace(/^\(/, '').replace(/\)$/, '').trim();
		if (!inner) return [];
		return inner
			.split(',')
			.map(s => s.trim().replace(/^"/, '').replace(/"$/, ''))
			.filter(Boolean);
	} catch {
		return [];
	}
}

function readFinderWindowBounds() {
	// Finder stores per-folder .DS_Store window settings, but the main
	// Finder window bounds are persisted in the Finder plist under
	// NSWindow Frame keys.  The most reliable way to capture them is
	// through `defaults read`.
	const frames = {};
	try {
		const raw = execSync('defaults read com.apple.finder', {
			encoding: 'utf8',
			timeout: 10000,
			maxBuffer: 512 * 1024,
		});
		// Find NSWindow Frame entries:  "NSWindow Frame <name>" = "x y w h ...";
		const re = /"?NSWindow Frame ([^"=]+)"?\s*=\s*"([^"]+)"/g;
		let m;
		while ((m = re.exec(raw)) !== null) {
			frames[m[1].trim()] = m[2].trim();
		}
	} catch {}
	return frames;
}

function readFinderSidebarWidth() {
	const val = readDefault('com.apple.finder', 'SidebarWidth');
	return val ? parseInt(val, 10) : undefined;
}

// ── Tool handlers ─────────────────────────────────────────────────────

/**
 * Snapshot (backup) current macOS Finder prefs, recent folders, and window styles.
 * Saves to ~/.iris/macos-prefs-snapshot.json
 */
async function macos_prefs_snapshot(args) {
	if (process.platform !== 'darwin') {
		return { ok: false, result: 'macOS only — this tool is not available on other platforms' };
	}

	const label = args?.label || new Date().toISOString().slice(0, 19).replace(/:/g, '-');

	const snapshot = {
		version: 1,
		label,
		createdAt: new Date().toISOString(),
		finder: {},
		window: {},
		recentFolders: null,
		recentPlaces: [],
		finderWindowFrames: {},
		finderSidebarWidth: undefined,
	};

	// Read Finder prefs
	for (const [domain, key] of FINDER_PREFS) {
		const val = readDefault(domain, key);
		if (val !== undefined) {
			snapshot.finder[`${domain}:${key}`] = val;
		}
	}

	// Read Window/Dock prefs
	for (const [domain, key] of WINDOW_PREFS) {
		const val = readDefault(domain, key);
		if (val !== undefined) {
			snapshot.window[`${domain}:${key}`] = val;
		}
	}

	// Recent folders
	snapshot.recentFolders = readRecentFolders();
	snapshot.recentPlaces = readRecentPlaces();

	// Finder window frames
	snapshot.finderWindowFrames = readFinderWindowBounds();
	snapshot.finderSidebarWidth = readFinderSidebarWidth();

	// Persist
	const dir = path.dirname(SNAPSHOT_PATH);
	fs.mkdirSync(dir, { recursive: true });

	// Support multiple snapshots — store as array
	let existing = [];
	try {
		existing = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
		if (!Array.isArray(existing)) existing = [existing];
	} catch {}

	existing.push(snapshot);
	// Keep last 10 snapshots
	if (existing.length > 10) existing = existing.slice(-10);

	fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(existing, null, 2), 'utf-8');

	const finderCount = Object.keys(snapshot.finder).length;
	const windowCount = Object.keys(snapshot.window).length;
	const frameCount = Object.keys(snapshot.finderWindowFrames).length;

	log.info('MacOSPrefs', `Snapshot "${label}": ${finderCount} finder prefs, ${windowCount} window prefs, ${frameCount} window frames`);

	return {
		ok: true,
		result: `Snapshot "${label}" saved to ${SNAPSHOT_PATH}\n` +
			`  Finder prefs: ${finderCount}\n` +
			`  Window prefs: ${windowCount}\n` +
			`  Window frames: ${frameCount}\n` +
			`  Recent places: ${snapshot.recentPlaces.length}\n` +
			`  Sidebar width: ${snapshot.finderSidebarWidth || 'default'}`,
	};
}

/**
 * Restore macOS preferences from a saved snapshot.
 * Optionally accepts a label or index to restore a specific snapshot.
 */
async function macos_prefs_restore(args) {
	if (process.platform !== 'darwin') {
		return { ok: false, result: 'macOS only — this tool is not available on other platforms' };
	}

	if (!fs.existsSync(SNAPSHOT_PATH)) {
		return { ok: false, result: `No snapshot file found at ${SNAPSHOT_PATH}. Run macos_prefs_snapshot first.` };
	}

	let snapshots;
	try {
		snapshots = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
		if (!Array.isArray(snapshots)) snapshots = [snapshots];
	} catch (err) {
		return { ok: false, result: `Failed to parse snapshot file: ${err.message}` };
	}

	if (snapshots.length === 0) {
		return { ok: false, result: 'Snapshot file is empty' };
	}

	// Pick the snapshot to restore
	const label = args?.label;
	const index = args?.index;
	let snapshot;

	if (label) {
		snapshot = snapshots.find(s => s.label === label);
		if (!snapshot) return { ok: false, result: `No snapshot with label "${label}" found` };
	} else if (index !== undefined) {
		snapshot = snapshots[parseInt(index, 10)];
		if (!snapshot) return { ok: false, result: `No snapshot at index ${index}` };
	} else {
		snapshot = snapshots[snapshots.length - 1]; // Latest
	}

	const categories = args?.categories || 'all'; // 'all' | 'finder' | 'window' | 'recent'
	const results = [];
	let applied = 0;
	let failed = 0;

	// Restore Finder prefs
	if (categories === 'all' || categories === 'finder') {
		for (const [domain, key, type] of FINDER_PREFS) {
			const compositeKey = `${domain}:${key}`;
			const val = snapshot.finder?.[compositeKey];
			if (val !== undefined) {
				if (writeDefault(domain, key, type, val)) {
					applied++;
				} else {
					failed++;
					results.push(`Failed to write ${compositeKey}`);
				}
			}
		}
	}

	// Restore Window/Dock prefs
	if (categories === 'all' || categories === 'window') {
		for (const [domain, key, type] of WINDOW_PREFS) {
			const compositeKey = `${domain}:${key}`;
			const val = snapshot.window?.[compositeKey];
			if (val !== undefined) {
				if (writeDefault(domain, key, type, val)) {
					applied++;
				} else {
					failed++;
					results.push(`Failed to write ${compositeKey}`);
				}
			}
		}

		// Restore Finder window frames
		if (snapshot.finderWindowFrames) {
			for (const [name, frame] of Object.entries(snapshot.finderWindowFrames)) {
				const r = spawnSync('defaults', [
					'write', 'com.apple.finder', `NSWindow Frame ${name}`, '-string', frame,
				], { encoding: 'utf8', timeout: 5000 });
				if (r.status === 0) applied++;
				else {
					failed++;
					results.push(`Failed to restore frame: ${name}`);
				}
			}
		}

		// Restore sidebar width
		if (snapshot.finderSidebarWidth !== undefined && snapshot.finderSidebarWidth !== null) {
			if (writeDefault('com.apple.finder', 'SidebarWidth', 'integer', snapshot.finderSidebarWidth)) {
				applied++;
			}
		}
	}

	// Restore recent places
	if (categories === 'all' || categories === 'recent') {
		if (snapshot.recentPlaces && snapshot.recentPlaces.length > 0) {
			// Write as a plist array via defaults
			try {
				const arrayArgs = ['write', 'NSGlobalDomain', 'NSNavRecentPlaces', '-array'];
				for (const place of snapshot.recentPlaces) {
					arrayArgs.push(place);
				}
				const r = spawnSync('defaults', arrayArgs, { encoding: 'utf8', timeout: 5000 });
				if (r.status === 0) applied++;
				else results.push('Failed to restore recent places');
			} catch {
				results.push('Failed to restore recent places');
			}
		}

		// Restore FXRecentFolders via defaults import if we have the XML
		if (snapshot.recentFolders && typeof snapshot.recentFolders === 'string' && snapshot.recentFolders.includes('<array>')) {
			try {
				// Build a minimal plist with just FXRecentFolders
				const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>FXRecentFolders</key>
	${snapshot.recentFolders}
</dict>
</plist>`;
				const tmpFile = path.join(os.tmpdir(), 'iris-recent-folders.plist');
				fs.writeFileSync(tmpFile, plist, 'utf-8');
				// Merge into the Finder domain
				const r = spawnSync('defaults', ['import', 'com.apple.finder', tmpFile], {
					encoding: 'utf8',
					timeout: 5000,
				});
				try { fs.unlinkSync(tmpFile); } catch {}
				if (r.status === 0) {
					applied++;
				} else {
					results.push('Failed to restore recent folders via import');
				}
			} catch (err) {
				results.push(`Failed to restore recent folders: ${err.message}`);
			}
		}
	}

	// Restart Finder and Dock to apply changes
	try {
		execSync('killall Finder 2>/dev/null; killall Dock 2>/dev/null', { timeout: 5000 });
	} catch {}

	log.info('MacOSPrefs', `Restore "${snapshot.label}": ${applied} applied, ${failed} failed`);

	const summary = `Restored snapshot "${snapshot.label}" (${snapshot.createdAt})\n` +
		`  Applied: ${applied} settings\n` +
		`  Failed: ${failed}` +
		(results.length > 0 ? '\n  Issues:\n    ' + results.join('\n    ') : '') +
		'\n  Finder and Dock restarted to apply changes.';

	return { ok: !failed, result: summary };
}

/**
 * List current macOS preferences or available snapshots.
 */
async function macos_prefs_list(args) {
	if (process.platform !== 'darwin') {
		return { ok: false, result: 'macOS only' };
	}

	const mode = args?.mode || 'current'; // 'current' | 'snapshots'

	if (mode === 'snapshots') {
		if (!fs.existsSync(SNAPSHOT_PATH)) {
			return { ok: true, result: 'No snapshots saved yet.' };
		}
		let snapshots;
		try {
			snapshots = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
			if (!Array.isArray(snapshots)) snapshots = [snapshots];
		} catch {
			return { ok: false, result: 'Failed to read snapshot file' };
		}
		const lines = snapshots.map((s, i) => {
			const finderCount = Object.keys(s.finder || {}).length;
			const windowCount = Object.keys(s.window || {}).length;
			return `[${i}] "${s.label}" — ${s.createdAt} (${finderCount} finder, ${windowCount} window prefs)`;
		});
		return { ok: true, result: `${snapshots.length} snapshot(s):\n` + lines.join('\n') };
	}

	// mode === 'current': read live values
	const lines = [];

	lines.push('── Finder Preferences ──');
	for (const [domain, key] of FINDER_PREFS) {
		const val = readDefault(domain, key);
		if (val !== undefined) {
			lines.push(`  ${key}: ${val}`);
		}
	}

	lines.push('\n── Window & Dock Preferences ──');
	for (const [domain, key] of WINDOW_PREFS) {
		const val = readDefault(domain, key);
		if (val !== undefined) {
			lines.push(`  ${key}: ${val}`);
		}
	}

	const recentPlaces = readRecentPlaces();
	if (recentPlaces.length > 0) {
		lines.push('\n── Recent Places ──');
		for (const place of recentPlaces.slice(0, 20)) {
			lines.push(`  ${place}`);
		}
	}

	const frames = readFinderWindowBounds();
	if (Object.keys(frames).length > 0) {
		lines.push('\n── Finder Window Frames ──');
		for (const [name, frame] of Object.entries(frames)) {
			lines.push(`  ${name}: ${frame}`);
		}
	}

	const sidebarWidth = readFinderSidebarWidth();
	if (sidebarWidth) {
		lines.push(`\n── Sidebar Width: ${sidebarWidth} ──`);
	}

	return { ok: true, result: lines.join('\n') };
}

// Exported for standalone script usage
module.exports = {
	macos_prefs_snapshot,
	macos_prefs_restore,
	macos_prefs_list,
	// Internal helpers exposed for testing
	_internal: {
		readDefault,
		writeDefault,
		readRecentFolders,
		readRecentPlaces,
		readFinderWindowBounds,
		readFinderSidebarWidth,
		FINDER_PREFS,
		WINDOW_PREFS,
		SNAPSHOT_PATH,
	},
};
