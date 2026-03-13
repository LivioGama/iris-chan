const NOISE_PATTERNS = [
	/^\s*$/i,
	/^(queued|waiting|polling|heartbeat|noop)\b/i,
	/^(thinking|analyzing|checking|considering)\b/i,
	/\b(stand ?by|i'?m here|silence is correct behavior)\b/i,
	/\[stderr\]\s*$/i,
];

const MID_PRIORITY_PHASES = new Set(['start', 'progress', 'verify', 'restart']);

function cleanSentence(text = '') {
	return String(text || '').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/g, '');
}

function sentenceCase(text = '') {
	const value = cleanSentence(text);
	if (!value) return '';
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function quoteSnippet(text = '', maxLength = 48) {
	const value = cleanSentence(text).replace(/^["']|["']$/g, '');
	if (!value) return '';
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function extractToolName(text = '') {
	const match = text.match(/\[tool:\s*([^\]]+)\]/i);
	return match ? cleanSentence(match[1]) : '';
}

function summarizeFailure(text) {
	const normalized = cleanSentence(text);
	const pathMatch = normalized.match(/(?:in|for|while|patch|write|read)\s+([~./\w-]+\.\w+|[~./\w-]+\/[~./\w-]+)/i);
	const pathDetail = pathMatch ? ` around ${pathMatch[1]}` : '';
	if (/verify|verification/i.test(normalized)) {
		return `I still need another verification pass${pathDetail}.`;
	}
	if (/patch|write|edit|update/i.test(normalized)) {
		return `The change ran into resistance${pathDetail}, so I need another pass.`;
	}
	if (/timeout|timed out/i.test(normalized)) {
		return `That step stalled${pathDetail}, so I need a different route.`;
	}
	return `I hit a snag${pathDetail} and need to adjust.`;
}

function summarizeSuccess(text) {
	const normalized = cleanSentence(text);
	if (/verify|verification/i.test(normalized)) {
		return 'The latest check looks solid.';
	}
	if (/completed|done|success/i.test(normalized)) {
		return 'That part is wrapped up.';
	}
	return sentenceCase(normalized);
}

function summarizeProgress(text) {
	const normalized = cleanSentence(text);
	const taskStart = normalized.match(/^task\s+([^\s]+)\s+started$/i);
	if (taskStart) {
		return `I've started ${taskStart[1]}.`;
	}
	if (/paused/i.test(normalized)) {
		return 'I am pausing briefly while a higher-priority task runs.';
	}
	if (/resumed/i.test(normalized)) {
		return 'I am back on it now.';
	}
	if (/blocked until .*verification/i.test(normalized)) {
		return 'I am holding completion until the follow-up verification comes back clean.';
	}
	return sentenceCase(normalized);
}

export function summarizeMilestoneLine(line = '') {
	const text = String(line).trim();
	if (!text) return null;
	if (NOISE_PATTERNS.some((re) => re.test(text))) return null;

	const normalized = cleanSentence(text);
	const tool = extractToolName(normalized);
	if (tool) {
		return {
			important: false,
			phase: 'tool',
			summary: `I'm using ${tool} to move this forward.`,
		};
	}

	if (/restart|relaunch/i.test(normalized)) {
		return {
			important: true,
			phase: 'restart',
			summary: /required|need/i.test(normalized)
				? 'This needs a restart before the change is fully in place.'
				: 'A restart is part of the next step here.',
		};
	}

	if (/error|failed|exception|traceback|blocked/i.test(normalized)) {
		return {
			important: true,
			phase: 'issue',
			summary: summarizeFailure(normalized),
		};
	}

	if (/verify|verification/i.test(normalized) && /pass|ok|success|clean|solid/i.test(normalized)) {
		return {
			important: true,
			phase: 'verify',
			summary: summarizeSuccess(normalized),
		};
	}

	if (/completed|done|success/i.test(normalized)) {
		return {
			important: true,
			phase: 'done',
			summary: summarizeSuccess(normalized),
		};
	}

	if (/task execution started|starting|started|paused|resumed|progress|updated|working|investigating|checking/i.test(normalized)) {
		return {
			important: false,
			phase: 'progress',
			summary: summarizeProgress(normalized),
		};
	}

	if (/search|research|inspect|read|open|review/i.test(normalized)) {
		const snippet = quoteSnippet(normalized, 64);
		return {
			important: false,
			phase: 'progress',
			summary: snippet ? `I'm following up on ${snippet}.` : 'I am pulling in a little more context before the next step.',
		};
	}

	return {
		important: false,
		phase: 'progress',
		summary: sentenceCase(normalized).slice(0, 140),
	};
}

export function shouldNarrateMilestone(entry, userContext = {}) {
	if (!entry?.summary) return false;
	if (userContext.askedProgress) return true;
	if (entry.important) return true;
	return MID_PRIORITY_PHASES.has(entry.phase);
}
