const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadProactiveEngine() {
	const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/behavior/proactive-engine.js')).href;
	return import(moduleUrl);
}

async function main() {
	console.log('Running proactive engine tests...');
	const originalWindow = global.window;
	const originalFetch = global.fetch;
	const originalAbortSignal = global.AbortSignal;

	global.AbortSignal = { timeout() { return undefined; } };

	const emitted = [];
	const spoken = [];
	let toolCalls = 0;

	global.window = {
		electronAPI: {
			getApiKey: async () => 'test-key',
			executeTool: async (name) => {
				toolCalls += 1;
				assert.strictEqual(name, 'get_frontmost_app');
				return { ok: true, result: 'Visual Studio Code - iris-chan' };
			},
		},
	};

	global.fetch = async () => ({
		ok: true,
		async json() {
			return {
				candidates: [{
					content: {
						parts: [{
							text: JSON.stringify({
								suggest: true,
								kind: 'next-step',
								suggestion: 'Run the test file before editing another module.',
								confidence: 0.93,
								rationale: 'The editor is focused on source code and the current workflow looks mid-change.',
							}),
						}],
					},
				}],
			};
		},
	});

	const { ProactiveEngine } = await loadProactiveEngine();
	const behavior = {
		mode: 'attentive',
		shouldEvaluateProactively({ contextFingerprint }) {
			this.lastEval = contextFingerprint;
			return true;
		},
		canSuggest({ confidence, contextFingerprint }) {
			this.lastSuggest = { confidence, contextFingerprint };
			return true;
		},
	};
	const engine = new ProactiveEngine({
		behavior,
		eventBus: {
			emitEvent(type, payload) {
				emitted.push({ type, payload });
			},
		},
		voice: {
			canEvaluateProactively() { return true; },
			speakProactiveSuggestion(text, payload) {
				spoken.push({ text, payload });
				return true;
			},
		},
		screen: {
			latestCapture: {
				data: 'screen-image',
				capturedAt: Date.now(),
				context: {
					imageWidth: 1440,
					imageHeight: 900,
					displayWidth: 2880,
					displayHeight: 1800,
				},
			},
		},
	});

	await engine.start();
	await engine.tick();

	assert.strictEqual(toolCalls, 1, 'frontmost app should be read once');
	assert.strictEqual(emitted.length, 1, 'one proactive event should be emitted');
	assert.strictEqual(spoken.length, 1, 'one proactive suggestion should be spoken');
	assert.strictEqual(emitted[0].type, 'PROACTIVE_SUGGESTION');
	assert.strictEqual(emitted[0].payload.kind, 'next-step');
	assert.match(emitted[0].payload.suggestion, /Run the test file/);
	assert.strictEqual(emitted[0].payload.context.app, 'Visual Studio Code - iris-chan');
	assert.strictEqual(spoken[0].text, emitted[0].payload.suggestion, 'spoken suggestion should match emitted suggestion text');

	engine.stop();
	global.window = originalWindow;
	global.fetch = originalFetch;
	global.AbortSignal = originalAbortSignal;
	console.log('Proactive engine tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
