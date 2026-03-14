// Unit tests for 2FA source adapters and gatherCodes
const assert = require('node:assert');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

async function testAsync(name, fn) {
	try { await fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

// ---- Mock dependencies ----
let helperResponses = {};
require.cache[require.resolve('../../src/main/native-helper')] = {
	id: require.resolve('../../src/main/native-helper'),
	filename: require.resolve('../../src/main/native-helper'),
	loaded: true,
	exports: {
		runHelper: async (actionObj) => {
			const key = actionObj.action;
			return helperResponses[key] || { ok: false, result: '' };
		},
	},
};

let mockMessages = [];
let mockMails = [];
let mockNotifications = [];
require.cache[require.resolve('../../src/main/tools/auth')] = {
	id: require.resolve('../../src/main/tools/auth'),
	filename: require.resolve('../../src/main/tools/auth'),
	loaded: true,
	exports: {
		readMessages: async () => mockMessages,
		readMail: async () => mockMails,
		readNotifications: async () => mockNotifications,
		extractOTP: (text) => {
			const m = text.match(/\b(\d{4,8})\b/);
			return m ? m[1] : null;
		},
		auto_2fa: async () => ({ ok: false }),
	},
};

require.cache[require.resolve('../../src/main/logger')] = {
	id: require.resolve('../../src/main/logger'),
	filename: require.resolve('../../src/main/logger'),
	loaded: true,
	exports: { info() {}, warn() {}, error() {}, debug() {} },
};

// Clear any cached source modules so they pick up our mocks
for (const key of Object.keys(require.cache)) {
	if (key.includes('two-fa/sources/') && !key.includes('.test.')) {
		delete require.cache[key];
	}
}

const keychainAdapter = require('../../src/main/two-fa/sources/keychain-totp');
const messagesAdapter = require('../../src/main/two-fa/sources/messages');
const mailAdapter = require('../../src/main/two-fa/sources/mail');
const notificationsAdapter = require('../../src/main/two-fa/sources/notifications');

function resetMocks() {
	helperResponses = {};
	mockMessages = [];
	mockMails = [];
	mockNotifications = [];
}

async function runTests() {
	// ---- Keychain-TOTP adapter tests ----

	await testAsync('keychain-totp: extracts code from Passwords suggestion', async () => {
		resetMocks();
		helperResponses.ax_snapshot = {
			ok: true,
			result: JSON.stringify([
				{ title: 'From Passwords: 482910', role: 'AXStaticText', value: '' },
			]),
		};
		const result = await keychainAdapter.fetchCode({});
		assert.ok(result, 'Should find a code');
		assert.strictEqual(result.code, '482910');
		assert.strictEqual(result.confidence, 1.0);
	});

	await testAsync('keychain-totp: returns null when no autofill suggestion', async () => {
		resetMocks();
		helperResponses.ax_snapshot = {
			ok: true,
			result: JSON.stringify([
				{ title: 'Username', role: 'AXTextField', value: '' },
			]),
		};
		const result = await keychainAdapter.fetchCode({});
		assert.strictEqual(result, null);
	});

	await testAsync('keychain-totp: handles snapshot failure gracefully', async () => {
		resetMocks();
		helperResponses.ax_snapshot = { ok: false, result: '' };
		const result = await keychainAdapter.fetchCode({});
		assert.strictEqual(result, null);
	});

	await testAsync('keychain-totp: extracts from AXGroup with autofill keyword', async () => {
		resetMocks();
		helperResponses.ax_snapshot = {
			ok: true,
			result: JSON.stringify([
				{ title: 'AutoFill Code 739201', role: 'AXGroup', value: '' },
			]),
		};
		const result = await keychainAdapter.fetchCode({});
		assert.ok(result, 'Should extract from AXGroup autofill');
		assert.strictEqual(result.code, '739201');
	});

	// ---- Messages adapter tests ----

	await testAsync('messages: extracts OTP from message text', async () => {
		resetMocks();
		mockMessages = [{ text: 'Your verification code is 847291', sender: '+15551234567' }];
		const result = await messagesAdapter.fetchCode({ maxCodeAgeSeconds: 300 });
		assert.ok(result, 'Should find a code');
		assert.strictEqual(result.code, '847291');
		assert.strictEqual(result.confidence, 0.9);
	});

	await testAsync('messages: returns null when no OTP in messages', async () => {
		resetMocks();
		mockMessages = [{ text: 'Hey, how are you?', sender: 'friend' }];
		const result = await messagesAdapter.fetchCode({ maxCodeAgeSeconds: 300 });
		assert.strictEqual(result, null);
	});

	await testAsync('messages: returns null when no messages', async () => {
		resetMocks();
		mockMessages = [];
		const result = await messagesAdapter.fetchCode({});
		assert.strictEqual(result, null);
	});

	// ---- Mail adapter tests ----

	await testAsync('mail: extracts OTP from email', async () => {
		resetMocks();
		mockMails = [{ text: 'Your login code: 551023', sender: 'noreply@example.com' }];
		const result = await mailAdapter.fetchCode({ maxCodeAgeSeconds: 300 });
		assert.ok(result, 'Should find a code');
		assert.strictEqual(result.code, '551023');
		assert.strictEqual(result.confidence, 0.85);
	});

	await testAsync('mail: returns null when no OTP in mail', async () => {
		resetMocks();
		mockMails = [{ text: 'Weekly newsletter content', sender: 'news@example.com' }];
		const result = await mailAdapter.fetchCode({ maxCodeAgeSeconds: 300 });
		assert.strictEqual(result, null);
	});

	// ---- Notifications adapter tests ----

	await testAsync('notifications: extracts OTP from notification text', async () => {
		resetMocks();
		mockNotifications = [{ text: 'Google: Your verification code is 982341', sender: 'notification' }];
		const result = await notificationsAdapter.fetchCode({});
		assert.ok(result, 'Should find a code');
		assert.strictEqual(result.code, '982341');
		assert.strictEqual(result.confidence, 0.8);
	});

	await testAsync('notifications: returns null when no OTP', async () => {
		resetMocks();
		mockNotifications = [{ text: 'New message from John', sender: 'notification' }];
		const result = await notificationsAdapter.fetchCode({});
		assert.strictEqual(result, null);
	});

	// ---- Adapter metadata tests ----

	test('keychain-totp adapter has correct metadata', () => {
		assert.strictEqual(keychainAdapter.name, 'keychain-totp');
		assert.strictEqual(keychainAdapter.priority, 0);
	});

	test('messages adapter has correct metadata', () => {
		assert.strictEqual(messagesAdapter.name, 'messages');
		assert.strictEqual(messagesAdapter.priority, 3);
	});

	test('mail adapter has correct metadata', () => {
		assert.strictEqual(mailAdapter.name, 'mail');
		assert.strictEqual(mailAdapter.priority, 4);
	});

	test('notifications adapter has correct metadata', () => {
		assert.strictEqual(notificationsAdapter.name, 'notifications');
		assert.strictEqual(notificationsAdapter.priority, 5);
	});

	console.log('\nAll source adapter tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
