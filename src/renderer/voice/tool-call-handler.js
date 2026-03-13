import { EVENT_TYPES } from '../../shared/event-types.web.js';
import { showToolStart, showToolDone, hideToolLog, getToolDisplay } from '../ui/tool-log.js';
import { setPresence, clearPresence } from '../ui/presence-indicator.js';
import { updateIfWorkspaceTool } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';

// Tools that return immediately (fire-and-forget in main process).
// These must NOT block voice capture or enter TOOL_EXECUTING state.
const BACKGROUND_TOOLS = new Set(['fix_project', 'self_fix', 'add_task']);
const SCREEN_REFRESH_TOOLS = new Set([
	'type_text',
	'press_key',
	'click_at',
	'double_click',
	'mouse_move',
	'drag',
	'scroll',
	'open_app',
	'window_manage',
	'activate_app',
]);
const POINTER_TOOLS = new Set(['click_at', 'double_click', 'mouse_move', 'drag']);
const AUTO_ESCALATE_SOURCE_TOOLS = new Set(['click_at', 'double_click', 'press_key', 'type_text']);
const FOREGROUND_UI_STABILIZE_MS = 350;
const SAME_TURN_UI_TASK_MESSAGE = 'Ignored repeated UI task in the same spoken turn';
const SAME_TURN_POINTER_RETRY_MESSAGE = 'Ignored repeated pointer retries in the same spoken turn';
const MAX_POINTER_ONLY_BATCHES_PER_SPEECH = 2;
const NAVIGATIONAL_UI_INTENT_PATTERN = /\b(click|open|go to|goto|select|search|find|navigate|visit|follow|choose)\b/i;
const DESTRUCTIVE_UI_INTENT_PATTERN = /\b(delete|remove|trash|discard|send|submit|purchase|buy|pay|confirm|replace|overwrite)\b/i;
const SETTINGS_CAPABILITY_PATTERNS = [
	/\bvoice preset(s)?\b/i,
	/\b(?:model )?voice\b/i,
	/\bpitch\b/i,
	/\bplayback(?: rate)?\b/i,
	/\bwarm(?:er|th)\b/i,
	/\bbrighter\b|\bdarker\b/i,
	/\beq\b/i,
	/\bcompress(?:ed|ion)?\b/i,
	/\bavatar\b/i,
	/\bbehavior mode\b|\battentive mode\b|\bautonomous mode\b|\bsilent mode\b/i,
	/\bdirect mode\b/i,
	/\blog(?:ging| level)?\b/i,
];

function isSearchTool(name, args) {
	if (name === 'web_search' || name === 'ask_chatgpt' || name === 'research') return true;
	if (name === 'run_terminal_command') {
		const cmd = (args?.command || '').toLowerCase();
		if (cmd.includes('search.py') || cmd.includes('perplexity')) return true;
	}
	if (name.includes('search')) return true;
	return false;
}

function searchLabel(name, args) {
	if (name === 'web_search') return args?.query || 'Searching...';
	if (name === 'ask_chatgpt') return args?.prompt || 'Asking ChatGPT...';
	if (name === 'research') return args?.query || 'Deep researching...';
	if (name === 'run_terminal_command') {
		const m = (args?.command || '').match(/search\.py\s+["']([^"']+)["']/);
		return m ? m[1] : 'Searching...';
	}
	return args?.query || 'Searching...';
}

export function formatToolResponseText(result) {
	if (!result || typeof result !== 'object') return 'done';
	if (typeof result.summary === 'string' && result.summary.trim()) {
		return result.summary.trim();
	}
	const text = result.result || 'done';
	return result.ok === false ? `Error: ${text}` : text;
}

export function shouldRefreshScreenAfterTool(name, result = null) {
	if (name === 'run_ui_task') {
		return result?.ok === false;
	}
	return SCREEN_REFRESH_TOOLS.has(name);
}

export function shouldDeferForegroundUiTool(name, { userSpeaking = false } = {}) {
	return name === 'run_ui_task' && userSpeaking;
}

