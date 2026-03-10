#!/usr/bin/env node

// Standalone CLI for macOS Finder & window preferences backup/restore.
//
// Usage:
//   node scripts/macos-prefs-manager.js snapshot [label]
//   node scripts/macos-prefs-manager.js restore  [label | --index N] [--categories all|finder|window|recent]
//   node scripts/macos-prefs-manager.js list      [current | snapshots]
//
// All snapshots are saved to ~/.iris/macos-prefs-snapshot.json.

const path = require('path');

// Wire up the logger so the tool module doesn't throw
const log = {
	info: (tag, ...args) => process.stdout.write(`[${tag}] ${args.join(' ')}\n`),
	warn: (tag, ...args) => process.stderr.write(`[${tag}] WARN: ${args.join(' ')}\n`),
	error: (tag, ...args) => process.stderr.write(`[${tag}] ERROR: ${args.join(' ')}\n`),
};

// Patch require so the tool module finds "../logger" and "../workspace"
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
	exports: {
		get: () => process.cwd(),
		set: () => ({ ok: true }),
		resolve: (p) => path.resolve(p),
	},
	loaded: true,
};

const {
	macos_prefs_snapshot,
	macos_prefs_restore,
	macos_prefs_list,
} = require('../src/main/tools/macos-prefs');

async function main() {
	if (process.platform !== 'darwin') {
		process.stderr.write('This tool only works on macOS.\n');
		process.exit(1);
	}

	const [,, command, ...rest] = process.argv;

	if (!command || command === '--help' || command === '-h') {
		process.stdout.write(`
macOS Preferences Manager — Backup & Restore Finder, Dock, and Window prefs

Commands:
  snapshot [label]           Save current preferences (default label = timestamp)
  restore  [options]         Restore preferences from a saved snapshot
    --label <name>           Restore a specific labeled snapshot
    --index <n>              Restore by numeric index
    --categories <cat>       all | finder | window | recent  (default: all)
  list [mode]                List current prefs or saved snapshots
    current                  Show live macOS preference values (default)
    snapshots                Show saved snapshots

Examples:
  node scripts/macos-prefs-manager.js snapshot "before-cleanup"
  node scripts/macos-prefs-manager.js restore --label "before-cleanup"
  node scripts/macos-prefs-manager.js restore --categories finder
  node scripts/macos-prefs-manager.js list snapshots
`);
		process.exit(0);
	}

	let result;

	switch (command) {
		case 'snapshot': {
			const label = rest[0] || undefined;
			result = await macos_prefs_snapshot({ label });
			break;
		}
		case 'restore': {
			const args = {};
			for (let i = 0; i < rest.length; i++) {
				if (rest[i] === '--label' && rest[i + 1]) { args.label = rest[++i]; continue; }
				if (rest[i] === '--index' && rest[i + 1]) { args.index = rest[++i]; continue; }
				if (rest[i] === '--categories' && rest[i + 1]) { args.categories = rest[++i]; continue; }
				// Bare positional = label
				if (!rest[i].startsWith('--')) args.label = rest[i];
			}
			result = await macos_prefs_restore(args);
			break;
		}
		case 'list': {
			const mode = rest[0] || 'current';
			result = await macos_prefs_list({ mode });
			break;
		}
		default:
			process.stderr.write(`Unknown command: ${command}\nRun with --help for usage.\n`);
			process.exit(1);
	}

	process.stdout.write(result.result + '\n');
	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err.message}\n`);
	process.exit(1);
});
