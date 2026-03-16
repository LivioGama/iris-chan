// Composite confidence scoring for 2FA auto-fill decisions

const SOURCE_RELIABILITY = {
	'keychain-totp': 1.0,
	'onepassword': 1.0,
	'local-totp': 0.95,
	'messages': 0.9,
	'mail': 0.85,
	'notifications': 0.8,
};

// Detection method reliability — vision (Gemini) is high confidence
const DETECTION_RELIABILITY = {
	'vision': 0.95,
	'single': 0.9,
	'split-digit': 0.85,
	'web-form': 0.7,
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
	const detectionRel = DETECTION_RELIABILITY[fieldInfo.type] || 0.7;
	const fieldConf = fieldInfo.confidence || detectionRel;
	const sourceRel = SOURCE_RELIABILITY[codeResult.source] || 0.7;
	const recency = recencyScore(codeResult.timestamp, codeResult.source);

	return fieldConf * sourceRel * recency;
}

module.exports = { computeConfidence, SOURCE_RELIABILITY };
