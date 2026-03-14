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

function loadToolHandlerModule(filePath, overrides = {}) {
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
		'shouldAutoEscalateFromToolFailure',
		'logInfo',
		'logError',
		`${src}\nreturn { createToolCallHandler, shouldDeferForegroundUiTool, shouldRefreshScreenAfterTool, formatToolResponseText };`
	);
	return loader(
		overrides.EVENT_TYPES || { TOOL_START: 'TOOL_START', TOOL_END: 'TOOL_END' },
		overrides.showToolStart || (() => {}),
		overrides.showToolDone || (() => {}),
		overrides.hideToolLog || (() => {}),
		overrides.getToolDisplay || (() => ({ label: 'Tool', detail: '' })),
		overrides.setPresence || (() => {}),
		overrides.clearPresence || (() => {}),
		overrides.updateIfWorkspaceTool || (() => {}),
		overrides.shouldAutoEscalateFromToolFailure || (({ toolName, result, intentText }) => {
			if (toolName === 'run_ui_task') return false;
			if (!['click_at', 'double_click', 'press_key', 'type_text'].includes(toolName)) return false;
			if (!result || result.ok !== false) return false;
			if (/\b(delete|remove|trash|discard|send|submit|purchase|buy|pay|confirm|replace|overwrite)\b/i.test(intentText || '')) return false;
			return /\b(click|open|go to|goto|select|search|find|navigate|visit|follow|choose)\b/i.test(intentText || '');
		}),
		overrides.logInfo || (() => {}),
		overrides.logError || (() => {}),
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
	formatToolResponseText({ ok: true, queryKind: 'voice_preset_list', summary: 'Available voice presets: soft bloom — soft and airy.' }),
	'Available voice presets: soft bloom — soft and airy.',
	'structured settings query results should prefer their natural-language summary'
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

async function testPointerToolsPreflightFreshCaptureWhenLatestContextIsMissing() {
	const originalWindow = global.window;
	const executed = [];
	let captureCalls = 0;
	const screen = {
		latestCapture: null,
		lastCaptureId: '',
		lastInteractiveCaptureId: '',
		async capture() {
			captureCalls += 1;
			const capture = {
				ok: true,
				context: {
					captureId: 'cap_refreshed',
				},
			};
			this.latestCapture = { capturedAt: Date.now(), context: capture.context };
			this.lastCaptureId = capture.context.captureId;
			this.lastInteractiveCaptureId = capture.context.captureId;
			return capture;
		},
	};
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
		screen,
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);

	assert.strictEqual(captureCalls, 2, 'pointer tool should preflight a fresh capture and still perform its post-action refresh');
	assert.strictEqual(executed.length, 1, 'pointer tool should still execute after preflight capture succeeds');
	assert.strictEqual(executed[0].args.capture_id, 'cap_refreshed', 'pointer tool should inherit the fresh interactive capture id');

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

async function testSuppressedTurnBlocksRawToolCalls() {
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
		screen: { capture: async () => {} },
	});

	handler.setShouldAcceptToolCalls(() => false);
	await handler.handleToolCalls([{ name: 'open_app', args: { name: 'Safari' }, id: 'call-1' }]);

	assert.strictEqual(executed.length, 0, 'suppressed model turns should not execute side-effecting raw tools');
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /ignored tool call from a suppressed model turn/i.test(entry.result)),
		true,
		'suppressed raw tools should receive a no-op response'
	);

	global.window = originalWindow;
}

async function testFailedNavigationalClickAutoEscalatesToUiTask() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'ui_task', settingsCapable: false }) };
				}
				executed.push({ name, args });
				if (name === 'click_at') {
					return { ok: false, result: 'Pointer fallback is blocked until native/app-specific and accessibility attempts fail.' };
				}
				if (name === 'run_ui_task') {
					return { ok: true, result: `Completed UI task: ${args.goal}` };
				}
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
		getLastUserIntent: () => 'click the Theo channel result',
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);

	assert.deepStrictEqual(
		executed.map((entry) => entry.name),
		['click_at', 'run_ui_task'],
		'failed navigational low-level action should auto-escalate once to run_ui_task'
	);
	assert.strictEqual(
		executed[1].args.goal,
		'click the Theo channel result',
		'auto-escalation should reuse the original natural-language user intent'
	);
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /Completed UI task: click the Theo channel result/.test(entry.result)),
		true,
		'original tool call should receive the escalated UI task outcome'
	);

	global.window = originalWindow;
}

