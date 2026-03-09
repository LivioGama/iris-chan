#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';
const REQUIRED_KEYS = [
	{
		key: 'NSCameraUseContinuityCameraDeviceType',
		type: 'bool',
		value: 'true',
	},
	{
		key: 'NSMicrophoneUsageDescription',
		type: 'string',
		value: 'Iris uses the microphone for real-time voice conversations.',
	},
];

function log(message) {
	process.stdout.write(`[electron-plist-patch] ${message}\n`);
}

function run(command, args) {
	return spawnSync(command, args, { encoding: 'utf8' });
}

function getElectronAppPath() {
	if (process.env.ELECTRON_APP_PATH) {
		return path.resolve(process.env.ELECTRON_APP_PATH);
	}

	return path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');
}

function getTargetPlists(electronAppPath) {
	const frameworkDir = path.join(electronAppPath, 'Contents', 'Frameworks');

	return [
		path.join(electronAppPath, 'Contents', 'Info.plist'),
		path.join(frameworkDir, 'Electron Helper.app', 'Contents', 'Info.plist'),
		path.join(frameworkDir, 'Electron Helper (GPU).app', 'Contents', 'Info.plist'),
		path.join(frameworkDir, 'Electron Helper (Plugin).app', 'Contents', 'Info.plist'),
		path.join(frameworkDir, 'Electron Helper (Renderer).app', 'Contents', 'Info.plist'),
	].filter((plistPath) => fs.existsSync(plistPath));
}

function readKey(plistPath, key) {
	const result = run(PLIST_BUDDY, ['-c', `Print :${key}`, plistPath]);
	if (result.status !== 0) {
		return null;
	}

	return result.stdout.trim();
}

function formatValueForPlistBuddy(keySpec) {
	if (keySpec.type === 'bool') {
		return keySpec.value;
	}
	return JSON.stringify(keySpec.value);
}

function writeKey(plistPath, keySpec) {
	const current = readKey(plistPath, keySpec.key);
	if (current === keySpec.value) {
		return false;
	}

	const formattedValue = formatValueForPlistBuddy(keySpec);
	const command = current === null
		? `Add :${keySpec.key} ${keySpec.type} ${formattedValue}`
		: `Set :${keySpec.key} ${formattedValue}`;
	const result = run(PLIST_BUDDY, ['-c', command, plistPath]);

	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout || '').trim();
		throw new Error(`Failed updating ${plistPath}: ${detail}`);
	}

	return true;
}

function main() {
	if (process.platform !== 'darwin') {
		log('Skipping: macOS-only patch');
		return;
	}

	if (!fs.existsSync(PLIST_BUDDY)) {
		throw new Error(`Missing required tool: ${PLIST_BUDDY}`);
	}

	const electronAppPath = getElectronAppPath();
	if (!fs.existsSync(electronAppPath)) {
		log(`Skipping: Electron.app not found at ${electronAppPath}`);
		return;
	}

	const plistPaths = getTargetPlists(electronAppPath);
	if (plistPaths.length === 0) {
		log(`Skipping: no target plists found under ${electronAppPath}`);
		return;
	}

	let changed = 0;
	for (const plistPath of plistPaths) {
		let plistChanged = false;
		for (const keySpec of REQUIRED_KEYS) {
			if (writeKey(plistPath, keySpec)) {
				changed++;
				plistChanged = true;
			}
		}
		if (plistChanged) {
			log(`Patched ${plistPath}`);
		}
	}

	if (changed === 0) {
		log('All target plists already contain the required macOS permission keys');
	}
}

try {
	main();
} catch (error) {
	process.stderr.write(`[electron-plist-patch] ${error.message}\n`);
	process.exit(1);
}
