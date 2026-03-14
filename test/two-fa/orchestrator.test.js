// Unit tests for TwoFAOrchestrator
const assert = require('node:assert');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

async function testAsync(name, fn) {
	try { await fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

// ---- Mocking infrastructure ----

// Mock detector
let mockDetectResult = { detected: false };
require.cache[require.resolve('../../src/main/two-fa/detector')] = {
	id: require.resolve('../../src/main/two-fa/detector'),
	filename: require.resolve('../../src/main/two-fa/detector'),
	loaded: true,
	exports: {
		detect2FAField: async () => mockDetectResult,
		FIELD_PATTERNS: [],
		LOGIN_CONTEXT: /login/i,
	},
};

// Mock sources
let mockGatherResult = [];
require.cache[require.resolve('../../src/main/two-fa/sources')] = {
	id: require.resolve('../../src/main/two-fa/sources'),
	filename: require.resolve('../../src/main/two-fa/sources'),
	loaded: true,
	exports: {
		gatherCodes: async () => mockGatherResult,
	},
};

// Mock confidence
let mockConfidenceResult = 0.9;
require.cache[require.resolve('../../src/main/two-fa/confidence')] = {
	id: require.resolve('../../src/main/two-fa/confidence'),
	filename: require.resolve('../../src/main/two-fa/confidence'),
	loaded: true,
	exports: {
		computeConfidence: () => mockConfidenceResult,
	},
};

// Mock fill
let mockFillResult = { ok: true, method: 'ax_set_value' };
let mockVerifyResult = { verified: true };
require.cache[require.resolve('../../src/main/two-fa/fill')] = {
	id: require.resolve('../../src/main/two-fa/fill'),
	filename: require.resolve('../../src/main/two-fa/fill'),
	loaded: true,
	exports: {
		fillCode: async () => mockFillResult,
		verifyFill: async () => mockVerifyResult,
	},
};

// Mock logger
require.cache[require.resolve('../../src/main/logger')] = {
	id: require.resolve('../../src/main/logger'),
	filename: require.resolve('../../src/main/logger'),
	loaded: true,
	exports: { info() {}, warn() {}, error() {}, debug() {} },
};

const { TwoFAOrchestrator } = require('../../src/main/two-fa/orchestrator');

// ---- Helpers ----
function makeEventBus() {
	const events = [];
	return {
		events,
		emitEvent(type, payload, source) { events.push({ type, payload, source }); },
	};
}

function makeBehaviorEngine(mode = 'normal') {
	return { getMode: () => mode };
}

function resetMocks() {
	mockDetectResult = { detected: false };
	mockGatherResult = [];
	mockConfidenceResult = 0.9;
	mockFillResult = { ok: true, method: 'ax_set_value' };
	mockVerifyResult = { verified: true };
}

// ---- Tests ----

test('constructor sets defaults', () => {
	const o = new TwoFAOrchestrator({ eventBus: makeEventBus(), behaviorEngine: makeBehaviorEngine() });
	const status = o.getStatus();
	assert.strictEqual(status.enabled, true);
	assert.strictEqual(status.running, false);
	assert.strictEqual(status.filling, false);
	assert.strictEqual(status.pollIntervalMs, 3000);
	assert.strictEqual(status.confidenceThreshold, 0.85);
});

test('constructor respects custom settings', () => {
	const o = new TwoFAOrchestrator({
		eventBus: makeEventBus(),
		behaviorEngine: makeBehaviorEngine(),
		settings: { pollIntervalMs: 5000, confidenceThreshold: 0.9, enabled: false },
	});
	const status = o.getStatus();
	assert.strictEqual(status.enabled, false);
	assert.strictEqual(status.pollIntervalMs, 5000);
	assert.strictEqual(status.confidenceThreshold, 0.9);
});

test('start() when disabled does not create timer', () => {
	const o = new TwoFAOrchestrator({
		eventBus: makeEventBus(),
		behaviorEngine: makeBehaviorEngine(),
		settings: { enabled: false },
	});
	o.start();
	assert.strictEqual(o.getStatus().running, false);
	o.stop();
});

test('start() when enabled creates timer', () => {
	const o = new TwoFAOrchestrator({
		eventBus: makeEventBus(),
		behaviorEngine: makeBehaviorEngine(),
		settings: { pollIntervalMs: 100000 },
	});
	o.start();
	assert.strictEqual(o.getStatus().running, true);
	o.stop();
	assert.strictEqual(o.getStatus().running, false);
});

test('getStatus() returns correct shape', () => {
	const o = new TwoFAOrchestrator({ eventBus: makeEventBus(), behaviorEngine: makeBehaviorEngine() });
	const status = o.getStatus();
	const keys = Object.keys(status).sort();
	assert.deepStrictEqual(keys, ['confidenceThreshold', 'enabled', 'filling', 'pollIntervalMs', 'recentFillCount', 'running'].sort());
});

test('updateSettings() enables and starts', () => {
	const o = new TwoFAOrchestrator({
		eventBus: makeEventBus(),
		behaviorEngine: makeBehaviorEngine(),
		settings: { enabled: false, pollIntervalMs: 100000 },
	});
	o.start(); // won't actually start since disabled
	assert.strictEqual(o.getStatus().running, false);
	o.updateSettings({ enabled: true });
	assert.strictEqual(o.getStatus().running, true);
	o.stop();
});

test('updateSettings() disables and stops', () => {
	const o = new TwoFAOrchestrator({
		eventBus: makeEventBus(),
		behaviorEngine: makeBehaviorEngine(),
		settings: { pollIntervalMs: 100000 },
	});
	o.start();
	assert.strictEqual(o.getStatus().running, true);
	o.updateSettings({ enabled: false });
	assert.strictEqual(o.getStatus().running, false);
});

async function runTests() {
	resetMocks();

	await testAsync('_tick skips when behavior mode is silent', async () => {
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine('silent') });
		await o._tick();
		assert.strictEqual(bus.events.length, 0);
	});

	await testAsync('_tick skips when no 2FA field detected', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		assert.strictEqual(bus.events.length, 0);
	});

	await testAsync('_tick emits TWO_FA_FIELD_DETECTED when field found', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'Enter verification code', focusedValue: '',
			fieldQuery: 'verification code',
		};
		mockGatherResult = [{ code: '123456', confidence: 0.95, timestamp: Date.now(), source: 'local-totp' }];
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const detected = bus.events.find(e => e.type === 'TWO_FA_FIELD_DETECTED');
		assert.ok(detected, 'Expected TWO_FA_FIELD_DETECTED event');
		assert.strictEqual(detected.payload.appName, 'Safari');
	});

	await testAsync('_tick emits TWO_FA_NO_CODE when no codes gathered', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Chrome', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [];
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const noCode = bus.events.find(e => e.type === 'TWO_FA_NO_CODE');
		assert.ok(noCode, 'Expected TWO_FA_NO_CODE event');
	});

	await testAsync('_tick emits TWO_FA_LOW_CONFIDENCE when below threshold', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.65, fieldContext: 'code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [{ code: '123456', confidence: 0.8, timestamp: Date.now(), source: 'notifications' }];
		mockConfidenceResult = 0.5;
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const low = bus.events.find(e => e.type === 'TWO_FA_LOW_CONFIDENCE');
		assert.ok(low, 'Expected TWO_FA_LOW_CONFIDENCE event');
	});

	await testAsync('_tick emits TWO_FA_FILL_SUCCESS on successful fill', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'verification code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [{ code: '654321', confidence: 1.0, timestamp: Date.now(), source: 'keychain-totp' }];
		mockConfidenceResult = 0.95;
		mockFillResult = { ok: true, method: 'ax_set_value' };
		mockVerifyResult = { verified: true };
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const success = bus.events.find(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.ok(success, 'Expected TWO_FA_FILL_SUCCESS event');
		assert.strictEqual(success.payload.method, 'ax_set_value');
	});

	await testAsync('_tick emits TWO_FA_FILL_FAILED on fill error', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'verification code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [{ code: '111111', confidence: 1.0, timestamp: Date.now(), source: 'messages' }];
		mockConfidenceResult = 0.92;
		mockFillResult = { ok: false, error: 'ax_set_value failed' };
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const failed = bus.events.find(e => e.type === 'TWO_FA_FILL_FAILED');
		assert.ok(failed, 'Expected TWO_FA_FILL_FAILED event');
	});

	await testAsync('_tick skips already-filled field (value.length >= 4)', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'code', focusedValue: '123456', fieldQuery: 'code',
		};
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		// Should emit FIELD_DETECTED but not attempt fill
		const fillStart = bus.events.find(e => e.type === 'TWO_FA_FILL_START');
		assert.strictEqual(fillStart, undefined, 'Should not attempt fill on already-filled field');
	});

	await testAsync('deduplication: same fingerprint within cooldown is skipped', async () => {
		resetMocks();
		const fieldInfo = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'verification code', focusedValue: '', fieldQuery: 'code',
		};
		mockDetectResult = fieldInfo;
		mockGatherResult = [{ code: '654321', confidence: 1.0, timestamp: Date.now(), source: 'local-totp' }];
		mockConfidenceResult = 0.95;

		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		// First tick fills successfully
		await o._tick();
		const firstSuccess = bus.events.filter(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.strictEqual(firstSuccess.length, 1);

		// Second tick should skip due to dedup
		bus.events.length = 0;
		mockDetectResult = fieldInfo;
		await o._tick();
		const secondSuccess = bus.events.filter(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.strictEqual(secondSuccess.length, 0, 'Should not fill same field again within cooldown');
	});

	console.log('\nAll orchestrator tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
