const FRENCH_ENGLISH_REMAP = {
	'ze': 'the',
	'zis': 'this',
	'wiz': 'with',
	'tou': 'to',
	'de': 'the',
};

const FILLER_PATTERNS = [
	/^\s*(uh+|um+|hmm+|mm+)\s*$/i,
	/^\s*(thanks|thank you|okay|ok)\s*$/i,
];

export function cleanTranscript(text, corrections = {}, hints = {}) {
	if (!text) return '';
	let out = String(text);

	if (hints?.language === 'fr-en') {
		out = out.replace(/\bconnexion\b/gi, 'connection');
		out = out.replace(/\bvérification\b/gi, 'verification');
		out = out.replace(/\bmot de passe\b/gi, 'password');
	}

	for (const [wrong, right] of Object.entries(corrections || {})) {
		const re = new RegExp(`\\b${escapeRegExp(wrong)}\\b`, 'gi');
		out = out.replace(re, right);
	}
	for (const [wrong, right] of Object.entries(FRENCH_ENGLISH_REMAP)) {
		const re = new RegExp(`\\b${wrong}\\b`, 'gi');
		out = out.replace(re, right);
	}
	out = out.replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim();
	if (FILLER_PATTERNS.some((re) => re.test(out))) return '';
	return out;
}

export const IDLE_NOISE_PATTERN = /(i'?m here|silence is correct behavior|go ahead i'?m ready|standing by|waiting for your instructions)/i;

export function shouldDropTranscript(text) {
	if (!text) return true;
	if (text.length <= 1) return true;
	return IDLE_NOISE_PATTERN.test(text);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
