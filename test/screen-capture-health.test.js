const assert = require('node:assert');

const {
	MAX_CAPTURE_AGE_MS,
	isCaptureUsable,
	formatCaptureBlockReason,
} = require('../src/main/screen-capture-health');

console.log('Running screen capture health tests...');

const now = 1_000_000;

assert.strictEqual(
	isCaptureUsable({ lastCaptureAt: now - 1000, lastError: null }, now),
	true,
	'recent successful captures should be usable'
);

assert.strictEqual(
	isCaptureUsable({ lastCaptureAt: now - (MAX_CAPTURE_AGE_MS + 1), lastError: null }, now),
	false,
	'stale captures should be rejected'
);

assert.strictEqual(
	isCaptureUsable({ lastCaptureAt: now - 7000, lastError: null }, now, 30000),
	true,
	'explicit fallback windows should allow moderately stale captures'
);

assert.strictEqual(
	isCaptureUsable({ lastCaptureAt: now - 1000, lastError: 'Screen capture unavailable' }, now),
	false,
	'capture errors should block pointer actions'
);

const reason = formatCaptureBlockReason('click', {
	lastCaptureAt: now - 7000,
	lastError: 'Screen capture unavailable. Screen Recording permission is denied.',
	permissionStatus: 'denied',
}, now);

assert.match(reason, /Cannot click without a fresh screen capture/, 'reason should mention missing fresh capture');
assert.match(reason, /Screen Recording permission: denied/, 'reason should include permission status');

console.log('Screen capture health tests passed.');
