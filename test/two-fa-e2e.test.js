// E2E Test for 2FA Vision-based detection and filling
const assert = require('node:assert');
const path = require('node:path');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

async function testAsync(name, fn) {
	try { await fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

// ---- Mocking infrastructure ----

// 1. Mock screen-capture
let mockCaptureResult = { ok: true, data: 'fake-base64-jpeg' };
require.cache[require.resolve('../src/main/screen-capture')] = {
	exports: {
		capture: async () => mockCaptureResult,
		getMapping: () => ({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }),
	}
};

// 2. Mock logger
require.cache[require.resolve('../src/main/logger')] = {
	exports: { info() {}, warn() {}, error() {}, debug() {} },
};

// 3. Mock native-helper
let typedText = null;
require.cache[require.resolve('../src/main/native-helper')] = {
	exports: {
		runHelper: async (args) => {
			if (args.action === 'type_text') {
				typedText = args.text;
				return { ok: true };
			}
			return { ok: true };
		},
	}
};

// 4. Mock sources (gatherCodes)
let mockGatherResult = [];
require.cache[require.resolve('../src/main/two-fa/sources')] = {
	exports: {
		gatherCodes: async () => mockGatherResult,
	}
};

// 5. Mock shared/config
require.cache[require.resolve('../src/shared/config')] = {
	exports: {
		default: {
			gemini: {
				flashEndpoint: 'https://mock-gemini.api/v1/vision',
			}
		}
	}
};

// 6. Mock global fetch for Gemini API
let mockGeminiResponse = { detected: false };
global.fetch = async (url, options) => {
	return {
		ok: true,
		json: async () => ({
			candidates: [{
				content: {
					parts: [{ text: JSON.stringify(mockGeminiResponse) }]
				}
			}]
		})
	};
};

// Now we can load the orchestrator and detector
const { TwoFAOrchestrator } = require('../src/main/two-fa/orchestrator');

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
	mockCaptureResult = { ok: true, data: 'fake-base64-jpeg' };
	mockGatherResult = [];
	mockGeminiResponse = { detected: false };
	typedText = null;
	process.env.GEMINI_API_KEY = 'mock-key';
}

// ---- E2E Scenarios ----

async function runE2ETests() {
	console.log('Running 2FA Vision E2E Scenarios...');

	await testAsync('Vision detection + Cached code = Successful fill', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({
			eventBus: bus,
			behaviorEngine: makeBehaviorEngine(),
			settings: { confidenceThreshold: 0.7 }
		});

		// 1. Mock Gemini to detect a field in Chrome
		mockGeminiResponse = {
			detected: true,
			app: 'Chrome',
			context: 'Google Verification'
		};

		// 2. Mock a code arriving (e.g. from SMS/cache)
		mockGatherResult = [
			{ code: '998877', source: 'messages', timestamp: Date.now(), confidence: 0.9 }
		];

		// 3. Run tick
		await o._tick();

		// 4. Verify detection event
		const detected = bus.events.find(e => e.type === 'TWO_FA_FIELD_DETECTED');
		assert.ok(detected, 'Should emit TWO_FA_FIELD_DETECTED');
		assert.strictEqual(detected.payload.appName, 'Chrome');

		// 5. Verify fill started
		const fillStart = bus.events.find(e => e.type === 'TWO_FA_FILL_START');
		assert.ok(fillStart, 'Should emit TWO_FA_FILL_START');
		assert.strictEqual(fillStart.payload.codeLength, 6);

		// 6. Verify native-helper received the code
		assert.strictEqual(typedText, '998877', 'Should have typed the correct code');

		// 7. Verify success event
		const success = bus.events.find(e => e.type === 'TWO_FA_FILL_SUCCESS');
		assert.ok(success, 'Should emit TWO_FA_FILL_SUCCESS');
	});

	await testAsync('Vision detection + No code = No fill', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });

		mockGeminiResponse = { detected: true, app: 'Safari', context: 'Apple ID' };
		mockGatherResult = [];

		await o._tick();

		assert.ok(bus.events.find(e => e.type === 'TWO_FA_FIELD_DETECTED'), 'Should still detect field');
		assert.ok(bus.events.find(e => e.type === 'TWO_FA_NO_CODE'), 'Should emit TWO_FA_NO_CODE');
		assert.strictEqual(typedText, null, 'Should not have typed anything');
	});

	await testAsync('No vision detection = No action', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({ eventBus: bus, behaviorEngine: makeBehaviorEngine() });

		mockGeminiResponse = { detected: false };
		mockGatherResult = [{ code: '123456', source: 'messages', timestamp: Date.now() }];

		await o._tick();

		assert.strictEqual(bus.events.length, 0, 'Should not emit any events');
		assert.strictEqual(typedText, null, 'Should not type anything');
	});

	await testAsync('Low confidence detection (Vision) prevents fill', async () => {
		resetMocks();
		const bus = makeEventBus();
		// Set high threshold
		const o = new TwoFAOrchestrator({
			eventBus: bus,
			behaviorEngine: makeBehaviorEngine(),
			settings: { confidenceThreshold: 0.99 }
		});

		mockGeminiResponse = { detected: true, app: 'Chrome', context: 'Bank' };
		// Code is a bit old (lowers confidence)
		mockGatherResult = [
			{ code: '000111', source: 'notifications', timestamp: Date.now() - 200000, confidence: 0.8 }
		];

		await o._tick();

		assert.ok(bus.events.find(e => e.type === 'TWO_FA_FIELD_DETECTED'));
		assert.ok(bus.events.find(e => e.type === 'TWO_FA_LOW_CONFIDENCE'), 'Should emit TWO_FA_LOW_CONFIDENCE');
		assert.strictEqual(typedText, null);
	});

	await testAsync('Vision detection + Multiple codes = Best code (highest confidence) picked', async () => {
		resetMocks();
		const bus = makeEventBus();
		const o = new TwoFAOrchestrator({
			eventBus: bus,
			behaviorEngine: makeBehaviorEngine(),
			settings: { confidenceThreshold: 0.7 }
		});

		mockGeminiResponse = { detected: true, app: 'Chrome', context: 'Bank Login' };

		// Mock two codes: one from cache (0.9) and one from keychain (1.0)
		// Keychain should be picked even if it arrived later or earlier.
		mockGatherResult = [
			{ code: 'KEY123', source: 'keychain-totp', timestamp: Date.now(), confidence: 1.0 }
		];
		// Pretend we have something older in cache
		o._codeCache.add({ code: 'OLD999', source: 'messages', timestamp: Date.now() - 5000, confidence: 0.9 });

		await o._tick();

		assert.strictEqual(typedText, 'KEY123', 'Should have picked the higher confidence Keychain code');
	});

	console.log('\nAll 2FA Vision E2E tests passed!');
}

runE2ETests().catch(err => {
	console.error('Test runner failed:', err);
	process.exit(1);
});
