// TARS vision agent — sends screenshot to UI-TARS for accurate UI element localization.
// Captures current screen, resizes to 1280px max, sends to TARS server, executes the returned action.

const { nativeImage } = require('electron');
const { capture } = require('../screen-capture');
const { runHelper } = require('../native-helper');
const log = require('../logger');

const TARS_URL = process.env.TARS_URL || 'http://localhost:8100/action';
const TARS_API_KEY = process.env.TARS_API_KEY || '';
const TARS_MAX_DIMENSION = 1280;

function resizeScreenshot(jpegBase64) {
	const img = nativeImage.createFromBuffer(Buffer.from(jpegBase64, 'base64'));
	const { width, height } = img.getSize();
	const longest = Math.max(width, height);
	if (longest <= TARS_MAX_DIMENSION) {
		return jpegBase64; // already small enough
	}
	const scale = TARS_MAX_DIMENSION / longest;
	const newW = Math.round(width * scale);
	const newH = Math.round(height * scale);
	const resized = img.resize({ width: newW, height: newH, quality: 'good' });
	return resized.toJPEG(70).toString('base64');
}

async function tars_action(args) {
	const instruction = args?.instruction;
	if (!instruction) return { ok: false, result: 'Error: Missing instruction' };

	const textToType = args?.text || null;

	// Step 1: Capture screenshot
	const screenshot = await capture();
	if (!screenshot.ok || !screenshot.data) {
		return { ok: false, result: 'Error: Failed to capture screenshot' };
	}

	const { displayWidth, displayHeight } = screenshot.context;

	// Step 2: Resize to 1280px max
	let resizedBase64;
	try {
		resizedBase64 = resizeScreenshot(screenshot.data);
	} catch (err) {
		log.error('TARS', `Resize failed: ${err.message}`);
		resizedBase64 = screenshot.data;
	}

	const payloadKB = Math.round(resizedBase64.length * 3 / 4 / 1024);
	log.info('TARS', `Sending ${payloadKB}KB screenshot, instruction: "${instruction}"`);

	// Step 3: Call TARS server
	const payload = JSON.stringify({
		screenshot_base64: resizedBase64,
		instruction,
		screen_width: displayWidth,
		screen_height: displayHeight,
	});

	const headers = { 'Content-Type': 'application/json' };
	if (TARS_API_KEY) headers['X-API-Key'] = TARS_API_KEY;

	let tarsResult;
	try {
		const resp = await fetch(TARS_URL, {
			method: 'POST',
			headers,
			body: payload,
			signal: AbortSignal.timeout(30000),
		});

		if (!resp.ok) {
			const body = await resp.text();
			log.error('TARS', `Server error ${resp.status}: ${body.slice(0, 200)}`);
			return { ok: false, result: `Error: TARS server returned ${resp.status}` };
		}

		tarsResult = await resp.json();
	} catch (err) {
		log.error('TARS', `Request failed: ${err.message}`);
		return { ok: false, result: `Error: TARS request failed: ${err.message}` };
	}

	const actionType = tarsResult.action_type || 'unknown';
	const thought = tarsResult.thought || '';
	const latencyMs = tarsResult.latency_ms || 0;

	log.info('TARS', `Result: ${actionType} (${latencyMs}ms) — ${thought.slice(0, 100)}`);

	// Step 4: Execute the action
	// TARS returns coordinates in screen space (denormalized by server using screen_width/height)
	switch (actionType) {
		case 'click': {
			const x = Math.round(tarsResult.x);
			const y = Math.round(tarsResult.y);
			await runHelper({ action: 'click_at', x, y, button: 'left' });

			if (textToType) {
				await new Promise(r => setTimeout(r, 150));
				await runHelper({ action: 'type_text', text: textToType });
				return { ok: true, result: `Clicked at (${x}, ${y}) and typed '${textToType.slice(0, 50)}' — ${thought}` };
			}
			return { ok: true, result: `Clicked at (${x}, ${y}) — ${thought}` };
		}

		case 'type': {
			const text = tarsResult.text || textToType || '';
			if (tarsResult.x != null && tarsResult.y != null) {
				await runHelper({ action: 'click_at', x: Math.round(tarsResult.x), y: Math.round(tarsResult.y), button: 'left' });
				await new Promise(r => setTimeout(r, 150));
			}
			await runHelper({ action: 'type_text', text });
			return { ok: true, result: `Typed '${text.slice(0, 50)}' — ${thought}` };
		}

		case 'scroll': {
			const direction = tarsResult.direction || 'down';
			await runHelper({ action: 'scroll', direction, amount: 3 });
			return { ok: true, result: `Scrolled ${direction} — ${thought}` };
		}

		case 'hotkey': {
			const key = tarsResult.key || '';
			await runHelper({ action: 'press_key', key });
			return { ok: true, result: `Pressed ${key} — ${thought}` };
		}

		case 'drag': {
			if (tarsResult.start_x != null && tarsResult.end_x != null) {
				await runHelper({
					action: 'drag',
					x: Math.round(tarsResult.start_x),
					y: Math.round(tarsResult.start_y),
					x2: Math.round(tarsResult.end_x),
					y2: Math.round(tarsResult.end_y),
				});
				return { ok: true, result: `Dragged — ${thought}` };
			}
			return { ok: false, result: 'TARS returned drag but missing coordinates' };
		}

		default:
			return { ok: false, result: `TARS action '${actionType}' not supported. Thought: ${thought}` };
	}
}

module.exports = { tars_action };
