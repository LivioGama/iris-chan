const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadEsmExports(filePath, exportNames) {
	const src = fs.readFileSync(filePath, 'utf-8')
		.replace(/^import .*$/gm, '')
		.replace(/\bexport\s+/g, '');
	const loader = new Function(`${src}\nreturn { ${exportNames.join(', ')} };`);
	return loader();
}

function loadToolHandlerModule(filePath) {
	const src = fs.readFileSync(filePath, 'utf-8')
		.replace(/^import .*$/gm, '')
		.replace(/\bexport\s+/g, '');
	const loader = new Function(
		'EVENT_TYPES',
		'showToolStart',
		'showToolDone',
		'hideToolLog',
		'getToolDisplay',
		'setPresence',
		'clearPresence',
		'updateIfWorkspaceTool',
		'logInfo',
		'logError',
		`${src}\nreturn { createToolCallHandler, shouldDeferForegroundUiTool, shouldRefreshScreenAfterTool, formatToolResponseText };`
	);
	return loader(
		{ TOOL_START: 'TOOL_START', TOOL_END: 'TOOL_END' },
		() => {},
		() => {},
		() => {},
		() => ({ label: 'Tool', detail: '' }),
		() => {},
		() => {},
		() => {},
		() => {},
		() => {},
	);
}

console.log('Running tool call handler tests...');

const filePath = path.join(process.cwd(), 'src/renderer/voice/tool-call-handler.js');
const { formatToolResponseText, shouldRefreshScreenAfterTool } = loadEsmExports(filePath, [
	'formatToolResponseText',
	'shouldRefreshScreenAfterTool',
]);
const { createToolCallHandler, shouldDeferForegroundUiTool } = loadToolHandlerModule(filePath);

assert.strictEqual(
	formatToolResponseText({ ok: true, result: 'Clicked at (10,10)' }),
	'Clicked at (10,10)',
	'successful results should pass through unchanged'
);

assert.strictEqual(
	formatToolResponseText({ ok: false, result: 'Accessibility permission is required' }),
	'Error: Accessibility permission is required',
	'failed results should be clearly marked as errors for Gemini'
);

assert.strictEqual(
	formatToolResponseText({ ok: true }),
	'done',
	'missing success text should fall back to done'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('click_at'),
	true,
	'physical action tools should force a fresh screenshot'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('web_search'),
	false,
	'non-visual tools should not force a screenshot refresh'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('run_ui_task', { ok: true }),
	false,
	'successful semantic UI tasks should not force a post-action screenshot'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('run_ui_task', { ok: false }),
	true,
	'failed semantic UI tasks should capture a fallback screenshot for recovery'
);

assert.strictEqual(
	shouldDeferForegroundUiTool('run_ui_task', { userSpeaking: true }),
	true,
	'foreground UI tools should defer while the user is still speaking'
);

assert.strictEqual(
	shouldDeferForegroundUiTool('run_ui_task', { userSpeaking: false }),
	false,
	'foreground UI tools should execute once speech has stabilized'
);

async function testDeferredUiTaskFlushesOnce() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	const stateChanges = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				executed.push({ name, args });
				return { ok: true, result: `Executed ${args.goal}` };
			},
			saveToolExecution() {},
		},
	};

	const handler = createToolCallHandler({
		gemini: {
			sendToolResponse(id, name, result) {
				responses.push({ id, name, result });
			},
		},
		onStateChange(state, active) {
			stateChanges.push({ state, active });
		},
		onEvent() {},
		screen: { capture: async () => {} },
	});

	handler.setUserSpeechActive(true);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search for Theo' }, id: 'call-1' }]);
	assert.strictEqual(executed.length, 0, 'deferred UI task should not execute while user is speaking');
	assert.strictEqual(responses.length, 0, 'deferred UI task should not respond until speech stabilizes');

	handler.setUserSpeechActive(false);
	await new Promise((resolve) => setTimeout(resolve, 450));

	assert.strictEqual(executed.length, 1, 'deferred UI task should execute once after speech stabilizes');
	assert.strictEqual(executed[0].args.goal, 'Search for Theo', 'deferred UI task should preserve the latest goal');
	assert.strictEqual(responses.length, 1, 'executed deferred task should emit one tool response');
	assert.deepStrictEqual(
		stateChanges,
		[
			{ state: 'TOOL_EXECUTING', active: true },
			{ state: 'TOOL_EXECUTING', active: false },
		],
		'deferred UI task should execute on the blocking TOOL_EXECUTING path'
	);

	global.window = originalWindow;
}

