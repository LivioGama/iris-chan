const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log('Running runtime settings service tests...');

async function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-settings-'));
	process.env.IRIS_SETTINGS_PATH = path.join(tempDir, 'settings.json');

	const settingsPath = require.resolve('../src/main/settings.js');
	delete require.cache[settingsPath];
	const settings = require('../src/main/settings.js');

	const initial = settings.init();
	assert.ok(fs.existsSync(process.env.IRIS_SETTINGS_PATH), 'settings init should create ~/.iris/settings.json when absent');
	assert.strictEqual(initial.voice.modelVoiceName, 'Charon', 'voice defaults should come from the shared config contract');

	const updated = settings.updateSettings({
		voice: {
			modelVoiceName: 'Kore',
			speechProfile: { playbackRate: 0.97 },
		},
		avatar: {
			current: 'tripo3d',
		},
	});
	assert.strictEqual(updated.ok, true, 'settings update should succeed');
	assert.ok(updated.changedKeys.includes('voice.modelVoiceName'), 'changed keys should include patched voice settings');

	const unregisterVoiceHandler = settings.registerApplyHandler('voice', (nextVoice, previousVoice) => ({
		applied: true,
		liveApply: true,
		restartRequired: false,
		sessionRefreshRequired: nextVoice?.modelVoiceName !== previousVoice?.modelVoiceName,
	}));
	const voiced = settings.updateSettings({
		voice: {
			modelVoiceName: 'Aoede',
		},
	});
	assert.strictEqual(voiced.namespaceStatuses.find((status) => status.namespace === 'voice')?.sessionRefreshRequired, true, 'voice apply handlers should be able to expose session-refresh metadata');
	unregisterVoiceHandler();

	const diskSettings = JSON.parse(fs.readFileSync(process.env.IRIS_SETTINGS_PATH, 'utf-8'));
	assert.strictEqual(diskSettings.voice.modelVoiceName, 'Aoede', 'voice updates should persist to disk');
	assert.strictEqual(diskSettings.avatar.current, 'tripo3d', 'avatar settings should persist to disk');

	const presetPatch = settings.buildVoicePresetPatch('soft bloom');
	assert.ok(presetPatch, 'settings should expose built-in preset helpers');
	const presetApplied = settings.updateSettings(presetPatch, { source: 'test:preset' });
	assert.strictEqual(presetApplied.ok, true, 'flattened preset patch should apply cleanly');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Aoede', 'preset helper should resolve the bundled model voice');
	assert.strictEqual(settings.getSettings().voice.speechProfile.playbackRate, 0.98, 'preset helper should resolve the bundled speech profile');

	let watched = null;
	const unsubscribe = settings.onChange((nextSettings, meta) => {
		watched = { nextSettings, meta };
	});
	fs.writeFileSync(process.env.IRIS_SETTINGS_PATH, JSON.stringify({
		voice: {
			modelVoiceName: 'Aoede',
			speechProfile: {
				playbackRate: 0.91,
			},
		},
		logging: {
			console: {
				level: 'warn',
			},
		},
	}, null, 2), 'utf-8');
	await wait(300);
	unsubscribe();

	assert.ok(watched, 'file watcher should notice external settings.json edits');
	assert.strictEqual(watched.nextSettings.voice.modelVoiceName, 'Aoede', 'watch reload should broadcast the new voice settings');
	assert.strictEqual(watched.nextSettings.logging.console.level, 'warn', 'watch reload should merge valid external changes');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Aoede', 'in-memory settings should track the externally edited file');
	settings.shutdown();

	console.log('Runtime settings service tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
