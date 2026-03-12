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

function testRejectsUnsupportedAction() {
	const result = tarsClient.normalizeTarsResponse({ action_type: 'drag', x: 1, y: 2 });
	assert.strictEqual(result.ok, false, 'unsupported action_type should fail normalization');
	assert.strictEqual(result.code, 'tars_unsupported_action');
}

function testRejectsNonFiniteCoordinates() {
	const result = tarsClient.normalizeTarsResponse({ action_type: 'click', x: 'nope', y: 2 });
	assert.strictEqual(result.ok, false, 'non-finite coordinates should fail normalization');
	assert.strictEqual(result.code, 'tars_invalid_response');
}

function testRejectsOutOfBoundsCoordinates() {
	const normalized = tarsClient.normalizeTarsResponse(fixture);
	const result = tarsClient.validateTarsImagePoint(normalized, { imageWidth: 800, imageHeight: 600 });
	assert.strictEqual(result.ok, false, 'out-of-bounds coordinates should be rejected');
	assert.strictEqual(result.code, 'tars_out_of_bounds');
}

async function testHandlesMalformedJsonResponse() {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () => 'not-json',
	});
	process.env.TARS_ENABLED = '1';
	process.env.TARS_ENDPOINT = 'https://example.com/action';
	process.env.TARS_API_KEY = 'secret';
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
	process.env.TARS_ENDPOINT = 'https://example.com/action';
	process.env.TARS_API_KEY = 'secret';
	process.env.TARS_TIMEOUT_MS = '5';
	try {
		const result = await tarsClient.requestTarsAction({
			screenshotBase64: 'abc',
			instruction: 'Click the button',
		});
		assert.strictEqual(result.ok, false, 'timeout should fail');
		assert.strictEqual(result.code, 'tars_timeout');
	} finally {
		global.fetch = originalFetch;
		process.env.TARS_TIMEOUT_MS = '';
	}
}

Promise.resolve()
	.then(testNormalizeFixtureResponse)
	.then(testRejectsUnsupportedAction)
	.then(testRejectsNonFiniteCoordinates)
	.then(testRejectsOutOfBoundsCoordinates)
	.then(testHandlesMalformedJsonResponse)
	.then(testHandlesTimeout)
	.then(() => {
		console.log('TARS client tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
