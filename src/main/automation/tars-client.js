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
	return {
		enabled,
		endpoint,
		apiKey,
		timeoutMs,
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

async function requestTarsAction({ screenshotBase64, instruction }) {
	const tars = getTarsConfig();
	if (!tars.enabled || !tars.endpoint || !tars.apiKey) {
		return {
			ok: false,
			code: 'tars_disabled',
			error: 'TARS rescue is not configured',
		};
	}
	if (!screenshotBase64 || !instruction) {
		return {
			ok: false,
			code: 'tars_invalid_request',
			error: 'Missing screenshot_base64 or instruction for TARS request',
		};
	}

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

module.exports = {
	getTarsConfig,
	normalizeTarsResponse,
	validateTarsAction,
	validateTarsImagePoint,
	requestTarsAction,
};
