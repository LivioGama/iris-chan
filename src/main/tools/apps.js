// Tool handlers: open_app, get_frontmost_app, window_manage
const { runHelper } = require('../native-helper');

async function open_app(args) {
	return runHelper({ action: 'open_app', name: args.name || '' });
}

async function get_frontmost_app() {
	return runHelper({ action: 'get_frontmost_app' });
}

async function window_manage(args) {
	return runHelper({ action: 'window_manage', position: args.position || 'maximize' });
}

module.exports = {
	open_app,
	get_frontmost_app,
	window_manage,
};
