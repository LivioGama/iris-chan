const { runHelper } = require('../native-helper');

async function get_mouse_position() {
	return runHelper({ action: 'get_mouse_position' });
}

async function propose_reply(args) {
	return runHelper({ action: 'type_text', text: args.reply || '' });
}

module.exports = { propose_reply, get_mouse_position };