async function testStalePointerFailureRefreshesScreenAndRequestsRetry() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	let captureCalls = 0;
	const screen = {
		latestCapture: { capturedAt: Date.now(), context: { captureId: 'cap_latest' } },
		lastInteractiveCaptureId: 'cap_latest',
		lastCaptureId: 'cap_latest',
		async capture() {
			captureCalls += 1;
			const capture = {
				ok: true,
				context: {
					captureId: 'cap_retry',
				},
			};
			this.latestCapture = { capturedAt: Date.now(), context: capture.context };
			this.lastInteractiveCaptureId = capture.context.captureId;
			this.lastCaptureId = capture.context.captureId;
			return capture;
		},
	};
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'ui_task', settingsCapable: false }) };
				}
				executed.push({ name, args });
				return {
					ok: false,
					result: 'Cannot click without a fresh screen capture. No recent screen frame is available. Screen Recording permission: granted. Last successful screen frame was 10s ago.',
				};
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
		screen,
		getLastUserIntent: () => 'open the Theo channel',
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20, capture_id: 'cap_stale' }, id: 'call-1' }]);

	assert.deepStrictEqual(
		executed.map((entry) => entry.name),
		['click_at'],
		'stale pointer failures should refresh screen context instead of auto-escalating immediately'
	);
	assert.strictEqual(captureCalls, 2, 'stale pointer failures should refresh once for recovery and once for post-tool verification');
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /Captured a fresh screenshot with capture_id "cap_retry"/.test(entry.result)),
		true,
		'response should tell Gemini to retry against the fresh screenshot'
	);

	global.window = originalWindow;
}

async function testFailedPointerOnlyActionDoesNotAutoEscalateWithoutNavigationalIntent() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'ui_task', settingsCapable: false }) };
				}
				executed.push({ name, args });
				return { ok: false, result: 'Could not click requested coordinates' };
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
		getLastUserIntent: () => 'move slightly to the left',
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);

	assert.deepStrictEqual(
		executed.map((entry) => entry.name),
		['click_at'],
		'non-navigational pointer failures should not auto-escalate to run_ui_task'
	);
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /Error: Could not click requested coordinates/.test(entry.result)),
		true,
		'non-escalated pointer failure should be returned unchanged'
	);

	global.window = originalWindow;
}

async function testFailedNavigationalClickEscalatesOnlyOnce() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'ui_task', settingsCapable: false }) };
				}
				executed.push({ name, args });
				if (name === 'click_at') {
					return { ok: false, result: 'Pointer fallback is blocked until native/app-specific and accessibility attempts fail.' };
				}
				return { ok: false, result: `Could not complete UI task: ${args.goal}` };
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
		getLastUserIntent: () => 'open the Theo channel',
	});

	await handler.handleToolCalls([{ name: 'click_at', args: { x: 10, y: 20 }, id: 'call-1' }]);

	assert.deepStrictEqual(
		executed.map((entry) => entry.name),
		['click_at', 'run_ui_task'],
		'escalation should retry once and stop without looping'
	);
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /Error: Could not complete UI task: open the Theo channel/.test(entry.result)),
		true,
		'failed escalation should surface the single run_ui_task failure'
	);

	global.window = originalWindow;
}

async function testSelfFixPreambleBlocksDispatch() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	let notedPreamble = 0;
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'self_fix', settingsCapable: false }) };
				}
				executed.push({ name, args });
				return { ok: true, result: 'started' };
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
		getLastUserIntent: () => 'Go ahead',
		getSelfFixContext: () => ({
			awaitingDetails: true,
			classification: { kind: 'intent_preamble' },
		}),
		onSelfFixIntentPreamble() {
			notedPreamble += 1;
		},
	});

	await handler.handleToolCalls([{ name: 'self_fix', args: { description: 'do a bunch of stuff' }, id: 'call-1' }]);

	assert.strictEqual(executed.length, 0, 'self_fix should not dispatch from a preamble-only utterance');
	assert.strictEqual(notedPreamble, 1, 'preamble callback should fire once');
	assert.strictEqual(
		responses.some((entry) => entry.id === 'call-1' && /wait for the exact self-fix details/i.test(entry.result)),
		true,
		'blocked self_fix should explain that concrete details are still required'
	);

	global.window = originalWindow;
}

async function testSettingsCapableSelfFixReroutesToUpdateSettings() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'settings_query', settingsCapable: true, settingsNamespace: 'voice' }) };
				}
				executed.push({ name, args });
				return { ok: true, result: 'Available presets: soft bloom, clear guide, velvet dusk, bright spark' };
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
		getLastUserIntent: () => 'What voice presets do you have available',
	});

	await handler.handleToolCalls([{ name: 'self_fix', args: { description: 'Enumerate the available voice presets.' }, id: 'call-1' }]);
	await Promise.resolve();
	await Promise.resolve();

	assert.deepStrictEqual(
		executed,
		[{ name: 'query_settings', args: { request: 'What voice presets do you have available' } }],
		'settings-capable self-fix requests should reroute to query_settings for read-only settings intents'
	);
	assert.strictEqual(responses[0]?.name, 'self_fix', 'rerouted calls should still satisfy the original tool response contract');
	assert.match(responses[0]?.result || '', /Available presets:/, 'rerouted settings response should flow back to the model');

	global.window = originalWindow;
}

