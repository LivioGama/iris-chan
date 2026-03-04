const NOISE_PATTERNS = [
	/^\s*$/i,
	/^(queued|waiting|polling|heartbeat|noop)\b/i,
	/^(thinking|analyzing|checking|considering)\b/i,
	/\b(stand ?by|i'?m here|silence is correct behavior)\b/i,
	/\[stderr\]\s*$/i,
];

export function summarizeMilestoneLine(line = '') {
	const text = String(line).trim();
	if (!text) return null;
	if (NOISE_PATTERNS.some((re) => re.test(text))) return null;

	if (/task execution started|starting/i.test(text)) {
		return { important: true, summary: 'Started task execution.' };
	}

	if (/\[tool:\s*([^\]]+)\]/i.test(text)) {
		const tool = text.replace(/^.*\[tool:\s*/i, '').replace(/\].*$/, '').trim();
		return { important: false, summary: `Using ${tool}.` };
	}

	if (/verify|verification/i.test(text) && /pass|ok|success/i.test(text)) {
		return { important: true, summary: 'Action verified successfully.' };
	}

	if (/error|failed|exception|traceback/i.test(text)) {
		return { important: true, summary: 'Task hit an error.' };
	}

	if (/completed|done|success/i.test(text)) {
		return { important: true, summary: 'Task completed successfully.' };
	}

	if (/restart|relaunch/i.test(text)) {
		return { important: true, summary: 'Runtime restart required.' };
	}

	return { important: false, summary: text.slice(0, 120) };
}

export function shouldNarrateMilestone(entry, userContext = { askedProgress: false }) {
	if (!entry?.summary) return false;
	return userContext.askedProgress || !!entry.important;
}
