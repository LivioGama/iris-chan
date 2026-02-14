// Tool handlers: type_text, press_key, click_at, double_click, mouse_move, drag, scroll
const { runHelper } = require('../native-helper');

async function type_text(args) {
	return runHelper({ action: 'type_text', text: args.text || '' });
}

async function press_key(args) {
	return runHelper({ action: 'press_key', key: args.key || '' });
}

async function click_at(args) {
	return runHelper({
		action: 'click_at',
		x: parseFloat(args.x || 0),
		y: parseFloat(args.y || 0),
		button: args.button || 'left',
	});
}

async function double_click(args) {
	return runHelper({
		action: 'double_click',
		x: parseFloat(args.x || 0),
		y: parseFloat(args.y || 0),
	});
}

async function mouse_move(args) {
	return runHelper({
		action: 'mouse_move',
		x: parseFloat(args.x || 0),
		y: parseFloat(args.y || 0),
	});
}

async function drag(args) {
	return runHelper({
		action: 'drag',
		x: parseFloat(args.x || 0),
		y: parseFloat(args.y || 0),
		x2: parseFloat(args.x2 || 0),
		y2: parseFloat(args.y2 || 0),
	});
}

async function scroll(args) {
	return runHelper({
		action: 'scroll',
		direction: args.direction || 'down',
		amount: args.amount != null ? parseInt(args.amount) : 3,
	});
}

module.exports = { type_text, press_key, click_at, double_click, mouse_move, drag, scroll };
