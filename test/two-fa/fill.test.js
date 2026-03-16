// Unit tests for 2FA fill module (vision-based: type_text only)
const assert = require('node:assert');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

async function testAsync(name, fn) {
	try { await fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

// ---- Mock runHelper ----
let helperCalls = [];
let helperResponses = {};

function mockRunHelper(actionObj) {
	helperCalls.push(actionObj);
	const key = actionObj.action;
	if (typeof helperResponses[key] === 'function') return Promise.resolve(helperResponses[key](actionObj));
	return Promise.resolve(helperResponses[key] || { ok: true, result: '' });
}

require.cache[require.resolve('../../src/main/native-helper')] = {
	id: require.resolve('../../src/main/native-helper'),
	filename: require.resolve('../../src/main/native-helper'),
	loaded: true,
	exports: { runHelper: mockRunHelper },
};

require.cache[require.resolve('../../src/main/logger')] = {
	id: require.resolve('../../src/main/logger'),
	filename: require.resolve('../../src/main/logger'),
	loaded: true,
	exports: { info() {}, warn() {}, error() {}, debug() {} },
};

// Clear any cached mock from other test files (e.g. orchestrator.test.js)
delete require.cache[require.resolve('../../src/main/two-fa/fill')];
const { fillCode, verifyFill } = require('../../src/main/two-fa/fill');

function resetMocks() {
	helperCalls = [];
	helperResponses = {
		type_text: { ok: true, result: 'typed' },
	};
}

async function runTests() {
	await testAsync('fillCode uses type_text', async () => {
		resetMocks();
		const result = await fillCode('123456', { type: 'vision', appName: 'Chrome' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.method, 'type_text');
		const typeCall = helperCalls.find(c => c.action === 'type_text');
		assert.ok(typeCall, 'Should call type_text');
		assert.strictEqual(typeCall.text, '123456');
	});

	await testAsync('fillCode returns error when type_text fails', async () => {
		resetMocks();
		helperResponses.type_text = { ok: false, result: 'keystroke failed' };
		const result = await fillCode('654321', { type: 'vision', appName: 'Safari' });
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.method, 'type_text');
		assert.strictEqual(result.error, 'keystroke failed');
	});

	await testAsync('fillCode does not call ax_set_value or ax_focus', async () => {
		resetMocks();
		await fillCode('111111', { type: 'vision', fieldQuery: 'code', appName: 'Arc' });
		const axCalls = helperCalls.filter(c => c.action === 'ax_set_value' || c.action === 'ax_focus');
		assert.strictEqual(axCalls.length, 0, 'Should not use AX methods');
	});

	await testAsync('verifyFill returns verified: true', async () => {
		resetMocks();
		const result = await verifyFill();
		assert.strictEqual(result.verified, true);
	});

	console.log('\nAll fill tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
