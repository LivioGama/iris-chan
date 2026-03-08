#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KEY = 'NSCameraUseContinuityCameraDeviceType';
const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

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

function readKey(plistPath) {
	const result = run(PLIST_BUDDY, ['-c', `Print :${KEY}`, plistPath]);
	if (result.status !== 0) {
		return null;
	}

	return result.stdout.trim();
}

function writeKey(plistPath) {
	const current = readKey(plistPath);
	if (current === 'true') {
		return false;
	}

	const command = current === null
		? `Add :${KEY} bool true`
		: `Set :${KEY} true`;
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
		if (writeKey(plistPath)) {
			changed++;
			log(`Patched ${plistPath}`);
		}
	}

	if (changed === 0) {
		log('All target plists already contain the Continuity Camera key');
	}
}

try {
	main();
} catch (error) {
	process.stderr.write(`[electron-plist-patch] ${error.message}\n`);
	process.exit(1);
}
