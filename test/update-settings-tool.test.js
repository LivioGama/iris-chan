const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log('Running update_settings tool tests...');

async function main() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-update-settings-'));
	process.env.IRIS_SETTINGS_PATH = path.join(tempDir, 'settings.json');

	const settingsPath = require.resolve('../src/main/settings.js');
	const systemToolPath = require.resolve('../src/main/tools/system.js');
	delete require.cache[settingsPath];
	delete require.cache[systemToolPath];

	const settings = require('../src/main/settings.js');
	settings.init();
	const { update_settings, route_request } = require('../src/main/tools/system.js');

	const result = await update_settings({
		patch: JSON.stringify({
			voice: { modelVoiceName: 'Kore' },
			behavior: { directMode: true },
		}),
	});
	assert.strictEqual(result.ok, true, 'update_settings should accept an explicit JSON patch');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Kore', 'explicit patch should update the voice setting');
	assert.strictEqual(settings.getSettings().behavior.directMode, true, 'explicit patch should update behavior settings');

	const keyResult = await update_settings({
		key: 'avatar.current',
		value: 'tripo3d',
	});
	assert.strictEqual(keyResult.ok, true, 'update_settings should support key/value updates');
	assert.strictEqual(settings.getSettings().avatar.current, 'tripo3d', 'key/value path should be written into settings.json');

	const requestResult = await update_settings({
		request: 'set voice to Aoede',
	});
	assert.strictEqual(requestResult.ok, true, 'update_settings should support deterministic request parsing without GROQ');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Aoede', 'deterministic request parsing should map onto stable setting keys');

	const presetListResult = await update_settings({
		request: 'list available voice presets',
	});
	assert.strictEqual(presetListResult.ok, true, 'voice preset listing should succeed');
	assert.strictEqual(presetListResult.queryKind, 'voice_preset_list', 'voice preset listing should use the structured query kind');
	assert.match(presetListResult.summary, /Available voice presets:/, 'voice preset listing should include a natural-language summary');
	const presetList = JSON.parse(presetListResult.result);
	assert.strictEqual(presetList.queryKind, 'voice_preset_list', 'serialized query result should include the query kind');
	assert.ok(Array.isArray(presetList.data.presets), 'preset listing should return a presets array');
	assert.ok(presetList.data.presets.length >= 3, 'preset listing should include the built-in catalog');
	assert.ok(presetList.data.presets.every((preset) => preset.name && preset.description), 'preset listing should include names and descriptions');

	const switchPresetResult = await update_settings({
		request: 'switch to soft bloom voice preset',
	});
	assert.strictEqual(switchPresetResult.ok, true, 'switching to a named preset should succeed');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Aoede', 'preset selection should flatten the preset model voice into settings');
	assert.strictEqual(settings.getSettings().voice.speechProfile.playbackRate, 0.98, 'preset selection should flatten the preset speech profile into settings');

	const tweakResult = await update_settings({
		request: 'make it warmer and slower',
	});
	assert.strictEqual(tweakResult.ok, true, 'preset-aware tweak request should succeed');
	assert.ok(settings.getSettings().voice.speechProfile.warmthGainDb > 1.6, 'warmer tweak should raise warmth gain on top of the preset base');
	assert.ok(settings.getSettings().voice.speechProfile.playbackRate < 0.98, 'slower tweak should reduce playback rate on top of the preset base');

	const missingPresetResult = await update_settings({
		request: 'switch to moonlight voice preset',
	});
	assert.strictEqual(missingPresetResult.ok, false, 'unknown preset names should fail clearly');
	assert.match(missingPresetResult.result, /Available presets:/, 'unknown preset failures should list available alternatives');

	const invalidResult = await update_settings({
		patch: JSON.stringify({
			notAllowed: { shell: 'rm -rf /' },
		}),
	});
	assert.strictEqual(invalidResult.ok, true, 'invalid namespaces should be sanitized rather than causing arbitrary writes');
	const diskSettings = JSON.parse(fs.readFileSync(process.env.IRIS_SETTINGS_PATH, 'utf-8'));
	assert.ok(!('notAllowed' in diskSettings), 'sanitization should prevent undeclared namespaces from landing on disk');
	assert.strictEqual(diskSettings.voice.modelVoiceName, settings.getSettings().voice.modelVoiceName, 'voice preset changes should persist to disk');

	const originalGroq = process.env.GROQ_API_KEY;
	delete process.env.GROQ_API_KEY;
	const routeFail = await route_request({ request: 'What voice presets do you have available' });
	assert.strictEqual(routeFail.ok, false, 'route_request should fail closed without Groq');

	process.env.GROQ_API_KEY = 'test-groq-key';
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		async json() {
			return {
				choices: [{
					message: {
						content: JSON.stringify({
							route: 'settings_query',
							settingsNamespace: 'voice',
							settingsCapable: true,
						}),
					},
				}],
			};
		},
	});
	const routeOk = await route_request({ request: 'What voice presets do you have available' });
	assert.strictEqual(routeOk.ok, true, 'route_request should accept a valid Groq route payload');
	const routed = JSON.parse(routeOk.result);
	assert.strictEqual(routed.route, 'settings_query', 'route_request should preserve the validated route');
	global.fetch = originalFetch;
	if (originalGroq == null) {
		delete process.env.GROQ_API_KEY;
	} else {
		process.env.GROQ_API_KEY = originalGroq;
	}
	settings.shutdown();

	console.log('update_settings tool tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
