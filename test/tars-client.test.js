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

const vlmFixture = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'tars-vlm-response.json'), 'utf8')
);

// --- parseUITarsModelOutput tests ---

function testParsesClickAction() {
	const result = tarsClient.parseUITarsModelOutput('click(512, 384)', 1000, 800);
	assert.deepStrictEqual(
		{ action_type: result.action_type, x: result.x, y: result.y },
		{ action_type: 'click', x: 512, y: 307.2 },
		'click should denormalize from 1000-space to pixel coords'
	);
}

function testParsesDoubleClickAction() {
	const result = tarsClient.parseUITarsModelOutput('left_double(500, 500)', 1920, 1080);
	assert.strictEqual(result.action_type, 'double_click');
	assert.strictEqual(result.x, 960);
	assert.strictEqual(result.y, 540);
}

function testParsesRightClickAction() {
	const result = tarsClient.parseUITarsModelOutput('right_single(250, 750)', 2000, 1000);
	assert.strictEqual(result.action_type, 'right_click');
	assert.strictEqual(result.x, 500);
	assert.strictEqual(result.y, 750);
}

function testParsesDragAction() {
	const result = tarsClient.parseUITarsModelOutput('drag(100, 200, 300, 400)', 1000, 1000);
	assert.strictEqual(result.action_type, 'drag');
	assert.strictEqual(result.x, 100);
	assert.strictEqual(result.y, 200);
	assert.strictEqual(result.x2, 300);
	assert.strictEqual(result.y2, 400);
}

function testParsesTypeAction() {
	const result = tarsClient.parseUITarsModelOutput('type(hello world)', 1000, 1000);
	assert.strictEqual(result.action_type, 'type');
	assert.strictEqual(result.text, 'hello world');
}

function testParsesHotkeyAction() {
	const result = tarsClient.parseUITarsModelOutput('hotkey(cmd+l)', 1000, 1000);
	assert.strictEqual(result.action_type, 'hotkey');
	assert.strictEqual(result.key, 'cmd+l');
}

function testParsesScrollAction() {
	const result = tarsClient.parseUITarsModelOutput('scroll(down, 5)', 1000, 1000);
	assert.strictEqual(result.action_type, 'scroll');
	assert.strictEqual(result.direction, 'down');
	assert.strictEqual(result.amount, 5);
}

function testParsesWaitAction() {
	const result = tarsClient.parseUITarsModelOutput('wait(2)', 1000, 1000);
	assert.strictEqual(result.action_type, 'wait');
	assert.strictEqual(result.duration_ms, 2000);
}

function testParsesFinishedAction() {
	const result = tarsClient.parseUITarsModelOutput('finished(task complete)', 1000, 1000);
	assert.strictEqual(result.action_type, 'finished');
	assert.strictEqual(result.result, 'task complete');
}

function testParsesCallUserAction() {
	const result = tarsClient.parseUITarsModelOutput('call_user(need help with password)', 1000, 1000);
	assert.strictEqual(result.action_type, 'finished');
	assert.strictEqual(result.result, 'call_user: need help with password');
}

function testExtractsThoughtPrefix() {
	const result = tarsClient.parseUITarsModelOutput(
		'Thought: The search button is in the top right corner\nclick(900, 50)',
		1000, 1000
	);
	assert.strictEqual(result.action_type, 'click');
	assert.strictEqual(result.thought, 'The search button is in the top right corner');
	assert.strictEqual(result.x, 900);
	assert.strictEqual(result.y, 50);
}

function testReturnsNullForUnparseableOutput() {
	assert.strictEqual(tarsClient.parseUITarsModelOutput('', 1000, 1000), null, 'empty string');
	assert.strictEqual(tarsClient.parseUITarsModelOutput('random text', 1000, 1000), null, 'no action');
	assert.strictEqual(tarsClient.parseUITarsModelOutput(null, 1000, 1000), null, 'null input');
	assert.strictEqual(tarsClient.parseUITarsModelOutput(42, 1000, 1000), null, 'non-string');
}

function testParsedOutputNormalizesThroughPipeline() {
	const parsed = tarsClient.parseUITarsModelOutput('click(500, 500)', 1000, 800);
	const normalized = tarsClient.normalizeTarsResponse(parsed);
	assert.strictEqual(normalized.ok, true, 'parsed VLM output should normalize successfully');
	assert.strictEqual(normalized.actionType, 'click');
	assert.strictEqual(normalized.x, 500);
	assert.strictEqual(normalized.y, 400);
	const validated = tarsClient.validateTarsAction(normalized, { imageWidth: 1000, imageHeight: 800 });
	assert.strictEqual(validated.ok, true, 'normalized VLM output should pass validation');
}

