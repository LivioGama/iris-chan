// TOTP generator from locally stored secrets (~/.iris/totp-secrets.json)
// Implements RFC 6238 using Node.js crypto (no external deps)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../../logger');

const SECRETS_PATH = path.join(os.homedir(), '.iris', 'totp-secrets.json');

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

function generateTOTP({ secret, algorithm = 'sha1', digits = 6, period = 30 }) {
	const key = base32Decode(secret);
	const epoch = Math.floor(Date.now() / 1000);
	const counter = Math.floor(epoch / period);
	const counterBuf = Buffer.alloc(8);
	counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	counterBuf.writeUInt32BE(counter >>> 0, 4);

	const hmac = crypto.createHmac(algorithm, key).update(counterBuf).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** digits);
	return String(code).padStart(digits, '0');
}

function loadSecrets() {
	try {
		if (!fs.existsSync(SECRETS_PATH)) return {};
		// Enforce restrictive permissions (owner-only read/write)
		const stat = fs.statSync(SECRETS_PATH);
		const mode = stat.mode & 0o777;
		if (mode & 0o077) {
			log.warn('LocalTOTP', `Fixing permissions on ${SECRETS_PATH} (was ${mode.toString(8)})`);
			fs.chmodSync(SECRETS_PATH, 0o600);
		}
		const parsed = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed;
	} catch (err) {
		log.warn('LocalTOTP', 'Failed to read secrets:', err.message);
		return {};
	}
}

function matchDomain(secrets, context) {
	const { appName = '', windowTitle = '', url = '' } = context;
	const haystack = `${appName} ${windowTitle} ${url}`.toLowerCase();
	for (const [domain, entry] of Object.entries(secrets)) {
		if (haystack.includes(domain.toLowerCase())) return { domain, ...entry };
	}
	return null;
}

const adapter = {
	name: 'local-totp',
	priority: 2,
	enabled() { return fs.existsSync(SECRETS_PATH); },
	async fetchCode(context) {
		const secrets = loadSecrets();
		const match = matchDomain(secrets, context);
		if (!match) return null;
		try {
			const code = generateTOTP(match);
			return { code, confidence: 0.95, timestamp: Date.now(), meta: { domain: match.domain } };
		} catch (err) {
			log.warn('LocalTOTP', `TOTP generation failed for ${match.domain}:`, err.message);
			return null;
		}
	},
};

module.exports = adapter;
