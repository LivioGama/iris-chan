#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KEY = 'NSCameraUseContinuityCameraDeviceType';
const ROOT = path.resolve(__dirname, '..');
const ELECTRON_APP_PATH = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const PATCH_SCRIPT = path.join(ROOT, 'scripts', 'patch-electron-macos-plists.js');
const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

if (process.platform !== 'darwin') {
	process.stdout.write('Skipping: macOS-only verification\n');
	process.exit(0);
}

if (!fs.existsSync(ELECTRON_APP_PATH)) {
	fail(`Electron bundle not found: ${ELECTRON_APP_PATH}`);
}

const patchRun = spawnSync(process.execPath, [PATCH_SCRIPT], {
	cwd: ROOT,
	encoding: 'utf8',
});

if (patchRun.status !== 0) {
	fail(patchRun.stderr || patchRun.stdout || 'Patch script failed');
}

const plistPaths = [
	path.join(ELECTRON_APP_PATH, 'Contents', 'Info.plist'),
	path.join(ELECTRON_APP_PATH, 'Contents', 'Frameworks', 'Electron Helper.app', 'Contents', 'Info.plist'),
	path.join(ELECTRON_APP_PATH, 'Contents', 'Frameworks', 'Electron Helper (GPU).app', 'Contents', 'Info.plist'),
	path.join(ELECTRON_APP_PATH, 'Contents', 'Frameworks', 'Electron Helper (Plugin).app', 'Contents', 'Info.plist'),
	path.join(ELECTRON_APP_PATH, 'Contents', 'Frameworks', 'Electron Helper (Renderer).app', 'Contents', 'Info.plist'),
];

for (const plistPath of plistPaths) {
	if (!fs.existsSync(plistPath)) {
		fail(`Missing plist: ${plistPath}`);
	}

	const readRun = spawnSync(PLIST_BUDDY, ['-c', `Print :${KEY}`, plistPath], {
		encoding: 'utf8',
	});

	if (readRun.status !== 0) {
		fail(`Key missing in ${plistPath}`);
	}

	if (readRun.stdout.trim() !== 'true') {
		fail(`Unexpected value in ${plistPath}: ${readRun.stdout.trim()}`);
	}

	process.stdout.write(`Verified ${KEY}=true in ${plistPath}\n`);
}
