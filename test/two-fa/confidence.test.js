// Unit test for confidence scoring
// Clear any cached mock from other test files (e.g. orchestrator.test.js)
delete require.cache[require.resolve('../../src/main/two-fa/confidence')];
const { computeConfidence } = require('../../src/main/two-fa/confidence');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

function assertRange(val, min, max, msg) {
	if (val < min || val > max) throw new Error(`${msg}: ${val} not in [${min}, ${max}]`);
}

// High-confidence scenario: focused 2FA field + TOTP source + login context
test('high confidence: TOTP + focused field + login context', () => {
	const score = computeConfidence(
		{ confidence: 0.95, windowTitle: 'Sign in - GitHub', fieldContext: 'Enter verification code' },
		{ source: 'local-totp', confidence: 0.95, timestamp: Date.now() }
	);
	assertRange(score, 0.85, 1.0, 'Expected high score');
});

// Medium confidence: messages source, older code
test('medium confidence: messages + older code', () => {
	const score = computeConfidence(
		{ confidence: 0.8, windowTitle: 'Login', fieldContext: 'Enter code' },
		{ source: 'messages', confidence: 0.9, timestamp: Date.now() - 120_000 }
	);
	assertRange(score, 0.5, 0.85, 'Expected medium score');
});

// Low confidence: notifications + no login context
test('low confidence: notifications + no login context', () => {
	const score = computeConfidence(
		{ confidence: 0.65, windowTitle: 'Some App', fieldContext: 'enter number' },
		{ source: 'notifications', confidence: 0.8, timestamp: Date.now() - 200_000 }
	);
	assertRange(score, 0.2, 0.7, 'Expected low score');
});

// Keychain source always gets full reliability
test('keychain source gets 1.0 reliability', () => {
	const score = computeConfidence(
		{ confidence: 0.95, windowTitle: 'Sign in', fieldContext: 'verification code' },
		{ source: 'keychain-totp', confidence: 1.0, timestamp: Date.now() }
	);
	assertRange(score, 0.9, 1.0, 'Expected near-perfect score');
});

console.log('\nAll confidence tests passed!');
