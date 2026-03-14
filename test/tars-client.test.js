const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const fixture = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'tars-response.json'), 'utf8')
);

const tarsClient = require('../src/main/automation/tars-client');

console.log('Running TARS client tests...');

function testNormalizeFixtureResponse() {
	const result = tarsClient.normalizeTarsResponse(fixture);
	assert.deepStrictEqual(
		{
			ok: result.ok,
			actionType: result.actionType,
			x: result.x,
			y: result.y,
			thought: result.thought,
			latencyMs: result.latencyMs,
		},
		{
			ok: true,
			actionType: 'click',
			x: 812.5,
			y: 436.25,
			thought: 'Click the primary call-to-action button visible in the screenshot.',
			latencyMs: 2041,
		},
		'fixture response should normalize into the frozen TARS payload shape'
	);
}

function testNormalizesDragAction() {
	const result = tarsClient.normalizeTarsResponse({
		action_type: 'drag',
		x: 10,
		y: 20,
		x2: 30,
		y2: 40,
	});
	assert.strictEqual(result.ok, true, 'drag response should normalize successfully');
	assert.strictEqual(result.actionType, 'drag');
	assert.strictEqual(result.x2, 30);
	assert.strictEqual(result.y2, 40);
}

function testNormalizesTypingAndHotkeys() {
	const typing = tarsClient.normalizeTarsResponse({ action_type: 'type', text: 'hello' });
	assert.strictEqual(typing.ok, true, 'type action should normalize successfully');
	assert.strictEqual(typing.text, 'hello');

	const hotkey = tarsClient.normalizeTarsResponse({ action_type: 'hotkey', key: 'cmd+l' });
	assert.strictEqual(hotkey.ok, true, 'hotkey action should normalize successfully');
	assert.strictEqual(hotkey.key, 'cmd+l');
}

function testNormalizesWaitAndFinished() {
	const waitAction = tarsClient.normalizeTarsResponse({ action_type: 'wait', duration_ms: 250 });
	assert.strictEqual(waitAction.ok, true, 'wait action should normalize successfully');
	assert.strictEqual(waitAction.durationMs, 250);

	const finished = tarsClient.normalizeTarsResponse({ action_type: 'finished', result: 'done' });
	assert.strictEqual(finished.ok, true, 'finished action should normalize successfully');
	assert.strictEqual(finished.result, 'done');
}

function testRejectsUnsupportedAction() {
	const result = tarsClient.normalizeTarsResponse({ action_type: 'teleport', x: 1, y: 2 });
	assert.strictEqual(result.ok, false, 'unsupported action_type should fail normalization');
	assert.strictEqual(result.code, 'tars_unsupported_action');
}

function testRejectsOutOfBoundsCoordinates() {
	const normalized = tarsClient.normalizeTarsResponse(fixture);
	const result = tarsClient.validateTarsAction(normalized, { imageWidth: 800, imageHeight: 600 });
	assert.strictEqual(result.ok, false, 'out-of-bounds coordinates should be rejected');
	assert.strictEqual(result.code, 'tars_out_of_bounds');
}

function testAllowsNonCoordinateActionsWithoutImageBounds() {
	const typing = tarsClient.normalizeTarsResponse({ action_type: 'type', text: 'hello' });
	const result = tarsClient.validateTarsAction(typing, {});
	assert.strictEqual(result.ok, true, 'non-coordinate actions should not require image bounds');
}

function testReadsUiTarsEnvironmentAliases() {
	process.env.UI_TARS_URL = 'https://example.com/action';
	process.env.UI_TARS_API_KEY = 'secret';
	process.env.UI_TARS_TIMEOUT_MS = '9001';
	try {
		const config = tarsClient.getTarsConfig();
		assert.strictEqual(config.endpoint, 'https://example.com/action');
		assert.strictEqual(config.apiKey, 'secret');
		assert.strictEqual(config.timeoutMs, 9001);
	} finally {
		process.env.UI_TARS_URL = '';
		process.env.UI_TARS_API_KEY = '';
		process.env.UI_TARS_TIMEOUT_MS = '';
	}
}

async function testHandlesMalformedJsonResponse() {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () => 'not-json',
	});
	process.env.TARS_ENABLED = '1';
	process.env.UI_TARS_URL = 'https://example.com/action';
	process.env.UI_TARS_API_KEY = 'secret';
	try {
		const result = await tarsClient.requestTarsAction({
			screenshotBase64: 'abc',
			instruction: 'Click the button',
		});
		assert.strictEqual(result.ok, false, 'malformed JSON response should fail');
		assert.strictEqual(result.code, 'tars_invalid_response');
	} finally {
		global.fetch = originalFetch;
	}
}

async function testHandlesTimeout() {
	const originalFetch = global.fetch;
	global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
		options.signal.addEventListener('abort', () => {
			const err = new Error('aborted');
			err.name = 'AbortError';
			reject(err);
		}, { once: true });
	});
	process.env.TARS_ENABLED = '1';
	process.env.UI_TARS_URL = 'https://example.com/action';
	process.env.UI_TARS_API_KEY = 'secret';
	process.env.UI_TARS_TIMEOUT_MS = '5';
	try {
		const result = await tarsClient.requestTarsAction({
			screenshotBase64: 'abc',
			instruction: 'Click the button',
		});
		assert.strictEqual(result.ok, false, 'timeout should fail');
		assert.strictEqual(result.code, 'tars_timeout');
	} finally {
		global.fetch = originalFetch;
		process.env.UI_TARS_TIMEOUT_MS = '';
	}
}

Promise.resolve()
	.then(testNormalizeFixtureResponse)
	.then(testNormalizesDragAction)
	.then(testNormalizesTypingAndHotkeys)
	.then(testNormalizesWaitAndFinished)
	.then(testRejectsUnsupportedAction)
	.then(testRejectsOutOfBoundsCoordinates)
	.then(testAllowsNonCoordinateActionsWithoutImageBounds)
	.then(testReadsUiTarsEnvironmentAliases)
	.then(testHandlesMalformedJsonResponse)
	.then(testHandlesTimeout)
	.then(() => {
		console.log('TARS client tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
