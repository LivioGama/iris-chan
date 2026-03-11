// Tool handlers: type_text, press_key, click_at, double_click, mouse_move, drag, scroll
const { runHelper } = require('../native-helper');
const { getMapping, getCaptureHealth } = require('../screen-capture');
const { isCaptureUsable, formatCaptureBlockReason } = require('../screen-capture-health');
const { getNativeFallbackManager } = require('../automation/service-ref');

// Convert image-pixel coordinates (from Gemini) → logical screen coordinates (for CGEvent).
// Image (0,0) = top-left of the captured display, which lives at (offsetX, offsetY) in global screen space.
function toScreen(imgX, imgY, captureId = '') {
	const m = getMapping(captureId);
	if (!m) return null;
	return {
		x: Math.round(imgX * m.scaleX + (m.offsetX || 0)),
		y: Math.round(imgY * m.scaleY + (m.offsetY || 0)),
	};
}

// Inverse: convert logical screen coordinates (CGEvent) → image-pixel coordinates.
function fromScreen(screenX, screenY, captureId = '') {
	const m = getMapping(captureId) || getMapping();
	if (!m) {
		return {
			x: Math.round(screenX),
			y: Math.round(screenY),
		};
	}
	return {
		x: Math.round((screenX - (m.offsetX || 0)) / m.scaleX),
		y: Math.round((screenY - (m.offsetY || 0)) / m.scaleY),
	};
}

function requireFreshCapture(actionLabel, captureId = '') {
	const pointerGate = getNativeFallbackManager()?.canUsePointerTools?.();
	if (pointerGate && pointerGate.ok === false) {
		return { ok: false, result: pointerGate.reason };
	}
	const health = getCaptureHealth(captureId);
	if (!isCaptureUsable(health)) {
		return { ok: false, result: formatCaptureBlockReason(actionLabel, health) };
	}
	return null;
}

function resolvePointerTarget(args, actionLabel) {
	const captureId = String(args?.capture_id || '').trim();
	const blocked = requireFreshCapture(actionLabel, captureId);
	if (blocked) return blocked;
	const point = toScreen(parseFloat(args?.x || 0), parseFloat(args?.y || 0), captureId);
	if (!point) {
		return {
			ok: false,
			result: `Cannot ${actionLabel} because capture_id "${captureId}" is no longer available.`,
		};
	}
	return {
		ok: true,
		point,
		captureId,
	};
}

async function type_text(args) {
	return runHelper({ action: 'type_text', text: args.text || '' });
}

async function press_key(args) {
	return runHelper({ action: 'press_key', key: args.key || '' });
}

async function click_at(args) {
	const resolved = resolvePointerTarget(args, 'click');
	if (!resolved.ok) return resolved;
	return runHelper({ action: 'click_at', x: resolved.point.x, y: resolved.point.y, button: args.button || 'left' });
}

async function double_click(args) {
	const resolved = resolvePointerTarget(args, 'double-click');
	if (!resolved.ok) return resolved;
	return runHelper({ action: 'double_click', x: resolved.point.x, y: resolved.point.y });
}

async function mouse_move(args) {
	const resolved = resolvePointerTarget(args, 'move the mouse');
	if (!resolved.ok) return resolved;
	const { x, y } = resolved.point;
	const result = await runHelper({ action: 'mouse_move', x, y });
	if (!result.ok && result.result?.includes('off by')) {
		await new Promise(r => setTimeout(r, 50));
		return runHelper({ action: 'mouse_move', x, y });
	}
	return result;
}

async function drag(args) {
	const captureId = String(args?.capture_id || '').trim();
	const blocked = requireFreshCapture('drag', captureId);
	if (blocked) return blocked;
	const from = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0), captureId);
	const to = toScreen(parseFloat(args.x2 || 0), parseFloat(args.y2 || 0), captureId);
	if (!from || !to) {
		return {
			ok: false,
			result: `Cannot drag because capture_id "${captureId}" is no longer available.`,
		};
	}
	return runHelper({ action: 'drag', x: from.x, y: from.y, x2: to.x, y2: to.y });
}

async function scroll(args) {
	return runHelper({
		action: 'scroll',
		direction: args.direction || 'down',
		amount: args.amount != null ? parseInt(args.amount) : 3,
	});
}

async function activate_app(args) {
	return runHelper({
		action: 'activate_app',
		name: args.name || '',
	});
}

module.exports = { type_text, press_key, click_at, double_click, mouse_move, drag, scroll, activate_app, fromScreen };
