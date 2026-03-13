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
	const { update_settings } = require('../src/main/tools/system.js');

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

	const invalidResult = await update_settings({
		patch: JSON.stringify({
			notAllowed: { shell: 'rm -rf /' },
		}),
	});
	assert.strictEqual(invalidResult.ok, true, 'invalid namespaces should be sanitized rather than causing arbitrary writes');
	const diskSettings = JSON.parse(fs.readFileSync(process.env.IRIS_SETTINGS_PATH, 'utf-8'));
	assert.ok(!('notAllowed' in diskSettings), 'sanitization should prevent undeclared namespaces from landing on disk');
	settings.shutdown();

	console.log('update_settings tool tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
