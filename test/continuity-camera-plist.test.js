#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_KEYS = [
	{ key: 'NSCameraUseContinuityCameraDeviceType', expected: 'true' },
	{
		key: 'NSMicrophoneUsageDescription',
		expected: 'Iris uses the microphone for real-time voice conversations.',
	},
];
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

	for (const keySpec of REQUIRED_KEYS) {
		const readRun = spawnSync(PLIST_BUDDY, ['-c', `Print :${keySpec.key}`, plistPath], {
			encoding: 'utf8',
		});

		if (readRun.status !== 0) {
			fail(`Key ${keySpec.key} missing in ${plistPath}`);
		}

		if (readRun.stdout.trim() !== keySpec.expected) {
			fail(`Unexpected value for ${keySpec.key} in ${plistPath}: ${readRun.stdout.trim()}`);
		}

		process.stdout.write(`Verified ${keySpec.key} in ${plistPath}\n`);
	}
}
