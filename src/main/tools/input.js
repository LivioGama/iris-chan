// Tool handlers: type_text, press_key, click_at, double_click, mouse_move, drag, scroll
const { runHelper } = require('../native-helper');
const { getMapping } = require('../screen-capture');

// Convert image-pixel coordinates (from Gemini) → logical screen coordinates (for CGEvent)
function toScreen(imgX, imgY) {
	const m = getMapping();
	return { x: Math.round(imgX * m.scaleX), y: Math.round(imgY * m.scaleY) };
}

async function type_text(args) {
	return runHelper({ action: 'type_text', text: args.text || '' });
}

async function press_key(args) {
	return runHelper({ action: 'press_key', key: args.key || '' });
}

async function click_at(args) {
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	return runHelper({ action: 'click_at', x, y, button: args.button || 'left' });
}

async function double_click(args) {
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	return runHelper({ action: 'double_click', x, y });
}

async function mouse_move(args) {
	const { x, y } = toScreen(parseFloat(args.x || 0), parseFloat(args.y || 0));
	const result = await runHelper({ action: 'mouse_move', x, y });
	if (!result.ok && result.result?.includes('off by')) {
		await new Promise(r => setTimeout(r, 50));
		return runHelper({ action: 'mouse_move', x, y });
	}
	return result;
}

async function drag(args) {
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

module.exports = { type_text, press_key, click_at, double_click, mouse_move, drag, scroll, activate_app };