async function testDeferredUiTaskSupersedesOlderTranscript() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				executed.push({ name, args });
				return { ok: true, result: `Executed ${args.goal}` };
			},
			saveToolExecution() {},
		},
	};

	const handler = createToolCallHandler({
		gemini: {
			sendToolResponse(id, name, result) {
				responses.push({ id, name, result });
			},
		},
		onStateChange() {},
		onEvent() {},
		screen: { capture: async () => {} },
	});

	handler.setUserSpeechActive(true);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search for thiyo' }, id: 'call-1' }]);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search for Theo' }, id: 'call-2' }]);
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /superseded/i.test(entry.result)),
		true,
		'older deferred UI task should be superseded by the newer transcript'
	);

	handler.setUserSpeechActive(false);
	await new Promise((resolve) => setTimeout(resolve, 450));

	assert.strictEqual(executed.length, 1, 'only the newest deferred UI task should execute');
	assert.strictEqual(executed[0].args.goal, 'Search for Theo', 'latest transcript should win when speech stabilizes');

	global.window = originalWindow;
}

async function testSameTurnUiTaskExecutesOnlyOnce() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				executed.push({ name, args });
				return { ok: true, result: `Executed ${args.goal}` };
			},
			saveToolExecution() {},
		},
	};

	const handler = createToolCallHandler({
		gemini: {
			sendToolResponse(id, name, result) {
				responses.push({ id, name, result });
			},
		},
		onStateChange() {},
		onEvent() {},
		screen: { capture: async () => {} },
	});

	handler.setUserSpeechActive(true);
	handler.setUserSpeechActive(false);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search for Theo' }, id: 'call-1' }]);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search YouTube for Theo' }, id: 'call-2' }]);

	assert.strictEqual(executed.length, 1, 'same spoken turn should dispatch only one UI task');
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-2' && /ignored repeated ui task/i.test(entry.result)),
		true,
		'second UI task in the same spoken turn should be suppressed'
	);

	handler.setUserSpeechActive(true);
	handler.setUserSpeechActive(false);
	await handler.handleToolCalls([{ name: 'run_ui_task', args: { goal: 'Search for Theo GG' }, id: 'call-3' }]);

	assert.strictEqual(executed.length, 2, 'a new spoken turn should allow a new UI task');

	global.window = originalWindow;
}

async function testPointerToolsUseLatestInteractiveCaptureId() {
	const originalWindow = global.window;
	const executed = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				executed.push({ name, args });
				return { ok: true, result: `Executed ${name}` };
			},
			saveToolExecution() {},
		},
	};

	const handler = createToolCallHandler({
		gemini: {
			sendToolResponse() {},
		},
		onStateChange() {},
		onEvent() {},
		screen: {
			capture: async () => {},
			lastCaptureId: 'cap_passive',
			lastInteractiveCaptureId: 'cap_active',
		},
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);

	assert.strictEqual(executed.length, 1, 'pointer tool should execute once');
	assert.strictEqual(executed[0].args.capture_id, 'cap_active', 'pointer tool should inherit the latest interactive capture id');

	global.window = originalWindow;
}

async function testPointerRetryBudgetSuppressesClickCycling() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				executed.push({ name, args });
				return { ok: true, result: `Executed ${name}` };
			},
			saveToolExecution() {},
		},
	};

	const handler = createToolCallHandler({
		gemini: {
			sendToolResponse(id, name, result) {
				responses.push({ id, name, result });
			},
		},
		onStateChange() {},
		onEvent() {},
		screen: {
			capture: async () => {},
			lastInteractiveCaptureId: 'cap_active',
		},
	});

	handler.setUserSpeechActive(true);
	handler.setUserSpeechActive(false);

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);
	await handler.handleToolCalls([{ name: 'click_at', args: { x: 12, y: 22 }, id: 'call-2' }]);
	await handler.handleToolCalls([{ name: 'click_at', args: { x: 14, y: 24 }, id: 'call-3' }]);

	assert.strictEqual(executed.length, 2, 'pointer retries should stop after the same-turn budget is exhausted');
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-3' && /ignored repeated pointer retries/i.test(entry.result)),
		true,
		'third same-turn pointer retry should be suppressed'
	);

	handler.setUserSpeechActive(true);
	handler.setUserSpeechActive(false);
	await handler.handleToolCalls([{ name: 'click_at', args: { x: 16, y: 26 }, id: 'call-4' }]);

	assert.strictEqual(executed.length, 3, 'a new spoken turn should reset the pointer retry budget');

	global.window = originalWindow;
}

Promise.resolve()
	.then(testDeferredUiTaskFlushesOnce)
	.then(testDeferredUiTaskSupersedesOlderTranscript)
	.then(testSameTurnUiTaskExecutesOnlyOnce)
	.then(testPointerToolsUseLatestInteractiveCaptureId)
	.then(testPointerRetryBudgetSuppressesClickCycling)
	.then(() => {
		console.log('Tool call handler tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
