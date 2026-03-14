// Unit test for detector field patterns
const { FIELD_PATTERNS, LOGIN_CONTEXT } = require('../../src/main/two-fa/detector');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

function matchesAny(text) {
	return FIELD_PATTERNS.some(p => p.test(text));
}

// Should match
test('matches "Enter verification code"', () => { if (!matchesAny('Enter verification code')) throw new Error('no match'); });
test('matches "2FA code"', () => { if (!matchesAny('2FA code')) throw new Error('no match'); });
test('matches "Enter your OTP"', () => { if (!matchesAny('Enter your OTP')) throw new Error('no match'); });
test('matches "6-digit code"', () => { if (!matchesAny('6-digit code')) throw new Error('no match'); });
test('matches "Security code"', () => { if (!matchesAny('Security code')) throw new Error('no match'); });
test('matches "Authentication code"', () => { if (!matchesAny('Authentication code')) throw new Error('no match'); });
test('matches "Confirmation code"', () => { if (!matchesAny('Confirmation code')) throw new Error('no match'); });
test('matches "One-time code"', () => { if (!matchesAny('One-time code')) throw new Error('no match'); });
test('matches "Passcode"', () => { if (!matchesAny('Passcode')) throw new Error('no match'); });
test('matches "Enter code"', () => { if (!matchesAny('Enter code')) throw new Error('no match'); });
test('matches "Type your pin"', () => { if (!matchesAny('Type your pin')) throw new Error('no match'); });

// Should NOT match
test('rejects "Enter your name"', () => { if (matchesAny('Enter your name')) throw new Error('false match'); });
test('rejects "Search"', () => { if (matchesAny('Search')) throw new Error('false match'); });
test('rejects "Email address"', () => { if (matchesAny('Email address')) throw new Error('false match'); });

// Login context
test('LOGIN_CONTEXT matches "Sign in"', () => { if (!LOGIN_CONTEXT.test('Sign in')) throw new Error('no match'); });
test('LOGIN_CONTEXT matches "verification"', () => { if (!LOGIN_CONTEXT.test('verification')) throw new Error('no match'); });
test('LOGIN_CONTEXT rejects "dashboard"', () => { if (LOGIN_CONTEXT.test('dashboard')) throw new Error('false match'); });

console.log('\nAll detector pattern tests passed!');
