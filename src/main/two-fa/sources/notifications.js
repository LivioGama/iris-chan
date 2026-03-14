// Source adapter wrapping auth.js Notification Center reader
const { readNotifications, extractOTP } = require('../../tools/auth');

const adapter = {
	name: 'notifications',
	priority: 5,
	enabled() { return process.platform === 'darwin'; },
	async fetchCode() {
		const notifs = await readNotifications();
		for (const msg of notifs) {
			const code = extractOTP(msg.text);
			if (code) return { code, confidence: 0.8, timestamp: Date.now(), meta: { sender: msg.sender } };
		}
		return null;
	},
};

module.exports = adapter;
