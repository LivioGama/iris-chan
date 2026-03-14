const config = require('../../shared/config').default;

const POINT_ACTIONS = new Set(['click', 'double_click', 'right_click']);
const ACTION_TYPES = new Set(['click', 'double_click', 'right_click', 'drag', 'scroll', 'type', 'hotkey', 'wait', 'finished']);

function firstDefined(...values) {
	for (const value of values) {
		if (value !== undefined && value !== null && value !== '') return value;
	}
	return undefined;
}

function toFiniteNumber(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
}

function normalizeActionType(value = '') {
	const raw = String(value || '').trim().toLowerCase();
	switch (raw) {
		case 'click':
		case 'left_click':
			return 'click';
		case 'double_click':
		case 'double-click':
		case 'dblclick':
			return 'double_click';
		case 'right_click':
		case 'right-click':
		case 'context_click':
		case 'context-menu':
			return 'right_click';
		case 'drag':
		case 'drag_and_drop':
			return 'drag';
		case 'scroll':
			return 'scroll';
		case 'type':
		case 'input_text':
		case 'type_text':
			return 'type';
		case 'hotkey':
		case 'shortcut':
		case 'press_key':
		case 'press_keys':
			return 'hotkey';
		case 'wait':
		case 'pause':
		case 'sleep':
			return 'wait';
		case 'finished':
		case 'finish':
		case 'done':
		case 'complete':
		case 'completed':
		case 'noop':
		case 'no_op':
			return 'finished';
		default:
			return raw;
	}
}

function parsePoint(payload, prefix = '') {
	const pointPayload = prefix ? payload?.[prefix] : payload;
	if (pointPayload && typeof pointPayload === 'object' && !Array.isArray(pointPayload)) {
		const x = toFiniteNumber(pointPayload.x);
		const y = toFiniteNumber(pointPayload.y);
		if (x != null && y != null) return { x, y };
	}
	const x = toFiniteNumber(firstDefined(payload?.[`${prefix}x`], payload?.[`${prefix}_x`], prefix ? null : payload?.x));
	const y = toFiniteNumber(firstDefined(payload?.[`${prefix}y`], payload?.[`${prefix}_y`], prefix ? null : payload?.y));
	if (x == null || y == null) return null;
	return { x, y };
}

function buildInvalidResponse(error, raw, code = 'tars_invalid_response') {
	return {
		ok: false,
		code,
		error,
		raw,
	};
}

function getTarsConfig() {
	const tars = config?.tars || {};
	const endpoint = String(
		firstDefined(
			process.env.UI_TARS_URL,
			process.env.TARS_ENDPOINT,
			tars.endpoint
		) || ''
	).trim();
	const apiKey = String(
		firstDefined(
			process.env.UI_TARS_API_KEY,
			process.env.TARS_API_KEY,
			tars.apiKey
		) || ''
	).trim();
	const timeoutMs = Math.max(
		1000,
		Number(firstDefined(process.env.UI_TARS_TIMEOUT_MS, process.env.TARS_TIMEOUT_MS, tars.timeoutMs, 8000))
	);
	const envEnabled = firstDefined(process.env.UI_TARS_ENABLED, process.env.TARS_ENABLED, null);
	const enabled = envEnabled != null
		? String(envEnabled) !== '0'
		: (tars.enabled === true || (Boolean(endpoint) && Boolean(apiKey)));
	const provider = String(
		firstDefined(process.env.UI_TARS_PROVIDER, process.env.TARS_PROVIDER, tars.provider, 'custom')
	).trim().toLowerCase();
	const model = String(
		firstDefined(process.env.UI_TARS_MODEL, process.env.TARS_MODEL, tars.model, 'ui-tars-7b-dpo')
	).trim();
	return {
		enabled,
		endpoint,
		apiKey,
		timeoutMs,
		provider,
		model,
	};
}

