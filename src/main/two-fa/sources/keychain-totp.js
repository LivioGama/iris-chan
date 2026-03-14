// Source adapter: macOS Passwords / iCloud Keychain TOTP
// Reads autofill suggestions from the AX tree (e.g., "From Passwords: 123456")
const { runHelper } = require('../../native-helper');
const log = require('../../logger');

const PASSWORDS_PATTERN = /(?:from\s+passwords|keychain|icloud)[:\s]*(\d{4,8})/i;
const AUTOFILL_CODE_PATTERN = /\b(\d{6})\b/;

async function scanAXForPasswordsSuggestion() {
	try {
		const result = await runHelper({ action: 'ax_snapshot', limit: 60 });
		if (!result.ok || !result.result) return null;

		const elements = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
		if (!Array.isArray(elements)) return null;

		for (const el of elements) {
			const text = [el.title, el.value, el.help, el.detail, el.label].filter(Boolean).join(' ');
			// Look for macOS Passwords autofill suggestion
			const pwMatch = text.match(PASSWORDS_PATTERN);
			if (pwMatch) return pwMatch[1];
		}
		// Also check for AutoFill suggestion groups (macOS shows these as AXGroup with static text)
		for (const el of elements) {
			if (el.role === 'AXGroup' || el.role === 'AXMenu') {
				const text = [el.title, el.value, el.help, el.label].filter(Boolean).join(' ');
				if (/password|autofill|keychain/i.test(text)) {
					const codeMatch = text.match(AUTOFILL_CODE_PATTERN);
					if (codeMatch) return codeMatch[1];
				}
			}
		}
		return null;
	} catch (err) {
		log.warn('KeychainTOTP', 'AX scan failed:', err.message);
		return null;
	}
}

const adapter = {
	name: 'keychain-totp',
	priority: 0,
	enabled() { return process.platform === 'darwin'; },
	async fetchCode() {
		const code = await scanAXForPasswordsSuggestion();
		if (!code) return null;
		return { code, confidence: 1.0, timestamp: Date.now(), meta: { source: 'icloud-keychain' } };
	},
};

module.exports = adapter;
