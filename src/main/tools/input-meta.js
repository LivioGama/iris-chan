const { runHelper } = require('../native-helper');
const { fromScreen } = require('./input');

async function get_mouse_position() {
	const result = await runHelper({ action: 'get_mouse_position' });
	if (!result.ok) return result;
	// Swift helper returns screen (CGEvent) coordinates "x:NNN,y:NNN".
	// Convert to image-pixel coordinates so Gemini can reuse them directly.
	const match = result.result.match(/x:(\d+),y:(\d+)/);
	if (match) {
		const screenX = parseInt(match[1], 10);
		const screenY = parseInt(match[2], 10);
		const img = fromScreen(screenX, screenY);
		return { ok: true, result: `x:${img.x},y:${img.y}` };
	}
	return result;
}

async function propose_reply(args) {
	return runHelper({ action: 'type_text', text: args.reply || '' });
}

module.exports = { propose_reply, get_mouse_position };
