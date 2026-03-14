// Unit tests for 2FA fill module
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

const { fillCode, verifyFill } = require('../../src/main/two-fa/fill');

function resetMocks() {
	helperCalls = [];
	helperResponses = {
		ax_set_value: { ok: true, result: 'set' },
		ax_focus: { ok: true, result: 'focused' },
		type_text: { ok: true, result: 'typed' },
		ax_snapshot: { ok: true, result: JSON.stringify([{ title: 'Welcome', value: '', role: 'AXStaticText' }]) },
	};
}

async function runTests() {
	await testAsync('fillCode single field: uses ax_set_value when available', async () => {
		resetMocks();
		const result = await fillCode('123456', { type: 'single', fieldQuery: 'verification code' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.method, 'ax_set_value');
		const setCall = helperCalls.find(c => c.action === 'ax_set_value');
		assert.ok(setCall, 'Should call ax_set_value');
		assert.strictEqual(setCall.value, '123456');
	});

	await testAsync('fillCode single field: falls back to type_text when ax_set_value fails', async () => {
		resetMocks();
		helperResponses.ax_set_value = { ok: false, result: 'no settable field' };
		const result = await fillCode('654321', { type: 'single', fieldQuery: 'code input' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.method, 'type_text');
		const focusCall = helperCalls.find(c => c.action === 'ax_focus');
		assert.ok(focusCall, 'Should focus field before typing');
	});

	await testAsync('fillCode single field: type_text without fieldQuery', async () => {
		resetMocks();
		const result = await fillCode('111111', { type: 'single', fieldQuery: '' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.method, 'type_text');
	});

	await testAsync('fillCode split-digit: types each digit sequentially', async () => {
		resetMocks();
		const result = await fillCode('1234', { type: 'split-digit', fieldQuery: 'digit 1' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.method, 'split-digit');
		const typeCalls = helperCalls.filter(c => c.action === 'type_text');
		assert.strictEqual(typeCalls.length, 4, 'Should type 4 digits');
		assert.strictEqual(typeCalls[0].text, '1');
		assert.strictEqual(typeCalls[1].text, '2');
		assert.strictEqual(typeCalls[2].text, '3');
		assert.strictEqual(typeCalls[3].text, '4');
	});

	await testAsync('fillCode split-digit: returns error if mid-digit fails', async () => {
		resetMocks();
		let callCount = 0;
		helperResponses.type_text = () => {
			callCount++;
			if (callCount === 3) return { ok: false, result: 'keystroke failed' };
			return { ok: true, result: 'typed' };
		};
		const result = await fillCode('123456', { type: 'split-digit', fieldQuery: 'digit 1' });
		assert.strictEqual(result.ok, false);
		assert.match(result.error, /digit 3/i);
	});

	await testAsync('verifyFill returns verified: true when no error text', async () => {
		resetMocks();
		const result = await verifyFill();
		assert.strictEqual(result.verified, true);
	});

	await testAsync('verifyFill detects error keywords', async () => {
		resetMocks();
		helperResponses.ax_snapshot = {
			ok: true,
			result: JSON.stringify([
				{ title: 'Invalid code', value: '', role: 'AXStaticText' },
			]),
		};
		const result = await verifyFill();
		assert.strictEqual(result.verified, false);
		assert.strictEqual(result.reason, 'error-detected');
	});

	await testAsync('verifyFill handles snapshot failure', async () => {
		resetMocks();
		helperResponses.ax_snapshot = { ok: false, result: '' };
		const result = await verifyFill();
		assert.strictEqual(result.verified, false);
		assert.strictEqual(result.reason, 'snapshot-failed');
	});

	console.log('\nAll fill tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
