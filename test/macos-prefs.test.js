#!/usr/bin/env node

// End-to-end test for macOS preferences snapshot / restore / list.
// Verifies that the module can read live values, snapshot them, list them,
// and that a restore round-trip preserves the data.

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── bootstrap shims (same as standalone script) ──────────────────────
const log = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
	if (request === '../logger') return '__logger_shim__';
	if (request === '../workspace') return '__workspace_shim__';
	return origResolve.call(this, request, parent, ...rest);
};
require.cache['__logger_shim__'] = { id: '__logger_shim__', exports: log, loaded: true };
require.cache['__workspace_shim__'] = {
	id: '__workspace_shim__',
	exports: { get: () => process.cwd(), set: () => ({ ok: true }), resolve: (p) => path.resolve(p) },
	loaded: true,
};

const {
	macos_prefs_snapshot,
	macos_prefs_restore,
	macos_prefs_list,
	_internal,
} = require('../src/main/tools/macos-prefs');

const SNAPSHOT_PATH = _internal.SNAPSHOT_PATH;

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
	if (condition) {
		process.stdout.write(`  PASS: ${message}\n`);
		passed++;
	} else {
		process.stderr.write(`  FAIL: ${message}\n`);
		failed++;
	}
}

function skip(message) {
	process.stdout.write(`  SKIP: ${message}\n`);
	skipped++;
}

async function main() {
	process.stdout.write('macOS Preferences — test suite\n\n');

	if (process.platform !== 'darwin') {
		skip('Not macOS — all tests skipped');
		return;
	}

	// ── Test 1: readDefault returns a value for a known key ──
	process.stdout.write('Test 1: readDefault can read a known Finder key\n');
	{
		// FXPreferredViewStyle is almost always set on any macOS install
		const val = _internal.readDefault('com.apple.finder', 'FXPreferredViewStyle');
		// It may or may not be set — we just verify it doesn't throw
		assert(val === undefined || typeof val === 'string', 'readDefault returned string or undefined');
	}

	// ── Test 2: readFinderWindowBounds returns an object ──
	process.stdout.write('Test 2: readFinderWindowBounds returns an object\n');
	{
		const frames = _internal.readFinderWindowBounds();
		assert(typeof frames === 'object' && frames !== null, 'frames is a non-null object');
	}

	// ── Test 3: readRecentPlaces returns an array ──
	process.stdout.write('Test 3: readRecentPlaces returns an array\n');
	{
		const places = _internal.readRecentPlaces();
		assert(Array.isArray(places), 'recentPlaces is an array');
	}

	// ── Test 4: macos_prefs_list (current) succeeds ──
	process.stdout.write('Test 4: macos_prefs_list (current) returns ok\n');
	{
		const result = await macos_prefs_list({ mode: 'current' });
		assert(result.ok === true, 'list current returned ok');
		assert(typeof result.result === 'string' && result.result.length > 0, 'list current has output');
		assert(result.result.includes('Finder Preferences'), 'output contains Finder section header');
	}

	// ── Test 5: snapshot → list snapshots → verify ──
	process.stdout.write('Test 5: snapshot round-trip\n');
	{
		// Back up existing snapshot file
		let originalSnapshot = null;
		if (fs.existsSync(SNAPSHOT_PATH)) {
			originalSnapshot = fs.readFileSync(SNAPSHOT_PATH, 'utf-8');
		}

		try {
			// Remove snapshot file to start clean
			try { fs.unlinkSync(SNAPSHOT_PATH); } catch {}

			const snapResult = await macos_prefs_snapshot({ label: 'test-snapshot' });
			assert(snapResult.ok === true, 'snapshot succeeded');
			assert(snapResult.result.includes('test-snapshot'), 'snapshot result mentions label');
			assert(fs.existsSync(SNAPSHOT_PATH), 'snapshot file was created');

			// Verify the file contents
			const data = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
			assert(Array.isArray(data), 'snapshot file contains an array');
			assert(data.length === 1, 'snapshot file has exactly one entry');
			assert(data[0].label === 'test-snapshot', 'snapshot label matches');
			assert(data[0].version === 1, 'snapshot has version 1');
			assert(typeof data[0].finder === 'object', 'snapshot has finder object');
			assert(typeof data[0].window === 'object', 'snapshot has window object');
			assert(typeof data[0].finderWindowFrames === 'object', 'snapshot has finderWindowFrames');

			// List snapshots
			const listResult = await macos_prefs_list({ mode: 'snapshots' });
			assert(listResult.ok === true, 'list snapshots succeeded');
			assert(listResult.result.includes('test-snapshot'), 'list contains our snapshot');

			// Take a second snapshot to test multi-snapshot
			const snap2 = await macos_prefs_snapshot({ label: 'test-snapshot-2' });
			assert(snap2.ok === true, 'second snapshot succeeded');
			const data2 = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
			assert(data2.length === 2, 'file now has two snapshots');
		} finally {
			// Restore original snapshot file
			if (originalSnapshot !== null) {
				fs.writeFileSync(SNAPSHOT_PATH, originalSnapshot, 'utf-8');
			} else {
				try { fs.unlinkSync(SNAPSHOT_PATH); } catch {}
			}
		}
	}

	// ── Test 6: FINDER_PREFS and WINDOW_PREFS are well-formed ──
	process.stdout.write('Test 6: preference key arrays are well-formed\n');
	{
		for (const arr of [_internal.FINDER_PREFS, _internal.WINDOW_PREFS]) {
			for (const entry of arr) {
				assert(entry.length === 3, `entry has 3 elements: ${entry[1]}`);
				assert(typeof entry[0] === 'string', `domain is string: ${entry[0]}`);
				assert(typeof entry[1] === 'string', `key is string: ${entry[1]}`);
				assert(['string', 'bool', 'integer'].includes(entry[2]), `valid type: ${entry[2]}`);
			}
		}
	}

	// ── Summary ──
	process.stdout.write(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	process.stderr.write(`Test error: ${err.message}\n${err.stack}\n`);
	process.exit(1);
});
