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
let mockFillResult = { ok: true, method: 'type_text' };
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

// Mock auth (extractOTP)
require.cache[require.resolve('../../src/main/tools/auth')] = {
	id: require.resolve('../../src/main/tools/auth'),
	filename: require.resolve('../../src/main/tools/auth'),
	loaded: true,
	exports: {
		extractOTP: (text) => { const m = text.match(/\b(\d{3,8})\b/); return m ? m[1] : null; },
		readMessages: async () => [], readMail: async () => [], readNotifications: async () => [],
		auto_2fa: async () => ({ ok: false }),
	},
};

// Mock notification monitor (prevent spawning real helper process)
require.cache[require.resolve('../../src/main/two-fa/notification-monitor')] = {
	id: require.resolve('../../src/main/two-fa/notification-monitor'),
	filename: require.resolve('../../src/main/two-fa/notification-monitor'),
	loaded: true,
	exports: {
		NotificationMonitor: class {
			constructor() {}
			async start() {}
			stop() {}
		},
	},
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
	mockFillResult = { ok: true, method: 'type_text' };
	mockVerifyResult = { verified: true };
}

// ---- Tests ----

test('constructor sets defaults', () => {
	const o = new TwoFAOrchestrator({ eventBus: makeEventBus(), behaviorEngine: makeBehaviorEngine() });
	const status = o.getStatus();
	assert.strictEqual(status.enabled, true);
	assert.strictEqual(status.running, false);
	assert.strictEqual(status.filling, false);
	assert.strictEqual(status.pollIntervalMs, 5000);
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
		mockFillResult = { ok: true, method: 'type_text' };
		mockVerifyResult = { verified: true };
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();
		const success = bus.events.find(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.ok(success, 'Expected TWO_FA_FILL_SUCCESS event');
		assert.strictEqual(success.payload.method, 'type_text');
	});

	await testAsync('_tick emits TWO_FA_FILL_FAILED on fill error', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'verification code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [{ code: '111111', confidence: 1.0, timestamp: Date.now(), source: 'messages' }];
		mockConfidenceResult = 0.92;
		mockFillResult = { ok: false, error: 'type_text failed' };
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

	// ---- Notification callback tests ----

	await testAsync('notification callback ignores when no active field', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		// No _tick called, so _lastFieldInfo is null
		await o._onNotificationReceived({ type: 'notification', texts: ['Your code is 123456'], timestamp: Date.now() });
		assert.strictEqual(bus.events.length, 0, 'Should not emit when no field active');
	});

	await testAsync('notification callback extracts OTP and fills when field is active', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Arc', windowTitle: 'Confirm - Facebook',
			confidence: 0.95, fieldContext: 'Enter code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = []; // no codes from poll sources
		mockConfidenceResult = 0.9;
		mockFillResult = { ok: true, method: 'type_text' };
		mockVerifyResult = { verified: true };

		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		// First tick detects field but no code
		await o._tick();
		assert.ok(bus.events.find(e => e.type === 'TWO_FA_NO_CODE'), 'Should emit NO_CODE from tick');

		// Now notification arrives with code
		bus.events.length = 0;
		await o._onNotificationReceived({ type: 'notification', texts: ['148966 is your Facebook code'], timestamp: Date.now() });
		const success = bus.events.find(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.ok(success, 'Expected TWO_FA_FILL_SUCCESS from notification');
		assert.strictEqual(success.payload.source, 'notifications');
	});

	await testAsync('notification callback respects cooldown/dedup', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Safari', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'verification code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [];
		mockConfidenceResult = 0.9;
		mockFillResult = { ok: true, method: 'type_text' };
		mockVerifyResult = { verified: true };

		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick(); // detect field, no code

		// First notification fills
		await o._onNotificationReceived({ type: 'notification', texts: ['Code: 999888'], timestamp: Date.now() });
		assert.ok(bus.events.find(e => e.type === 'TWO_FA_FILL_SUCCESS'), 'First fill should succeed');

		// After fill, the page typically moves on — field is no longer visible
		mockDetectResult = { detected: false };

		// Second notification should not fill (field gone after successful fill)
		bus.events.length = 0;
		await o._onNotificationReceived({ type: 'notification', texts: ['Code: 777666'], timestamp: Date.now() });
		assert.strictEqual(bus.events.filter(e => e.type === 'TWO_FA_FILL_SUCCESS').length, 0, 'Should not fill again');
	});

	await testAsync('notification callback ignores text without OTP', async () => {
		resetMocks();
		mockDetectResult = {
			detected: true, type: 'single', appName: 'Arc', windowTitle: 'Login',
			confidence: 0.95, fieldContext: 'Enter code', focusedValue: '', fieldQuery: 'code',
		};
		mockGatherResult = [];
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });
		await o._tick();

		bus.events.length = 0;
		await o._onNotificationReceived({ type: 'notification', texts: ['New message from John'], timestamp: Date.now() });
		assert.strictEqual(bus.events.filter(e => e.type === 'TWO_FA_FILL_START').length, 0, 'Should not attempt fill without OTP');
	});

	console.log('\nAll orchestrator tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