function normalizeAutoEscalationIntent(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function isNavigationalUiIntent(intentText = '') {
	const text = normalizeAutoEscalationIntent(intentText);
	if (!text) return false;
	if (DESTRUCTIVE_UI_INTENT_PATTERN.test(text)) return false;
	return NAVIGATIONAL_UI_INTENT_PATTERN.test(text);
}

function shouldAutoEscalateTool(name, result, intentText = '') {
	if (name === 'run_ui_task') return false;
	if (!AUTO_ESCALATE_SOURCE_TOOLS.has(name)) return false;
	if (!result || result.ok !== false) return false;
	return isNavigationalUiIntent(intentText);
}

export function createToolCallHandler({
	gemini,
	onStateChange,
	onEvent,
	screen,
	getLastUserIntent,
	getSelfFixContext,
	onSelfFixAccepted,
	onSelfFixIntentPreamble,
}) {
	let activeToolCount = 0;
	let userSpeaking = false;
	let pendingUiCall = null;
	let pendingUiFlushTimer = null;
	let speechGeneration = 0;
	let lastUiTaskSpeechGeneration = null;
	let pointerOnlyBatchesThisSpeech = 0;
	let toolCallChain = Promise.resolve();
	let shouldAcceptToolCalls = () => true;
	let lastRouteIntent = '';
	let lastRouteDecision = null;
	const readLastUserIntent = typeof getLastUserIntent === 'function' ? getLastUserIntent : () => '';
	const readSelfFixContext = typeof getSelfFixContext === 'function' ? getSelfFixContext : () => ({});
	const notifySelfFixAccepted = typeof onSelfFixAccepted === 'function' ? onSelfFixAccepted : () => {};
	const notifySelfFixIntentPreamble = typeof onSelfFixIntentPreamble === 'function' ? onSelfFixIntentPreamble : () => {};

	function updateToolPresence(name, args, index, total) {
		const { label, detail } = getToolDisplay(name, args);
		const step = total > 1 ? `Step ${index + 1} of ${total}` : 'In progress';
		setPresence('tool', 'tool', {
			title: 'Working',
			detail: detail ? `${step} · ${label}: ${detail}` : `${step} · ${label}`,
		});
	}

	function clearPendingUiFlushTimer() {
		if (!pendingUiFlushTimer) return;
		clearTimeout(pendingUiFlushTimer);
		pendingUiFlushTimer = null;
	}

	function supersedePendingUiCall(message = 'Deferred UI task superseded by a newer speech transcript') {
		if (!pendingUiCall) return;
		gemini.sendToolResponse(pendingUiCall.id, pendingUiCall.name, message);
		pendingUiCall = null;
		clearPendingUiFlushTimer();
	}

	function isUiTaskLockedForCurrentSpeech(name) {
		return name === 'run_ui_task' && lastUiTaskSpeechGeneration === speechGeneration;
	}

	function markUiTaskDispatched(name) {
		if (name === 'run_ui_task') {
			lastUiTaskSpeechGeneration = speechGeneration;
		}
	}

	function rejectDuplicateUiTask(call, message = SAME_TURN_UI_TASK_MESSAGE) {
		logInfo('Tool', `Suppressing duplicate ${call.name} for speech turn ${speechGeneration}`);
		gemini.sendToolResponse(call.id, call.name, message);
	}

	function rejectPointerRetryBatch(calls, message = SAME_TURN_POINTER_RETRY_MESSAGE) {
		logInfo('Tool', `Suppressing repeated pointer retry batch for speech turn ${speechGeneration}`);
		for (const call of calls) {
			gemini.sendToolResponse(call.id, call.name, message);
		}
	}

	function attachPointerCaptureId(name, args) {
		if (!POINTER_TOOLS.has(name)) return args || {};
		const existingCaptureId = String(args?.capture_id || '').trim();
		if (existingCaptureId) return args || {};
		const fallbackCaptureId = String(screen?.lastInteractiveCaptureId || screen?.lastCaptureId || '').trim();
		if (!fallbackCaptureId) return args || {};
		return {
			...(args || {}),
			capture_id: fallbackCaptureId,
		};
	}

	const _executeOne = async (name, args, id, index, total, options = {}) => {
		const { allowAutoEscalation = true } = options;
		const dispatchName = options.dispatchName || name;
		const responseName = options.responseName || name;
		const toolArgs = attachPointerCaptureId(dispatchName, args);
		activeToolCount++;
		updateToolPresence(dispatchName, toolArgs, index, total);
		showToolStart(dispatchName, toolArgs, index, total);
		logInfo('Tool', `Executing: ${dispatchName}(${JSON.stringify(toolArgs || {})})`.slice(0, 500));

		const isSearch = isSearchTool(dispatchName, toolArgs);
		if (isSearch) {
			window.electronAPI.searchSpinner(searchLabel(dispatchName, toolArgs));
		}

		const toolStart = Date.now();
		try {
			let result = await window.electronAPI.executeTool(dispatchName, toolArgs);
			const escalationGoal = normalizeAutoEscalationIntent(readLastUserIntent());
			if (allowAutoEscalation && shouldAutoEscalateTool(dispatchName, result, escalationGoal)) {
				const failureReason = result?.result || 'unknown failure';
				logInfo('Tool', `Auto-escalating ${dispatchName} → run_ui_task. goal="${escalationGoal}" reason="${failureReason}"`);
				markUiTaskDispatched('run_ui_task');
				const escalatedResult = await window.electronAPI.executeTool('run_ui_task', { goal: escalationGoal });
				const escalatedText = formatToolResponseText(escalatedResult);
				logInfo('Tool', `Auto-escalation outcome: source=${name} escalated=${escalatedResult.ok !== false ? 'OK' : 'FAIL'} result=${escalatedText.slice(0, 300)}`);
				result = {
					...escalatedResult,
					autoEscalatedFrom: dispatchName,
					autoEscalationGoal: escalationGoal,
					autoEscalationReason: failureReason,
					autoEscalationSourceOk: result.ok !== false,
					result: escalatedResult.ok !== false
						? `${escalatedResult.result || 'done'}`
						: escalatedResult.result || failureReason,
				};
			}
			const toolResponseText = formatToolResponseText(result);
			if (dispatchName === 'self_fix' && result?.ok !== false) {
				notifySelfFixAccepted({ name: dispatchName, args: toolArgs, result });
			}
			if (screen && shouldRefreshScreenAfterTool(dispatchName, result)) {
				await screen.capture({ passive: false, force: true });
			}
			showToolDone(dispatchName, index, result.ok !== false);
			updateIfWorkspaceTool(dispatchName);
			logInfo('Tool', `Result: ${dispatchName} → ${result.ok !== false ? 'OK' : 'FAIL'}: ${toolResponseText.slice(0, 300)}`);
			gemini.sendToolResponse(id, responseName, toolResponseText);
			window.electronAPI.saveToolExecution(dispatchName, toolArgs, toolResponseText, result.ok !== false, Date.now() - toolStart);

			if (isSearch) {
				window.electronAPI.searchResult(searchLabel(dispatchName, toolArgs), result.ok ? toolResponseText : toolResponseText);
			}
		} catch (err) {
			showToolDone(dispatchName, index, false);
			logError('Tool', `Error: ${dispatchName} → ${err.message}`);
			gemini.sendToolResponse(id, responseName, 'Error: ' + err.message);
			window.electronAPI.saveToolExecution(dispatchName, toolArgs, err.message, false, Date.now() - toolStart);
			if (isSearch) {
				window.electronAPI.searchResult(searchLabel(dispatchName, toolArgs), 'Error: ' + err.message);
			}
		} finally {
			activeToolCount = Math.max(0, activeToolCount - 1);
			if (activeToolCount === 0) {
				clearPresence('tool');
			}
		}
	};

	const _executeDeferredUiCall = async (call) => {
		onEvent(EVENT_TYPES.TOOL_START, { tools: [call.name] });
		if (isUiTaskLockedForCurrentSpeech(call.name)) {
			rejectDuplicateUiTask(call);
			onEvent(EVENT_TYPES.TOOL_END, { tools: [call.name] });
			return;
		}
		const shouldBlock = !BACKGROUND_TOOLS.has(call.name);
		if (shouldBlock) {
			onStateChange('TOOL_EXECUTING', true);
		}
		try {
			markUiTaskDispatched(call.name);
			await _executeOne(call.name, call.args, call.id, 0, 1);
		} finally {
			hideToolLog();
			if (shouldBlock) {
				onStateChange('TOOL_EXECUTING', false);
			}
			onEvent(EVENT_TYPES.TOOL_END, { tools: [call.name] });
		}
	};

	function schedulePendingUiFlush() {
		clearPendingUiFlushTimer();
		if (!pendingUiCall || userSpeaking) return;
		pendingUiFlushTimer = setTimeout(() => {
			const call = pendingUiCall;
			pendingUiCall = null;
			pendingUiFlushTimer = null;
			if (!call || userSpeaking) return;
			_executeDeferredUiCall(call).catch((err) => {
				logError('Tool', `Deferred UI tool ${call.name} dispatch error: ${err.message}`);
			});
		}, FOREGROUND_UI_STABILIZE_MS);
	}

	function queueDeferredUiCall(call) {
		if (pendingUiCall) {
			supersedePendingUiCall('Deferred UI task superseded by a newer speech transcript');
		}
		pendingUiCall = call;
		clearPendingUiFlushTimer();
		logInfo('Tool', `Deferring ${call.name} while user is still speaking`);
	}

	function rejectSuppressedToolCalls(calls, message = 'Ignored tool call from a suppressed model turn') {
		logInfo('Tool', `Suppressing ${calls.length} tool call(s) because the current model turn is not actionable`);
		for (const call of calls) {
			gemini.sendToolResponse(call.id, call.name, message);
		}
	}

	function shouldRejectSelfFixCall(call) {
		if (call?.name !== 'self_fix') return null;
		const context = readSelfFixContext() || {};
		const kind = String(context.classification?.kind || '');
		if (kind === 'intent_preamble') {
			notifySelfFixIntentPreamble(context);
			return 'Wait for the exact self-fix details before calling self_fix. Acknowledge readiness once, then stay silent.';
		}
		if (context.awaitingDetails && kind !== 'specific_change') {
			notifySelfFixIntentPreamble(context);
			return 'Still waiting for the concrete self-fix request. Do not call self_fix until the user gives the specific change details.';
		}
		return null;
	}

	function deriveSettingsRequestFromSelfFixCall(call) {
		if (call?.name !== 'self_fix') return null;
		const candidates = [
			normalizeAutoEscalationIntent(readLastUserIntent()),
			normalizeAutoEscalationIntent(call.args?.description || ''),
		].filter(Boolean);
		return candidates.find((text) => SETTINGS_CAPABILITY_PATTERNS.some((pattern) => pattern.test(text))) || null;
	}

	async function routeCurrentIntent() {
		const intentText = normalizeAutoEscalationIntent(readLastUserIntent());
		if (!intentText) return { ok: true, route: null };
		if (intentText === lastRouteIntent && lastRouteDecision) {
			return { ok: true, route: lastRouteDecision };
		}
		const result = await window.electronAPI.executeTool('route_request', { request: intentText });
		if (!result?.ok) {
			return { ok: false, error: result?.result || 'Routing unavailable right now.' };
		}
		let parsed = null;
		try {
			parsed = JSON.parse(result.result || '{}');
		} catch {
			return { ok: false, error: 'Routing unavailable right now: invalid route payload.' };
		}
		lastRouteIntent = intentText;
		lastRouteDecision = parsed;
		return { ok: true, route: parsed };
	}

	function rejectRoutingFailure(calls, message) {
		logInfo('Tool', `Rejecting ${calls.length} tool call(s) because routing failed: ${message}`);
		for (const call of calls) {
			gemini.sendToolResponse(call.id, call.name, `Error: ${message}`);
		}
	}

	const _processToolCalls = async (calls) => {
		if (!shouldAcceptToolCalls(calls)) {
			rejectSuppressedToolCalls(calls);
			return;
		}
		const routeState = await routeCurrentIntent();
		if (!routeState.ok) {
			rejectRoutingFailure(calls, routeState.error);
			return;
		}
		const routedIntent = normalizeAutoEscalationIntent(readLastUserIntent());
		const route = routeState.route;
		if (route?.route === 'settings_query' || route?.route === 'settings_mutation') {
			calls = [{
				...calls[0],
				name: 'update_settings',
				args: { request: routedIntent },
				__responseName: calls[0]?.name || 'update_settings',
			}];
		}

		const deferredCalls = [];
		const executableCalls = [];
		for (const call of calls) {
			const settingsRequest = deriveSettingsRequestFromSelfFixCall(call);
			if (settingsRequest) {
				executableCalls.push({
					...call,
					name: 'update_settings',
					args: { request: settingsRequest },
					__responseName: call.name,
				});
				continue;
			}
			const selfFixRejection = shouldRejectSelfFixCall(call);
			if (selfFixRejection) {
				gemini.sendToolResponse(call.id, call.name, selfFixRejection);
				continue;
			}
			if (isUiTaskLockedForCurrentSpeech(call.name)) {
				rejectDuplicateUiTask(call);
				continue;
			}
			if (shouldDeferForegroundUiTool(call.name, { userSpeaking })) {
				deferredCalls.push(call);
			} else {
				if (call.name === 'run_ui_task' && pendingUiCall) {
					supersedePendingUiCall('Deferred UI task superseded by a newer stable interpretation');
				}
				executableCalls.push(call);
			}
		}

		for (const call of deferredCalls) {
			queueDeferredUiCall(call);
		}

		if (!executableCalls.length) {
			return;
		}

		const pointerOnlyBatch = executableCalls.every((call) => POINTER_TOOLS.has(call.name));
		if (pointerOnlyBatch && pointerOnlyBatchesThisSpeech >= MAX_POINTER_ONLY_BATCHES_PER_SPEECH) {
			rejectPointerRetryBatch(executableCalls);
			return;
		}
		if (pointerOnlyBatch) {
			pointerOnlyBatchesThisSpeech += 1;
		}

		// Split calls into background (fire-and-forget) and blocking (synchronous) groups
		const bgCalls = [];
		const blockingCalls = [];
		for (const call of executableCalls) {
			if (BACKGROUND_TOOLS.has(call.name)) {
				bgCalls.push(call);
			} else {
				blockingCalls.push(call);
			}
		}

		onEvent(EVENT_TYPES.TOOL_START, { tools: executableCalls.map(c => c.name) });

		// Background tools: execute WITHOUT blocking voice engine.
		// They resolve quickly (fire-and-forget in main process) and send their
		// tool response to Gemini independently.
		if (bgCalls.length > 0) {
			logInfo('Tool', `Dispatching ${bgCalls.length} background tool(s) without blocking voice`);
			for (let i = 0; i < bgCalls.length; i++) {
				const { name, args, id, __responseName } = bgCalls[i];
				// Execute asynchronously — do NOT await, do NOT set TOOL_EXECUTING
				_executeOne(name, args, id, i, bgCalls.length, { responseName: __responseName || name }).catch(err => {
					logError('Tool', `Background tool ${name} dispatch error: ${err.message}`);
				});
			}
		}

		// Blocking tools: execute sequentially with TOOL_EXECUTING state (blocks voice capture).
		if (blockingCalls.length > 0) {
			onStateChange('TOOL_EXECUTING', true);

			for (let i = 0; i < blockingCalls.length; i++) {
				const { name, args, id, __responseName } = blockingCalls[i];
				markUiTaskDispatched(name);
				await _executeOne(name, args, id, i, blockingCalls.length, { responseName: __responseName || name });
			}

			onStateChange('TOOL_EXECUTING', false);
		}

		hideToolLog();

		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			onEvent('VOCAB_CHANGED');
		}

		if (screen && blockingCalls.every((call) => !shouldRefreshScreenAfterTool(call.name))) {
			await screen.capture({ passive: false, force: true });
		}

		onEvent(EVENT_TYPES.TOOL_END, { tools: executableCalls.map(c => c.name) });
	};

	const handleToolCalls = async (calls) => {
		const run = () => _processToolCalls(calls);
		const chained = toolCallChain.then(run, run);
		toolCallChain = chained.catch(() => {});
		return chained;
	};

	function setUserSpeechActive(active) {
		const next = !!active;
		if (userSpeaking === next) return;
		userSpeaking = next;
		if (userSpeaking) {
			speechGeneration += 1;
			lastUiTaskSpeechGeneration = null;
			pointerOnlyBatchesThisSpeech = 0;
			lastRouteIntent = '';
			lastRouteDecision = null;
			supersedePendingUiCall('Deferred UI task cancelled because the user kept speaking');
			return;
		}
		schedulePendingUiFlush();
	}

	function setShouldAcceptToolCalls(check) {
		shouldAcceptToolCalls = typeof check === 'function' ? check : () => true;
	}

	return { handleToolCalls, setUserSpeechActive, setShouldAcceptToolCalls };
}
