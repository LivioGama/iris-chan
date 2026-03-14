// Composite confidence scoring for 2FA auto-fill decisions
const { LOGIN_CONTEXT } = require('./detector');

const SOURCE_RELIABILITY = {
	'keychain-totp': 1.0,
	'onepassword': 1.0,
	'local-totp': 0.95,
	'messages': 0.9,
	'mail': 0.85,
	'notifications': 0.8,
};

// TOTP sources generate fresh codes, so recency is always maximal
const TOTP_SOURCES = new Set(['keychain-totp', 'onepassword', 'local-totp']);

function recencyScore(timestamp, source) {
	if (TOTP_SOURCES.has(source)) return 1.0;
	const ageMs = Date.now() - timestamp;
	if (ageMs < 30_000) return 1.0;
	if (ageMs < 60_000) return 0.9;
	if (ageMs < 120_000) return 0.8;
	if (ageMs < 300_000) return 0.7;
	return 0.5;
}

function computeConfidence(fieldInfo, codeResult) {
	const fieldConf = fieldInfo.confidence || 0.5;
	const sourceRel = SOURCE_RELIABILITY[codeResult.source] || 0.7;
	const recency = recencyScore(codeResult.timestamp, codeResult.source);
	const contextText = `${fieldInfo.windowTitle || ''} ${fieldInfo.fieldContext || ''}`;
	const contextMul = LOGIN_CONTEXT.test(contextText) ? 1.0 : 0.85;

	return fieldConf * sourceRel * recency * contextMul;
}

module.exports = { computeConfidence, SOURCE_RELIABILITY };
