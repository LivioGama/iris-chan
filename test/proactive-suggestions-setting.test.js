const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

console.log('Running proactive suggestions setting integration test...');

async function loadEsm(relativePath) {
	const moduleUrl = pathToFileURL(path.join(process.cwd(), relativePath)).href;
	return import(moduleUrl);
}

async function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-proactive-setting-'));
	process.env.IRIS_SETTINGS_PATH = path.join(tempDir, 'settings.json');
	global.window = {
		irisPaths: {
			sourceDirDisplay: 'test-source',
		},
	};

	const settingsPath = require.resolve('../src/main/settings.js');
	delete require.cache[settingsPath];
	const settings = require('../src/main/settings.js');
	const { BehaviorEngine } = await loadEsm('src/renderer/voice/behavior-engine.js');
	const { buildSystemInstruction } = await loadEsm('src/renderer/gemini/system-prompt.js');

	const initial = settings.init();
	assert.strictEqual(initial.behavior.proactiveSuggestionsEnabled, true, 'settings should default proactive suggestions to enabled');

	const behavior = new BehaviorEngine();
	behavior.setState({
		...initial.behavior,
		mode: 'proactive',
	});
	const now = Date.now();
	assert.strictEqual(
		behavior.shouldEvaluateProactively({
			frontmostApp: 'Slack',
			contextFingerprint: 'slack:thread',
			captureAgeMs: 500,
			now,
		}),
		true,
		'proactive mode should evaluate suggestions when the toggle is enabled',
	);
	assert.strictEqual(
		behavior.canSuggest({
			confidence: 0.9,
			contextFingerprint: 'slack:thread',
			now,
		}),
		true,
		'proactive mode should allow suggestions when the toggle is enabled',
	);

	let applied = null;
	const unsubscribe = settings.onChange((nextSettings) => {
		applied = nextSettings;
	});
	fs.writeFileSync(process.env.IRIS_SETTINGS_PATH, JSON.stringify({
		behavior: {
			mode: 'proactive',
			proactiveSuggestionsEnabled: false,
		},
	}, null, 2), 'utf-8');
	await wait(300);
	unsubscribe();

	assert.ok(applied, 'settings watcher should emit live updates');
	assert.strictEqual(applied.behavior.proactiveSuggestionsEnabled, false, 'watcher should surface disabled proactive suggestions');
	behavior.setState(applied.behavior);
	assert.strictEqual(
		behavior.shouldEvaluateProactively({
			frontmostApp: 'Slack',
			contextFingerprint: 'slack:thread-2',
			captureAgeMs: 500,
			now: now + 1000,
		}),
		false,
		'disabled proactive suggestions should stop proactive evaluation live',
	);

	const promptWhenDisabled = buildSystemInstruction({ behaviorState: applied.behavior });
	assert.match(promptWhenDisabled, /Proactive suggestions: disabled by settings\./, 'system prompt should reflect disabled proactive suggestions');
	assert.doesNotMatch(promptWhenDisabled, /Default to passivity unless the current behavior mode explicitly allows proactive suggestions\./, 'system prompt should not use the stale passive-default wording');

	const reenabled = settings.updateSettings({
		behavior: {
			mode: 'proactive',
			proactiveSuggestionsEnabled: true,
		},
	}, { source: 'test:reenable' });
	assert.strictEqual(reenabled.ok, true, 'settings update should re-enable proactive suggestions');
	const promptWhenEnabled = buildSystemInstruction({ behaviorState: settings.getSettings().behavior });
	assert.match(promptWhenEnabled, /Proactive suggestions: enabled\./, 'system prompt should reflect enabled proactive suggestions');
	assert.match(promptWhenEnabled, /default to suggestion-friendly assistance/i, 'system prompt should explicitly describe proactive mode as suggestion-friendly when enabled');
	assert.doesNotMatch(promptWhenEnabled, /Default to passivity unless the current behavior mode explicitly allows proactive suggestions\./, 'enabled proactive mode should not include the stale passive-default wording');

	settings.shutdown();
	console.log('Proactive suggestions setting integration test passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