async function testStructuredSelfFixSpecDoesNotRerouteToSettings() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'self_fix', settingsCapable: false }) };
				}
				executed.push({ name, args });
				return { ok: true, result: 'queued' };
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
		getLastUserIntent: () => 'fix the repetitive direct-turn reprompt bug',
	});

	await handler.handleToolCalls([{
		name: 'self_fix',
		args: {
			description: 'PROBLEM: repetitive direct-turn reprompt. DESIRED BEHAVIOR: transcript-aware recovery. IMPLEMENTATION: patch voice-engine.js to salvage from transcript and fence stale fallback output.',
		},
		id: 'call-1',
	}]);
	await Promise.resolve();
	await Promise.resolve();

	assert.deepStrictEqual(
		executed,
		[{
			name: 'self_fix',
			args: {
				description: 'PROBLEM: repetitive direct-turn reprompt. DESIRED BEHAVIOR: transcript-aware recovery. IMPLEMENTATION: patch voice-engine.js to salvage from transcript and fence stale fallback output.',
			},
		}],
		'structured self-fix specs should stay on self_fix instead of being mistaken for settings updates'
	);
	assert.strictEqual(responses[0]?.name, 'self_fix', 'structured self-fix should still resolve through the original tool response contract');

	global.window = originalWindow;
}

async function testSettingsQueryStaysOffVisibleToolUi() {
	const originalWindow = global.window;
	const responses = [];
	const runtimeEvents = [];
	const toolStarts = [];
	const savedExecutions = [];
	const handlerModule = loadToolHandlerModule(filePath, {
		showToolStart(name) {
			toolStarts.push(name);
		},
	});
	const { createToolCallHandler: createSilentQueryHandler } = handlerModule;

	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: true, result: JSON.stringify({ route: 'settings_query', settingsCapable: true, settingsNamespace: 'voice' }) };
				}
				if (name === 'query_settings') {
					return { ok: true, summary: 'Available presets: soft bloom, clear guide', result: 'Available presets: soft bloom, clear guide' };
				}
				throw new Error(`unexpected tool ${name}`);
			},
			saveToolExecution(...args) {
				savedExecutions.push(args);
			},
		},
	};

	const handler = createSilentQueryHandler({
		gemini: {
			sendToolResponse(id, name, result) {
				responses.push({ id, name, result });
			},
		},
		onStateChange() {
			throw new Error('query_settings should not enter TOOL_EXECUTING state');
		},
		onEvent(type, payload) {
			runtimeEvents.push({ type, payload });
		},
		screen: { capture: async () => {} },
		getLastUserIntent: () => 'What voice presets do you have available',
	});

	await handler.handleToolCalls([{ name: 'query_settings', args: { request: 'What voice presets do you have available' }, id: 'call-1' }]);
	await Promise.resolve();
	await Promise.resolve();

	assert.deepStrictEqual(toolStarts, [], 'settings queries should not show tool-log entries');
	assert.deepStrictEqual(savedExecutions, [], 'settings queries should not persist tool execution telemetry');
	assert.deepStrictEqual(runtimeEvents, [], 'settings queries should not emit visible TOOL_START/TOOL_END runtime events');
	assert.match(responses[0]?.result || '', /Available presets:/, 'query result should still flow back to the model');

	global.window = originalWindow;
}

async function testRoutingFailureFailsClosed() {
	const originalWindow = global.window;
	const executed = [];
	const responses = [];
	global.window = {
		electronAPI: {
			executeTool: async (name, args) => {
				if (name === 'route_request') {
					return { ok: false, result: 'Routing unavailable right now.' };
				}
				executed.push({ name, args });
				return { ok: true, result: 'should not run' };
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
		getLastUserIntent: () => 'What voice presets do you have available',
	});

	await handler.handleToolCalls([{ name: 'update_settings', args: { request: 'What voice presets do you have available' }, id: 'call-1' }]);

	assert.deepStrictEqual(executed, [], 'no tool should execute when Groq routing fails closed');
	assert.match(responses[0]?.result || '', /Routing unavailable right now/, 'routing failures should surface a clear error');

	global.window = originalWindow;
}

Promise.resolve()
	.then(testDeferredUiTaskFlushesOnce)
	.then(testDeferredUiTaskSupersedesOlderTranscript)
	.then(testSameTurnUiTaskExecutesOnlyOnce)
	.then(testPointerToolsUseLatestInteractiveCaptureId)
	.then(testPointerToolsPreflightFreshCaptureWhenLatestContextIsMissing)
	.then(testPointerRetryBudgetSuppressesClickCycling)
	.then(testSuppressedTurnBlocksRawToolCalls)
	.then(testFailedNavigationalClickAutoEscalatesToUiTask)
	.then(testStalePointerFailureRefreshesScreenAndRequestsRetry)
	.then(testFailedPointerOnlyActionDoesNotAutoEscalateWithoutNavigationalIntent)
	.then(testFailedNavigationalClickEscalatesOnlyOnce)
	.then(testSelfFixPreambleBlocksDispatch)
	.then(testSettingsCapableSelfFixReroutesToUpdateSettings)
	.then(testStructuredSelfFixSpecDoesNotRerouteToSettings)
	.then(testSettingsQueryStaysOffVisibleToolUi)
	.then(testRoutingFailureFailsClosed)
	.then(() => {
		console.log('Tool call handler tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
