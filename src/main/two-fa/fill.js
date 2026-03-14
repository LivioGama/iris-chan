// Fill a detected 2FA field via accessibility or keyboard input
const { runHelper } = require('../native-helper');
const log = require('../logger');

async function fillSingleField(code, fieldInfo) {
	// Strategy 1: ax_set_value (clean, no keystroke side effects)
	if (fieldInfo.fieldQuery) {
		const setResult = await runHelper({ action: 'ax_set_value', value: code, query: fieldInfo.fieldQuery });
		if (setResult.ok) return { ok: true, method: 'ax_set_value' };
		log.debug('2FA-Fill', 'ax_set_value failed, falling back to type_text');
	}

	// Strategy 2: focus + type_text
	if (fieldInfo.fieldQuery) {
		await runHelper({ action: 'ax_focus', query: fieldInfo.fieldQuery });
		await sleep(100);
	}
	const typeResult = await runHelper({ action: 'type_text', text: code });
	return { ok: typeResult.ok, method: 'type_text', error: typeResult.ok ? undefined : typeResult.result };
}

async function fillSplitDigitField(code, fieldInfo) {
	// Focus the first digit field
	if (fieldInfo.fieldQuery) {
		await runHelper({ action: 'ax_focus', query: fieldInfo.fieldQuery });
		await sleep(100);
	}

	// Type each digit; most split-digit UIs auto-advance focus on input
	for (let i = 0; i < code.length; i++) {
		const typeResult = await runHelper({ action: 'type_text', text: code[i] });
		if (!typeResult.ok) {
			return { ok: false, method: 'split-digit', error: `Failed at digit ${i + 1}: ${typeResult.result}` };
		}
		await sleep(50);
	}
	return { ok: true, method: 'split-digit' };
}

async function fillCode(code, fieldInfo) {
	if (fieldInfo.type === 'split-digit') {
		return fillSplitDigitField(code, fieldInfo);
	}
	return fillSingleField(code, fieldInfo);
}

async function verifyFill() {
	await sleep(500);
	try {
		const result = await runHelper({ action: 'ax_snapshot', limit: 30 });
		if (!result.ok || !result.result) return { verified: false, reason: 'snapshot-failed' };

		const elements = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
		if (!Array.isArray(elements)) return { verified: false, reason: 'parse-failed' };

		// Check for error indicators
		const allText = elements.map(el =>
			[el.title, el.value, el.help, el.label].filter(Boolean).join(' ')
		).join(' ');

		if (/\b(?:invalid|wrong|incorrect|expired|try again|error)\b/i.test(allText)) {
			return { verified: false, reason: 'error-detected' };
		}
		return { verified: true };
	} catch {
		return { verified: false, reason: 'exception' };
	}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { fillCode, verifyFill };
