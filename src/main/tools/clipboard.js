// Tool handlers: clipboard_read, clipboard_write
const { runHelper } = require('../native-helper');

async function clipboard_read() {
	return runHelper({ action: 'clipboard_read' });
}

async function clipboard_write(args) {
	return runHelper({ action: 'clipboard_write', text: args.text || '' });
}

module.exports = { clipboard_read, clipboard_write };
