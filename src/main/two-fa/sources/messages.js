// Source adapter wrapping auth.js Messages.app reader
const { readMessages, extractOTP } = require('../../tools/auth');

const adapter = {
	name: 'messages',
	priority: 3,
	enabled() { return process.platform === 'darwin'; },
	async fetchCode(context) {
		const maxAge = context.maxCodeAgeSeconds || 300;
		const msgs = await readMessages(maxAge);
		for (const msg of msgs) {
			const code = extractOTP(msg.text);
			if (code) return { code, confidence: 0.9, timestamp: Date.now(), meta: { sender: msg.sender } };
		}
		return null;
	},
};

module.exports = adapter;