function normalizeTarsResponse(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return buildInvalidResponse('TARS response must be a JSON object', payload);
	}

	const actionType = normalizeActionType(firstDefined(payload.action_type, payload.action, payload.type));
	const thought = typeof payload.thought === 'string'
		? payload.thought
		: (typeof payload.reasoning === 'string' ? payload.reasoning : '');
	const latencyMs = toFiniteNumber(firstDefined(payload.latency_ms, payload.latencyMs, payload.latency));

	if (!ACTION_TYPES.has(actionType)) {
		return {
			ok: false,
			code: 'tars_unsupported_action',
			error: `Unsupported TARS action_type "${actionType || 'unknown'}"`,
			raw: payload,
		};
	}

	if (POINT_ACTIONS.has(actionType)) {
		const point = parsePoint(payload);
		if (!point) return buildInvalidResponse('TARS response is missing finite x/y coordinates', payload);
		return {
			ok: true,
			actionType,
			x: point.x,
			y: point.y,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	if (actionType === 'drag') {
		const start = parsePoint(payload.start || {}, '') || parsePoint(payload, '');
		const end = parsePoint(payload.end || {}, '') || parsePoint(payload, 'end');
		if (!start || !end) {
			const x2 = toFiniteNumber(firstDefined(payload.x2, payload.end_x));
			const y2 = toFiniteNumber(firstDefined(payload.y2, payload.end_y));
			if (start && x2 != null && y2 != null) {
				return {
					ok: true,
					actionType,
					x: start.x,
					y: start.y,
					x2,
					y2,
					thought,
					latencyMs,
					raw: payload,
				};
			}
			return buildInvalidResponse('TARS drag response is missing finite start/end coordinates', payload);
		}
		return {
			ok: true,
			actionType,
			x: start.x,
			y: start.y,
			x2: end.x,
			y2: end.y,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	if (actionType === 'scroll') {
		const direction = String(firstDefined(payload.direction, payload.scroll_direction, 'down') || 'down').trim().toLowerCase();
		if (!['up', 'down', 'left', 'right'].includes(direction)) {
			return buildInvalidResponse(`Unsupported scroll direction "${direction || 'unknown'}"`, payload, 'tars_invalid_scroll');
		}
		const amount = Math.max(1, Math.round(toFiniteNumber(firstDefined(payload.amount, payload.lines, payload.steps, 3)) || 3));
		return {
			ok: true,
			actionType,
			direction,
			amount,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	if (actionType === 'type') {
		const text = String(firstDefined(payload.text, payload.value, payload.input, '') || '');
		if (!text) return buildInvalidResponse('TARS type response is missing text', payload, 'tars_invalid_type');
		return {
			ok: true,
			actionType,
			text,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	if (actionType === 'hotkey') {
		const rawKey = firstDefined(payload.key, payload.shortcut, Array.isArray(payload.keys) ? payload.keys.join('+') : payload.keys, '');
		const key = String(rawKey || '').trim().toLowerCase();
		if (!key) return buildInvalidResponse('TARS hotkey response is missing key data', payload, 'tars_invalid_hotkey');
		return {
			ok: true,
			actionType,
			key,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	if (actionType === 'wait') {
		const durationMs = Math.max(
			50,
			Math.round(
				toFiniteNumber(firstDefined(payload.duration_ms, payload.ms, null))
				|| ((toFiniteNumber(firstDefined(payload.seconds, payload.duration_seconds, 0.5)) || 0.5) * 1000)
			)
		);
		return {
			ok: true,
			actionType,
			durationMs,
			thought,
			latencyMs,
			raw: payload,
		};
	}

	return {
		ok: true,
		actionType,
		result: String(firstDefined(payload.result, payload.message, payload.status_text, 'Task finished') || 'Task finished'),
		thought,
		latencyMs,
		raw: payload,
	};
}

// --- UI-TARS VLM output parser ---
// UI-TARS returns free-text actions like "click(512, 384)" with an optional
// "Thought: ..." prefix.  Coordinates are in a 1000x1000 normalized space
// and must be denormalized to pixel coordinates before downstream validation.

const VLM_ACTION_RE = /^(click|left_double|right_single|drag|hotkey|type|scroll|wait|finished|call_user)\s*\((.+)\)\s*$/im;

function denormCoord(value, dimension) {
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return (n / 1000) * dimension;
}

function parseUITarsModelOutput(text, imageWidth, imageHeight) {
	if (typeof text !== 'string' || !text.trim()) return null;

	let thought = '';
	let actionLine = text.trim();

	// Extract "Thought: ..." prefix (may span multiple lines before the action)
	const thoughtMatch = actionLine.match(/^Thought:\s*([\s\S]*?)(?=\n\s*(?:click|left_double|right_single|drag|hotkey|type|scroll|wait|finished|call_user)\s*\()/im);
	if (thoughtMatch) {
		thought = thoughtMatch[1].trim();
		actionLine = actionLine.slice(thoughtMatch[0].length).trim();
	} else if (/^Thought:/im.test(actionLine)) {
		// Thought with no recognized action following — treat whole thing as thought
		const parts = actionLine.split('\n');
		const thoughtParts = [];
		let foundAction = false;
		for (const line of parts) {
			if (VLM_ACTION_RE.test(line.trim())) {
				actionLine = line.trim();
				foundAction = true;
				break;
			}
			thoughtParts.push(line);
		}
		if (!foundAction) return null;
		thought = thoughtParts.join('\n').replace(/^Thought:\s*/i, '').trim();
	}

	const match = actionLine.match(VLM_ACTION_RE);
	if (!match) return null;

	const action = match[1].toLowerCase();
	const argsRaw = match[2].trim();

	const w = Number(imageWidth) || 0;
	const h = Number(imageHeight) || 0;

	switch (action) {
		case 'click': {
			const coords = argsRaw.split(',').map(s => s.trim());
			if (coords.length < 2) return null;
			const x = denormCoord(coords[0], w);
			const y = denormCoord(coords[1], h);
			if (x == null || y == null) return null;
			return { action_type: 'click', x, y, thought };
		}
		case 'left_double': {
			const coords = argsRaw.split(',').map(s => s.trim());
			if (coords.length < 2) return null;
			const x = denormCoord(coords[0], w);
			const y = denormCoord(coords[1], h);
			if (x == null || y == null) return null;
			return { action_type: 'double_click', x, y, thought };
		}
		case 'right_single': {
			const coords = argsRaw.split(',').map(s => s.trim());
			if (coords.length < 2) return null;
			const x = denormCoord(coords[0], w);
			const y = denormCoord(coords[1], h);
			if (x == null || y == null) return null;
			return { action_type: 'right_click', x, y, thought };
		}
		case 'drag': {
			const coords = argsRaw.split(',').map(s => s.trim());
			if (coords.length < 4) return null;
			const x = denormCoord(coords[0], w);
			const y = denormCoord(coords[1], h);
			const x2 = denormCoord(coords[2], w);
			const y2 = denormCoord(coords[3], h);
			if (x == null || y == null || x2 == null || y2 == null) return null;
			return { action_type: 'drag', x, y, x2, y2, thought };
		}
		case 'type': {
			return { action_type: 'type', text: argsRaw, thought };
		}
		case 'hotkey': {
			return { action_type: 'hotkey', key: argsRaw.trim().toLowerCase(), thought };
		}
		case 'scroll': {
			const parts = argsRaw.split(',').map(s => s.trim());
			const direction = (parts[0] || 'down').toLowerCase();
			const amount = Math.max(1, Math.round(Number(parts[1]) || 3));
			return { action_type: 'scroll', direction, amount, thought };
		}
		case 'wait': {
			const seconds = Number(argsRaw) || 0.5;
			return { action_type: 'wait', duration_ms: Math.round(seconds * 1000), thought };
		}
		case 'finished': {
			return { action_type: 'finished', result: argsRaw || 'Task finished', thought };
		}
		case 'call_user': {
			return { action_type: 'finished', result: `call_user: ${argsRaw}`, thought };
		}
		default:
			return null;
	}
}

function validatePointInBounds(point, width, height, label, raw) {
	if (!point || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
		return {
			ok: false,
			code: 'tars_out_of_bounds',
			error: `TARS ${label} coordinates (${point?.x}, ${point?.y}) are outside image bounds ${width}x${height}`,
			raw,
		};
	}
	return { ok: true };
}

function validateTarsAction(response, captureContext = {}) {
	if (!response?.ok) {
		return {
			ok: false,
			code: response?.code || 'tars_invalid_response',
			error: response?.error || 'TARS response is invalid',
			raw: response?.raw ?? null,
		};
	}

	if (!['click', 'double_click', 'right_click', 'drag'].includes(response.actionType)) {
		return { ...response, ok: true };
	}

	const width = Number(captureContext.imageWidth || 0);
	const height = Number(captureContext.imageHeight || 0);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return {
			ok: false,
			code: 'tars_capture_context_missing',
			error: 'Capture context is missing image dimensions',
			raw: response.raw,
		};
	}

	const firstPoint = validatePointInBounds({ x: response.x, y: response.y }, width, height, 'point', response.raw);
	if (!firstPoint.ok) return firstPoint;

	if (response.actionType === 'drag') {
		return validatePointInBounds({ x: response.x2, y: response.y2 }, width, height, 'drag end', response.raw);
	}

	return { ...response, ok: true };
}

function validateTarsImagePoint(response, captureContext = {}) {
	return validateTarsAction(response, captureContext);
}

const UI_TARS_VLM_SYSTEM_PROMPT = [
	'You are a GUI automation agent. You are given a screenshot of a macOS desktop and a task instruction.',
	'Analyze the screenshot and determine the single best next action to accomplish the task.',
	'',
	'Output format: First optionally state your reasoning on a line starting with "Thought:", then output exactly one action call on a new line.',
	'',
	'Available actions:',
	'- click(x, y) — left click at coordinates',
	'- left_double(x, y) — double click at coordinates',
	'- right_single(x, y) — right click at coordinates',
	'- drag(x1, y1, x2, y2) — drag from start to end',
	'- type(text) — type the given text',
	'- hotkey(keys) — press key combination (e.g., cmd+c)',
	'- scroll(direction, amount) — scroll up/down/left/right by amount',
	'- wait(seconds) — wait before next action',
	'- finished(status) — task is complete, with status description',
	'- call_user(reason) — cannot proceed, need user help',
	'',
	'Coordinates are in the range [0, 1000] relative to the screenshot dimensions.',
	'Return only the action call. Do not wrap in markdown or JSON.',
].join('\n');

async function requestTarsActionVLM({ screenshotBase64, instruction, imageWidth, imageHeight }) {
	const tars = getTarsConfig();
	if (!tars.enabled || !tars.endpoint || !tars.apiKey) {
		return { ok: false, code: 'tars_disabled', error: 'TARS is not configured' };
	}
	if (!screenshotBase64 || !instruction) {
		return { ok: false, code: 'tars_invalid_request', error: 'Missing screenshot or instruction for TARS VLM request' };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), tars.timeoutMs);

	try {
		const response = await fetch(tars.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${tars.apiKey}`,
			},
			body: JSON.stringify({
				model: tars.model,
				messages: [
					{ role: 'system', content: UI_TARS_VLM_SYSTEM_PROMPT },
					{
						role: 'user',
						content: [
							{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
							{ type: 'text', text: instruction },
						],
					},
				],
				max_tokens: 256,
				temperature: 0,
			}),
			signal: controller.signal,
		});

		const rawText = await response.text();
		let payload = null;
		try {
			payload = rawText ? JSON.parse(rawText) : null;
		} catch {
			return {
				ok: false,
				code: 'tars_invalid_response',
				error: `UI-TARS VLM returned non-JSON response (HTTP ${response.status})`,
				status: response.status,
				rawText,
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				code: response.status === 401 || response.status === 403 ? 'tars_auth_failed' : 'tars_http_error',
				error: payload?.error?.message || payload?.detail || `UI-TARS VLM request failed with HTTP ${response.status}`,
				status: response.status,
				raw: payload,
			};
		}

		const content = payload?.choices?.[0]?.message?.content;
		if (typeof content !== 'string' || !content.trim()) {
			return buildInvalidResponse('UI-TARS VLM returned empty or missing content', payload);
		}

		const parsed = parseUITarsModelOutput(content, imageWidth || 0, imageHeight || 0);
		if (!parsed) {
			return buildInvalidResponse(`UI-TARS VLM output could not be parsed: ${content}`, payload);
		}

		return normalizeTarsResponse(parsed);
	} catch (err) {
		if (err?.name === 'AbortError') {
			return { ok: false, code: 'tars_timeout', error: `UI-TARS VLM request timed out after ${tars.timeoutMs}ms` };
		}
		return { ok: false, code: 'tars_network_error', error: err?.message || 'UI-TARS VLM request failed' };
	} finally {
		clearTimeout(timer);
	}
}

async function requestTarsActionCustom({ screenshotBase64, instruction }) {
	const tars = getTarsConfig();

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), tars.timeoutMs);

	try {
		const response = await fetch(tars.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': tars.apiKey,
			},
			body: JSON.stringify({
				screenshot_base64: screenshotBase64,
				instruction,
			}),
			signal: controller.signal,
		});

		const rawText = await response.text();
		let payload = null;
		try {
			payload = rawText ? JSON.parse(rawText) : null;
		} catch {
			return {
				ok: false,
				code: 'tars_invalid_response',
				error: `TARS returned non-JSON response (HTTP ${response.status})`,
				status: response.status,
				rawText,
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				code: response.status === 401 || response.status === 403 ? 'tars_auth_failed' : 'tars_http_error',
				error: payload?.detail || `TARS request failed with HTTP ${response.status}`,
				status: response.status,
				raw: payload,
			};
		}

		return normalizeTarsResponse(payload);
	} catch (err) {
		if (err?.name === 'AbortError') {
			return {
				ok: false,
				code: 'tars_timeout',
				error: `TARS request timed out after ${tars.timeoutMs}ms`,
			};
		}
		return {
			ok: false,
			code: 'tars_network_error',
			error: err?.message || 'TARS request failed',
		};
	} finally {
		clearTimeout(timer);
	}
}

async function requestTarsAction({ screenshotBase64, instruction, imageWidth, imageHeight }) {
	const tars = getTarsConfig();
	if (!tars.enabled || !tars.endpoint || !tars.apiKey) {
		return { ok: false, code: 'tars_disabled', error: 'TARS is not configured' };
	}
	if (!screenshotBase64 || !instruction) {
		return { ok: false, code: 'tars_invalid_request', error: 'Missing screenshot or instruction for TARS request' };
	}
	if (tars.provider === 'openai-compatible') {
		return requestTarsActionVLM({ screenshotBase64, instruction, imageWidth, imageHeight });
	}
	return requestTarsActionCustom({ screenshotBase64, instruction });
}

module.exports = {
	getTarsConfig,
	normalizeTarsResponse,
	parseUITarsModelOutput,
	validateTarsAction,
	validateTarsImagePoint,
	requestTarsAction,
};
