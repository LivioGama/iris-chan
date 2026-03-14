// Source adapter wrapping auth.js Mail.app reader
const { readMail, extractOTP } = require('../../tools/auth');

const adapter = {
	name: 'mail',
	priority: 4,
	enabled() { return process.platform === 'darwin'; },
	async fetchCode(context) {
		const maxAge = context.maxCodeAgeSeconds || 300;
		const mails = await readMail(maxAge);
		for (const msg of mails) {
			const code = extractOTP(msg.text);
			if (code) return { code, confidence: 0.85, timestamp: Date.now(), meta: { sender: msg.sender } };
		}
		return null;
	},
};

module.exports = adapter;