function testReadsProviderAndModelEnvVars() {
	process.env.UI_TARS_PROVIDER = 'openai-compatible';
	process.env.UI_TARS_MODEL = 'ui-tars-72b';
	process.env.UI_TARS_URL = 'https://example.com/v1/chat/completions';
	process.env.UI_TARS_API_KEY = 'test-key';
	try {
		const config = tarsClient.getTarsConfig();
		assert.strictEqual(config.provider, 'openai-compatible');
		assert.strictEqual(config.model, 'ui-tars-72b');
	} finally {
		process.env.UI_TARS_PROVIDER = '';
		process.env.UI_TARS_MODEL = '';
		process.env.UI_TARS_URL = '';
		process.env.UI_TARS_API_KEY = '';
	}
}

async function testVlmProviderMockFetch() {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () => JSON.stringify(vlmFixture),
	});
	process.env.TARS_ENABLED = '1';
	process.env.UI_TARS_URL = 'https://example.com/v1/chat/completions';
	process.env.UI_TARS_API_KEY = 'test-key';
	process.env.UI_TARS_PROVIDER = 'openai-compatible';
	process.env.UI_TARS_MODEL = 'ui-tars-7b-dpo';
	try {
		const result = await tarsClient.requestTarsAction({
			screenshotBase64: 'abc',
			instruction: 'Click the search button',
			imageWidth: 1920,
			imageHeight: 1080,
		});
		assert.strictEqual(result.ok, true, 'VLM provider should return ok result');
		assert.strictEqual(result.actionType, 'click', 'should parse click action');
		// 850/1000 * 1920 = 1632, 45/1000 * 1080 = 48.6
		assert.strictEqual(result.x, 1632, 'x should be denormalized to pixel coords');
		assert.ok(Math.abs(result.y - 48.6) < 0.01, 'y should be denormalized to pixel coords');
		assert.strictEqual(result.thought, 'The search button is in the top-right area of the toolbar');
	} finally {
		global.fetch = originalFetch;
		process.env.UI_TARS_PROVIDER = '';
		process.env.UI_TARS_MODEL = '';
		process.env.UI_TARS_URL = '';
		process.env.UI_TARS_API_KEY = '';
	}
}

async function testVlmProviderHandlesEmptyContent() {
	const originalFetch = global.fetch;
	global.fetch = async () => ({
		ok: true,
		status: 200,
		text: async () => JSON.stringify({
			choices: [{ message: { content: '' } }],
		}),
	});
	process.env.TARS_ENABLED = '1';
	process.env.UI_TARS_URL = 'https://example.com/v1/chat/completions';
	process.env.UI_TARS_API_KEY = 'test-key';
	process.env.UI_TARS_PROVIDER = 'openai-compatible';
	try {
		const result = await tarsClient.requestTarsAction({
			screenshotBase64: 'abc',
			instruction: 'Click the button',
			imageWidth: 1000,
			imageHeight: 1000,
		});
		assert.strictEqual(result.ok, false, 'empty VLM content should fail');
		assert.strictEqual(result.code, 'tars_invalid_response');
	} finally {
		global.fetch = originalFetch;
		process.env.UI_TARS_PROVIDER = '';
		process.env.UI_TARS_URL = '';
		process.env.UI_TARS_API_KEY = '';
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
	// VLM parser tests
	.then(testParsesClickAction)
	.then(testParsesDoubleClickAction)
	.then(testParsesRightClickAction)
	.then(testParsesDragAction)
	.then(testParsesTypeAction)
	.then(testParsesHotkeyAction)
	.then(testParsesScrollAction)
	.then(testParsesWaitAction)
	.then(testParsesFinishedAction)
	.then(testParsesCallUserAction)
	.then(testExtractsThoughtPrefix)
	.then(testReturnsNullForUnparseableOutput)
	.then(testParsedOutputNormalizesThroughPipeline)
	.then(testReadsProviderAndModelEnvVars)
	.then(testVlmProviderMockFetch)
	.then(testVlmProviderHandlesEmptyContent)
	.then(() => {
		console.log('TARS client tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
