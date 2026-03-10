// Tool handlers: type_text, press_key, click_at, double_click, mouse_move, drag, scroll
const { runHelper } = require('../native-helper');
const { getMapping, getCaptureHealth } = require('../screen-capture');
const { isCaptureUsable, formatCaptureBlockReason } = require('../screen-capture-health');

// Convert image-pixel coordinates (from Gemini) → logical screen coordinates (for CGEvent).
// Image (0,0) = top-left of the captured display, which lives at (offsetX, offsetY) in global screen space.
function toScreen(imgX, imgY) {
	const m = getMapping();
	return {
		x: Math.round(imgX * m.scaleX + (m.offsetX || 0)),
		y: Math.round(imgY * m.scaleY + (m.offsetY || 0)),
	};
}

// Inverse: convert logical screen coordinates (CGEvent) → image-pixel coordinates.
function fromScreen(screenX, screenY) {
	const m = getMapping();
	return {
		x: Math.round((screenX - (m.offsetX || 0)) / m.scaleX),
		y: Math.round((screenY - (m.offsetY || 0)) / m.scaleY),
	};
}

function requireFreshCapture(actionLabel) {
	const health = getCaptureHealth();
	if (!isCaptureUsable(health)) {
		return { ok: false, result: formatCaptureBlockReason(actionLabel, health) };
	}
	return null;
}

async function type_text(args) {
	return runHelper({ action: 'type_text', text: args.text || '' });
}

async function press_key(args) {
	return runHelper({ action: 'press_key', key: args.key || '' });
}

async function click_at(args) {
	const blocked = requireFreshCapture('click');
	if (blocked) return blocked;
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	return runHelper({ action: 'click_at', x, y, button: args.button || 'left' });
}

async function double_click(args) {
	const blocked = requireFreshCapture('double-click');
	if (blocked) return blocked;
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	return runHelper({ action: 'double_click', x, y });
}

async function mouse_move(args) {
	const blocked = requireFreshCapture('move the mouse');
	if (blocked) return blocked;
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	const result = await runHelper({ action: 'mouse_move', x, y });
	if (!result.ok && result.result?.includes('off by')) {
		await new Promise(r => setTimeout(r, 50));
		return runHelper({ action: 'mouse_move', x, y });
	}
	return result;
}

async function drag(args) {
	const blocked = requireFreshCapture('drag');
	if (blocked) return blocked;
	const from = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	const to = toScreen(parseFloat(args.x2 || 0), parseFloat(args.y2 || 0));
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
