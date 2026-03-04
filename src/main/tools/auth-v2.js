const legacyAuth = require('./auth');

function hasLikelyLoginContext(ctx = '') {
	const text = String(ctx).toLowerCase();
	return /(2fa|verification|otp|one-time|security code|auth code|enter code|login|sign in)/.test(text);
}

function shouldAutoFill({ confidence = 0, context = '' } = {}) {
	if (confidence < 0.92) return false;
	return hasLikelyLoginContext(context);
}

async function attemptAuto2FA({ confidence = 0, context = '', source = 'auto', max_age_seconds = 300 }) {
	if (!shouldAutoFill({ confidence, context })) {
		return { ok: false, result: 'Confidence/context threshold not met for auto-fill.' };
	}
	return legacyAuth.auto_2fa({
		source,
		auto_type: true,
		max_age_seconds,
	});
}

module.exports = { shouldAutoFill, attemptAuto2FA };
