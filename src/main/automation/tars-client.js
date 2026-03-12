const config = require('../../shared/config').default;

function getTarsConfig() {
	const tars = config?.tars || {};
	const endpoint = String(process.env.TARS_ENDPOINT || tars.endpoint || '').trim();
	const apiKey = String(process.env.TARS_API_KEY || tars.apiKey || '').trim();
	const timeoutMs = Math.max(1000, Number(process.env.TARS_TIMEOUT_MS || tars.timeoutMs || 8000));
	const envEnabled = process.env.TARS_ENABLED;
	const enabled = envEnabled != null
		? envEnabled !== '0'
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
		return {
			ok: false,
			code: 'tars_invalid_response',
			error: 'TARS response must be a JSON object',
		};
	}

	const actionType = String(payload.action_type || '').trim();
	const x = Number(payload.x);
	const y = Number(payload.y);
	const thought = typeof payload.thought === 'string' ? payload.thought : '';
	const latencyMs = Number(payload.latency_ms);

	if (actionType !== 'click') {
		return {
			ok: false,
			code: 'tars_unsupported_action',
			error: `Unsupported TARS action_type "${actionType || 'unknown'}"`,
			raw: payload,
		};
	}
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return {
			ok: false,
			code: 'tars_invalid_response',
			error: 'TARS response is missing finite x/y coordinates',
			raw: payload,
		};
	}

	return {
		ok: true,
		actionType,
		x,
		y,
		thought,
		latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
		raw: payload,
	};
}

function validateTarsImagePoint(response, captureContext = {}) {
	if (!response?.ok) {
		return {
			ok: false,
			code: response?.code || 'tars_invalid_response',
			error: response?.error || 'TARS response is invalid',
			raw: response?.raw ?? null,
		};
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

	if (response.x < 0 || response.y < 0 || response.x >= width || response.y >= height) {
		return {
			ok: false,
			code: 'tars_out_of_bounds',
			error: `TARS coordinates (${response.x}, ${response.y}) are outside image bounds ${width}x${height}`,
			raw: response.raw,
		};
	}

	return {
		ok: true,
		x: response.x,
		y: response.y,
		actionType: response.actionType,
		thought: response.thought,
		latencyMs: response.latencyMs,
		raw: response.raw,
	};
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
	validateTarsImagePoint,
	requestTarsAction,
};
