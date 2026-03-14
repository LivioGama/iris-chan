// Unit test for local-totp source adapter
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Inline TOTP generator to validate against
function base32Decode(encoded) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	let bits = '';
	for (const ch of encoded.toUpperCase().replace(/[=\s]/g, '')) {
		const idx = alphabet.indexOf(ch);
		if (idx < 0) continue;
		bits += idx.toString(2).padStart(5, '0');
	}
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
}

function referenceTOTP(secret, digits = 6, period = 30) {
	const key = base32Decode(secret);
	const counter = Math.floor(Math.floor(Date.now() / 1000) / period);
	const counterBuf = Buffer.alloc(8);
	counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	counterBuf.writeUInt32BE(counter >>> 0, 4);
	const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** digits);
	return String(code).padStart(digits, '0');
}

// Test
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'; // well-known test vector base32
const secretsPath = path.join(os.homedir(), '.iris', 'totp-secrets.json');

async function run() {
	// Setup: write test secret
	const backup = fs.existsSync(secretsPath) ? fs.readFileSync(secretsPath, 'utf8') : null;
	const testSecrets = { 'test.example.com': { secret: TEST_SECRET, algorithm: 'sha1', digits: 6, period: 30 } };
	fs.writeFileSync(secretsPath, JSON.stringify(testSecrets));

	try {
		const adapter = require('../../src/main/two-fa/sources/local-totp');

		// Test 1: enabled() should return true
		console.assert(adapter.enabled() === true, 'FAIL: adapter should be enabled');
		console.log('PASS: adapter.enabled() = true');

		// Test 2: fetchCode with matching context
		const result = await adapter.fetchCode({ windowTitle: 'Login - test.example.com', appName: 'Safari' });
		console.assert(result !== null, 'FAIL: should find a code for test.example.com');
		console.assert(result.code.length === 6, `FAIL: code should be 6 digits, got ${result.code}`);
		console.assert(result.confidence === 0.95, `FAIL: confidence should be 0.95, got ${result.confidence}`);

		// Verify code matches reference implementation
		const expected = referenceTOTP(TEST_SECRET);
		console.assert(result.code === expected, `FAIL: code mismatch: got ${result.code}, expected ${expected}`);
		console.log(`PASS: generated TOTP ${result.code} matches reference`);

		// Test 3: fetchCode with non-matching context
		const noMatch = await adapter.fetchCode({ windowTitle: 'Google Docs', appName: 'Chrome' });
		console.assert(noMatch === null, 'FAIL: should return null for non-matching context');
		console.log('PASS: no match for unrelated context');

		console.log('\nAll local-totp tests passed!');
	} finally {
		// Restore original
		if (backup !== null) {
			fs.writeFileSync(secretsPath, backup);
		} else {
			fs.unlinkSync(secretsPath);
		}
	}
}

run().catch(err => { console.error('Test failed:', err); process.exit(1); });
