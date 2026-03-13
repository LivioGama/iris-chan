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

	const proactiveModeResult = await update_settings({
		request: 'set mode to autonomous',
	});
	assert.strictEqual(proactiveModeResult.ok, true, 'legacy autonomous mode requests should still succeed');
	assert.strictEqual(settings.getSettings().behavior.mode, 'proactive', 'legacy autonomous should normalize to proactive');

	const passiveModeResult = await update_settings({
		request: 'set mode to attentive',
	});
	assert.strictEqual(passiveModeResult.ok, true, 'legacy attentive mode requests should still succeed');
	assert.strictEqual(settings.getSettings().behavior.mode, 'passive', 'legacy attentive should normalize to passive');

	const feedbackModeResult = await update_settings({
		request: 'turn feedback mode on',
	});
	assert.strictEqual(feedbackModeResult.ok, true, 'feedback mode requests should succeed');
	assert.strictEqual(settings.getSettings().behavior.feedbackEnabled, true, 'feedback mode should persist in behavior settings');

	const introversionModeResult = await update_settings({
		request: 'turn introversion mode on',
	});
	assert.strictEqual(introversionModeResult.ok, true, 'introversion mode requests should succeed');
	assert.strictEqual(settings.getSettings().behavior.introversionEnabled, true, 'introversion mode should persist in behavior settings');

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
	assert.strictEqual(switchPresetResult.translator, 'deterministic', 'known voice preset requests should prefer deterministic parsing');
	assert.ok(Array.isArray(switchPresetResult.patchSummary), 'voice mutations should expose a patch summary');
	assert.strictEqual(switchPresetResult.noChangeReason, null, 'successful voice preset changes should not report a no-change reason');

	process.env.GROQ_API_KEY = 'test-groq-key';
	const originalFetchForMutation = global.fetch;
	let fetchCalls = 0;
	global.fetch = async () => {
		fetchCalls += 1;
		return {
			ok: true,
			async json() {
				return {
					choices: [{
						message: {
							content: JSON.stringify({
								patch: {
									voice: { modelVoiceName: 'Kore' },
								},
							}),
						},
					}],
				};
			},
		};
	};
	settings.updateSettings({
		voice: {
			modelVoiceName: 'Charon',
			speechProfile: settings.DEFAULT_SETTINGS.voice.speechProfile,
		},
	}, { source: 'test:reset-before-deep-bloom' });
	const deepBloomWarmResult = await update_settings({
		request: 'switch to Deep Bloom, Warm',
	});
	assert.strictEqual(deepBloomWarmResult.ok, true, 'deterministic voice requests should still succeed when Groq is configured');
	assert.strictEqual(deepBloomWarmResult.translator, 'deterministic', 'voice requests should resolve locally before Groq');
	assert.strictEqual(fetchCalls, 0, 'deterministic voice parsing should skip the Groq mutation translator');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Aoede', 'deep bloom warm should land on the soft bloom/Aoede preset path');
	assert.ok(deepBloomWarmResult.changedKeys.includes('voice.modelVoiceName'), 'deep bloom warm should report concrete changed keys');

	const noOpResult = await update_settings({
		request: 'switch to Deep Bloom, Warm',
	});
	assert.strictEqual(noOpResult.ok, true, 'reapplying the same voice request should still succeed');
	assert.deepStrictEqual(noOpResult.changedKeys, [], 'reapplying the same voice request should be a no-op');
	assert.strictEqual(noOpResult.noChangeReason, 'requested_settings_already_match_current_state', 'no-op mutations should explain why nothing changed');
	assert.ok(noOpResult.patchSummary.includes('voice.modelVoiceName'), 'no-op responses should still show the resolved patch summary');
	global.fetch = originalFetchForMutation;
	delete process.env.GROQ_API_KEY;

	const tweakResult = await update_settings({
		request: 'make it warmer and slower',
	});
	assert.strictEqual(tweakResult.ok, true, 'preset-aware tweak request should succeed');
	assert.ok(settings.getSettings().voice.speechProfile.warmthGainDb > 1.6, 'warmer tweak should raise warmth gain on top of the preset base');
	assert.ok(settings.getSettings().voice.speechProfile.playbackRate < 0.98, 'slower tweak should reduce playback rate on top of the preset base');

	settings.updateSettings({
		voice: settings.DEFAULT_SETTINGS.voice,
	}, { source: 'test:reset-before-different-voice' });
	const differentVoiceResult = await update_settings({
		request: 'चेंज यो वॉइस टू डिफरेंट',
	});
	assert.strictEqual(differentVoiceResult.ok, true, 'mixed Nepali/English change-voice requests should resolve deterministically');
	assert.strictEqual(differentVoiceResult.translator, 'deterministic', 'mixed-language voice changes should stay on the local parser path');
	assert.notStrictEqual(settings.getSettings().voice.modelVoiceName, 'Charon', 'generic different-voice request should pick a non-current preset');
	assert.ok(differentVoiceResult.changedKeys.includes('voice.modelVoiceName'), 'different-voice requests should expose the concrete changed voice key');

	settings.updateSettings({
		voice: settings.DEFAULT_SETTINGS.voice,
	}, { source: 'test:reset-before-deeper-voice' });
	const deeperVoiceResult = await update_settings({
		request: 'change yo voice to deeper',
	});
	assert.strictEqual(deeperVoiceResult.ok, true, 'deeper voice requests should map to a bundled preset');
	assert.strictEqual(settings.getSettings().voice.modelVoiceName, 'Charon', 'deeper voice intent should land on the deeper velvet dusk path');
	assert.ok(settings.getSettings().voice.speechProfile.playbackRate <= 0.92, 'deeper voice preset should slow playback enough to lower perceived voice');

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
