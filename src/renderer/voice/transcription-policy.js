const FRENCH_ENGLISH_REMAP = {
	'ze': 'the',
	'zis': 'this',
	'wiz': 'with',
	'tou': 'to',
	'de': 'the',
};

// Common French phrases the user mixes into English conversation
// These are kept as-is (not translated) so Gemini can interpret them in context
const FRENCH_PHRASE_NORMALIZATIONS = {
	'ah ton je vay tuh shahn zhay': 'attends je vais te changer',
	'ah ton juh vay tuh shahn zhay': 'attends je vais te changer',
	'a ton je ve te shon jay': 'attends je vais te changer',
	'a ton juh veh tuh modify yay': 'attends je vais te modifier',
	'juh veh tuh modify yay': 'je vais te modifier',
	'juh vay tuh shahn zhay': 'je vais te changer',
};

const MULTILINGUAL_PHRASE_NORMALIZATIONS = {
	'डू यू सी माय स्क्रीन': 'do you see my screen',
	'एनसी में एक रेंट स्क्रीन': 'can you see my current screen',
	'change your voice to bloom but warm': 'switch to bloom voice preset and make it warmer',
	'change your voice to bloom and warm': 'switch to bloom voice preset and make it warmer',
	'चेंज योर वॉइस टू ब्लूम बट वार्म': 'switch to bloom voice preset and make it warmer',
	'चेंज योर वॉइस टू ब्लूम एंड वार्म': 'switch to bloom voice preset and make it warmer',
	'चेंज योर वॉयस टू ब्लूम बट वार्म': 'switch to bloom voice preset and make it warmer',
	'चेंज योर वॉयस टू ब्लूम एंड वार्म': 'switch to bloom voice preset and make it warmer',
};

const FILLER_PATTERNS = [
	/^\s*(uh+|um+|hmm+|mm+)\s*$/i,
	/^\s*(thanks|thank you|okay|ok)\s*$/i,
];

const INTERNAL_TRANSCRIPT_PATTERNS = [
	/^\s*\[(?:CLAUDE CODE|SCREENSHOT|SYSTEM:)/i,
	/^\s*\[[^\]]*progress update:/i,
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
	// Normalize French phrase fragments before word-level remapping
	for (const [wrong, right] of Object.entries(FRENCH_PHRASE_NORMALIZATIONS)) {
		const re = new RegExp(escapeRegExp(wrong), 'gi');
		out = out.replace(re, right);
	}
	for (const [wrong, right] of Object.entries(MULTILINGUAL_PHRASE_NORMALIZATIONS)) {
		const re = new RegExp(escapeRegExp(wrong), 'gi');
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

export const IDLE_NOISE_PATTERN = /(i'?m here|i'?m listening|silence is correct behavior|go ahead i'?m ready|standing by|waiting for your instructions)/i;

export function shouldDropTranscript(text) {
	if (!text) return true;
	if (text.length <= 1) return true;
	if (INTERNAL_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text))) return true;
	return IDLE_NOISE_PATTERN.test(text);
}

// --- Path-aware STT corrections ---
// Gemini STT mangles Unix paths: "/tmp/iris-test-output.txt" becomes
// "temp iris test output TXT" or "slash temp slash iris dash test dash output dot TXT".
// This pass detects mangled path fragments and reconstructs plausible Unix paths.

const PATH_DIR_ALIASES = {
	'temp': '/tmp',
	'slash temp': '/tmp',
	'slash T M P': '/tmp',
	'forward slash temp': '/tmp',
	'tilde': '~',
	'home': '~',
	'desktop': '~/Desktop',
	'downloads': '~/Downloads',
	'documents': '~/Documents',
};

const PATH_EXT_ALIASES = {
	'dot T X T': '.txt',
	'dot txt': '.txt',
	'dot text': '.txt',
	'dot T-X-T': '.txt',
	'dot JSON': '.json',
	'dot J S O N': '.json',
	'dot json': '.json',
	'dot J S': '.js',
	'dot js': '.js',
	'dot M D': '.md',
	'dot md': '.md',
	'dot P Y': '.py',
	'dot py': '.py',
	'dot T S': '.ts',
	'dot ts': '.ts',
	'dot C S V': '.csv',
	'dot csv': '.csv',
	'dot log': '.log',
	'dot L O G': '.log',
	'dot Y A M L': '.yaml',
	'dot yaml': '.yaml',
	'dot yml': '.yml',
};

// Build a single regex that matches: <dir alias> <words…> <ext alias>
const _dirKeys = Object.keys(PATH_DIR_ALIASES).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
const _extKeys = Object.keys(PATH_EXT_ALIASES).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
const _pathRe = new RegExp(`(?:${_dirKeys})\\s+([\\w](?:[\\w\\s]*[\\w])?)\\s+(?:${_extKeys})`, 'gi');

function _buildFilename(middle) {
	return middle
		.replace(/\s+dash\s+/gi, '-')
		.replace(/\s+underscore\s+/gi, '_')
		.replace(/\s+/g, '-')
		.toLowerCase();
}

/**
 * Detect mangled Unix paths in STT output and reconstruct them.
 * e.g. "temp iris test output dot txt" → "/tmp/iris-test-output.txt"
 */
export function repairMangledPaths(text) {
	if (!text) return text;
	// Skip if the text already contains real Unix paths
	if (/\/\w+\/\w+/.test(text)) return text;
	return text.replace(_pathRe, (match, middle, offset) => {
		// Find which dir alias matched (start of match)
		const matchStart = match.substring(0, match.indexOf(middle)).trim();
		const dir = PATH_DIR_ALIASES[Object.keys(PATH_DIR_ALIASES).find(
			k => matchStart.toLowerCase() === k.toLowerCase()
		) || ''] || '/tmp';
		// Find which ext alias matched (end of match)
		const afterMiddle = match.substring(match.indexOf(middle) + middle.length).trim();
		const ext = PATH_EXT_ALIASES[Object.keys(PATH_EXT_ALIASES).find(
			k => afterMiddle.toLowerCase() === k.toLowerCase()
		) || ''] || '.txt';
		return `${dir}/${_buildFilename(middle)}${ext}`;
	});
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
