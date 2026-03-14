// Source adapter: 1Password CLI (`op item get --otp`)
const { execFile } = require('child_process');
const log = require('../../logger');

let opAvailable = null;

function checkOpAvailable() {
	return new Promise((resolve) => {
		execFile('which', ['op'], { timeout: 3000 }, (err) => resolve(!err));
	});
}

function extractDomain(context) {
	const { url = '', windowTitle = '', appName = '' } = context;
	// Try URL first
	try {
		if (url) return new URL(url).hostname.replace(/^www\./, '');
	} catch { /* ignore */ }
	// Try extracting domain-like string from window title
	const domainMatch = windowTitle.match(/(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z]{2,})+)/i);
	if (domainMatch) return domainMatch[1].replace(/^www\./, '');
	// Fallback: use app name as search term
	return appName || '';
}

// Validate domain to prevent unexpected arguments to op CLI
function isValidDomain(domain) {
	return /^[a-z0-9._-]+$/i.test(domain) && domain.length <= 253;
}

function runOp(domain, timeout = 5000) {
	return new Promise((resolve) => {
		if (!isValidDomain(domain)) return resolve(null);
		// Use execFile to avoid shell interpretation (no injection risk)
		execFile('op', ['item', 'get', domain, '--otp'], { timeout }, (err, stdout) => {
			if (err || !stdout.trim()) return resolve(null);
			const code = stdout.trim();
			if (/^\d{4,8}$/.test(code)) return resolve(code);
			resolve(null);
		});
	});
}

const adapter = {
	name: 'onepassword',
	priority: 1,
	enabled() {
		if (opAvailable === null) {
			checkOpAvailable().then(v => { opAvailable = v; }).catch(() => { opAvailable = false; });
			return false; // first call: assume unavailable, will be ready next tick
		}
		return opAvailable;
	},
	async fetchCode(context) {
		if (opAvailable === null) opAvailable = await checkOpAvailable();
		if (!opAvailable) return null;
		const domain = extractDomain(context);
		if (!domain) return null;
		try {
			const code = await runOp(domain);
			if (!code) return null;
			return { code, confidence: 1.0, timestamp: Date.now(), meta: { domain } };
		} catch (err) {
			log.warn('1Password', `OTP fetch failed for ${domain}:`, err.message);
			return null;
		}
	},
};

module.exports = adapter;
