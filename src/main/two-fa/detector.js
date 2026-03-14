// AX-based 2FA field detection via iris-helper ax_snapshot
const { runHelper } = require('../native-helper');
const log = require('../logger');

const FIELD_PATTERNS = [
	/\b(?:verification|2fa|two.?factor|otp|one.?time|security)\s*(?:code|token|pin)?\b/i,
	/\b(?:enter|type|input)\s*(?:your\s+)?(?:code|pin|token)\b/i,
	/\b(?:6.?digit|4.?digit)\s*(?:code|pin)?\b/i,
	/\bconfirmation\s*code\b/i,
	/\bauth(?:entication|enticator)?\s*(?:code|token)\b/i,
	/\bpasscode\b/i,
	/\beinmalcode\b/i, // German
	/\bcodice di verifica\b/i, // Italian
];

const LOGIN_CONTEXT = /(?:2fa|verification|otp|one-time|security code|auth code|enter code|login|sign.?in|log.?in|verify|confirm)/i;

const TEXT_FIELD_ROLES = new Set(['AXTextField', 'AXSecureTextField']);

function textOf(el) {
	return [el.title, el.value, el.help, el.detail, el.label, el.description, el.placeholder].filter(Boolean).join(' ');
}

function matchesFieldPattern(text) {
	for (const pat of FIELD_PATTERNS) {
		if (pat.test(text)) return true;
	}
	return false;
}

// Detect clusters of single-char text fields (split-digit 2FA inputs)
function detectSplitDigitCluster(elements) {
	const textFields = elements.filter(el => TEXT_FIELD_ROLES.has(el.role));
	if (textFields.length < 4) return null;

	// Look for consecutive fields whose maxLength or size is 1
	for (let i = 0; i <= textFields.length - 4; i++) {
		const cluster = [];
		for (let j = i; j < textFields.length && cluster.length < 8; j++) {
			const el = textFields[j];
			const val = String(el.value || '');
			const maxLen = el.maxLength || el.numberOfCharacters;
			if (maxLen === 1 || (val.length <= 1 && !el.value)) {
				cluster.push(el);
			} else {
				break;
			}
		}
		if (cluster.length >= 4 && cluster.length <= 8) {
			// Check if nearby labels suggest 2FA
			const nearbyText = elements.map(textOf).join(' ');
			if (matchesFieldPattern(nearbyText) || LOGIN_CONTEXT.test(nearbyText)) {
				return { type: 'split-digit', count: cluster.length, firstField: cluster[0] };
			}
		}
	}
	return null;
}

async function detect2FAField() {
	const nil = { detected: false };
	try {
		const result = await runHelper({ action: 'ax_snapshot', limit: 80 });
		if (!result.ok || !result.result) return nil;

		const parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
		// ax_snapshot returns { appName, windowTitle, focused, elements } — unwrap
		const snapshot = Array.isArray(parsed) ? { appName: '', windowTitle: '', elements: parsed } : parsed;
		const elements = snapshot.elements || [];
		if (!elements.length) return nil;

		const appName = snapshot.appName || '';
		const windowTitle = snapshot.windowTitle || '';

		// Combine all text for context matching
		const allText = elements.map(textOf).join(' ');
		const textFields = elements.filter(el => TEXT_FIELD_ROLES.has(el.role));
		log.debug('2FA-Detector', `AX: app=${appName}, window=${windowTitle}, elements=${elements.length}, textFields=${textFields.length}`);

		// Strategy 1: Find focused text field matching 2FA patterns
		const focused = elements.find(el => el.focused && TEXT_FIELD_ROLES.has(el.role));
		if (focused) {
			const focusedText = textOf(focused);
			// Check nearby siblings too
			const siblingText = elements
				.filter(el => el !== focused && !TEXT_FIELD_ROLES.has(el.role))
				.map(textOf).join(' ');
			const combinedContext = `${focusedText} ${siblingText} ${windowTitle}`;

			if (matchesFieldPattern(combinedContext)) {
				const currentValue = String(focused.value || '');
				return {
					detected: true,
					type: 'single',
					fieldRole: focused.role,
					fieldContext: combinedContext.slice(0, 200),
					appName,
					windowTitle,
					confidence: matchesFieldPattern(focusedText) ? 0.95 : 0.8,
					focusedValue: currentValue,
					fieldQuery: focused.title || focused.label || focused.description || '',
				};
			}
		}

		// Strategy 2: Split-digit cluster
		const cluster = detectSplitDigitCluster(elements);
		if (cluster) {
			const currentValues = elements
				.filter(el => TEXT_FIELD_ROLES.has(el.role))
				.map(el => el.value || '')
				.join('');
			return {
				detected: true,
				type: 'split-digit',
				digitCount: cluster.count,
				fieldRole: 'AXTextField',
				fieldContext: allText.slice(0, 200),
				appName,
				windowTitle,
				confidence: 0.85,
				focusedValue: currentValues,
				fieldQuery: cluster.firstField.title || cluster.firstField.label || '',
			};
		}

		// Strategy 3: Unfocused field but strong context (window title has login keywords + field visible)
		if (LOGIN_CONTEXT.test(windowTitle)) {
			const anyTextField = elements.find(el => TEXT_FIELD_ROLES.has(el.role));
			if (anyTextField && matchesFieldPattern(allText)) {
				return {
					detected: true,
					type: 'single',
					fieldRole: anyTextField.role,
					fieldContext: allText.slice(0, 200),
					appName,
					windowTitle,
					confidence: 0.65, // lower confidence since field isn't focused
					focusedValue: String(anyTextField.value || ''),
					fieldQuery: anyTextField.title || anyTextField.label || '',
				};
			}
		}

		return nil;
	} catch (err) {
		log.warn('2FA-Detector', 'Detection failed:', err.message);
		return nil;
	}
}

module.exports = { detect2FAField, FIELD_PATTERNS, LOGIN_CONTEXT };
