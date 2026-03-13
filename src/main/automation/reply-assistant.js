const REPLY_KEYWORDS = /\b(reply|message|chat|dm|direct message|comment|conversation)\b/i;
const COMPOSER_KEYWORDS = /\b(write|type|message|reply|comment|chat|send a message|send message)\b/i;
const SEND_KEYWORDS = /\b(send|reply|post|submit)\b/i;
const UNREAD_KEYWORDS = /\b(unread|new messages?|new activity|mentions?)\b/i;
const SELF_AUTHOR_KEYWORDS = /^(you|me|i|my message)\b/i;
const CODEISH_PATTERN = /[`{}()[\];<>/=]|https?:\/\/|\/Users\/|\.tsx?\b|\.jsx?\b|function\s|\bconst\b|\blet\b|\bclass\b/;

function normalizeText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashString(input = '') {
	let hash = 0;
	for (let index = 0; index < input.length; index += 1) {
		hash = ((hash << 5) - hash) + input.charCodeAt(index);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function parseJsonResult(text, fallback = null) {
	if (typeof text !== 'string') return fallback;
	try {
		return JSON.parse(text);
	} catch {
		return fallback;
	}
}

function parseFrontmostApp(resultText = '') {
	const match = String(resultText || '').match(/^App:\s*([^,]+),\s*Windows:\s*(.*)$/s);
	if (!match) return { name: String(resultText || '').trim(), windows: [] };
	return {
		name: match[1].trim(),
		windows: String(match[2] || '')
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean),
	};
}

function detailForElement(element = {}) {
	return String(
		element.detail
		|| element.title
		|| element.value
		|| element.help
		|| ''
	).trim();
}

function roleText(element = {}) {
	return `${element.role || ''} ${element.subrole || ''}`.trim();
}

function isEditableElement(element = {}) {
	const role = normalizeText(roleText(element));
	return role.includes('text field') || role.includes('text area') || role.includes('search field');
}

function isActionableElement(element = {}) {
	const role = normalizeText(roleText(element));
	return role.includes('button')
		|| role.includes('link')
		|| role.includes('menu item')
		|| role.includes('tab')
		|| role.includes('check box')
		|| role.includes('radio button');
}

function uniqueNonEmpty(values = []) {
	return [...new Set(
		values
			.map((value) => String(value || '').trim())
			.filter(Boolean)
	)];
}

function compactMessageList(messages = [], limit = 12) {
	const seen = new Set();
	const out = [];
	for (const message of messages) {
		const value = String(message || '').trim();
		if (!value) continue;
		const key = normalizeText(value);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value);
		if (out.length >= limit) break;
	}
	return out;
}

function looksLikeMessageText(text = '') {
	const value = String(text || '').trim();
	if (!value) return false;
	if (value.length < 2 || value.length > 240) return false;
	if (COMPOSER_KEYWORDS.test(value) || SEND_KEYWORDS.test(value)) return false;
	return true;
}

function collectSnapshotFacts(snapshot = {}) {
	const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
	const composerCandidates = [];
	const sendCandidates = [];
	const messageCandidates = [];
	let unreadSignal = false;
	let shortcutHint = '';

	for (const element of elements) {
		const detail = detailForElement(element);
		const normalized = normalizeText(detail);
		const role = normalizeText(roleText(element));
		if (!detail) continue;

		if (UNREAD_KEYWORDS.test(detail)) unreadSignal = true;
		if (!shortcutHint && /\bcmd\+enter\b|\bcommand\+enter\b|\bctrl\+enter\b/i.test(detail)) {
			shortcutHint = /ctrl\+enter/i.test(detail) ? 'ctrl+enter' : 'cmd+enter';
		} else if (!shortcutHint && /\benter to send\b|\breturn to send\b/i.test(detail)) {
			shortcutHint = 'return';
		}

		if (isEditableElement(element) || COMPOSER_KEYWORDS.test(detail)) {
			composerCandidates.push(detail);
			continue;
		}

		if ((isActionableElement(element) || role.includes('group')) && SEND_KEYWORDS.test(detail)) {
			sendCandidates.push(detail);
			continue;
		}

		if (looksLikeMessageText(detail)) {
			messageCandidates.push(detail);
		}
	}

	return {
		composerCandidates: uniqueNonEmpty(composerCandidates),
		sendCandidates: uniqueNonEmpty(sendCandidates),
		messageCandidates: compactMessageList(messageCandidates),
		unreadSignal,
		shortcutHint,
	};
}

function inferLatestMessageAuthorship(messages = []) {
	const latest = String(messages[messages.length - 1] || '').trim();
	if (!latest) return { latestMessage: '', latestAuthoredBySelf: false };
	return {
		latestMessage: latest,
		latestAuthoredBySelf: SELF_AUTHOR_KEYWORDS.test(normalizeText(latest)),
	};
}

function buildFingerprintInputs(snapshot = {}, facts = {}, frontmostApp = {}) {
	const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
	const detailBlock = elements
		.slice(0, 40)
		.map((element) => `${roleText(element)}::${detailForElement(element)}`)
		.join('|');
	const messageBlock = facts.messageCandidates.join('|');
	return {
		contextFingerprint: hashString([
			normalizeText(frontmostApp.name),
			normalizeText((frontmostApp.windows || []).join('|')),
			detailBlock,
		].join('||')),
		conversationFingerprint: hashString([
			normalizeText(frontmostApp.name),
			normalizeText(snapshot.windowTitle || ''),
			messageBlock,
			facts.unreadSignal ? 'unread' : 'read',
		].join('||')),
	};
}

function scoreConversationLikelihood(snapshot = {}, facts = {}) {
	const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
	let score = 0;
	const reasons = [];

	if (facts.composerCandidates.length) {
		score += 0.34;
		reasons.push('editable composer detected');
	}
	if (facts.sendCandidates.length || facts.shortcutHint) {
		score += 0.16;
		reasons.push('send action detected');
	}
	if (facts.messageCandidates.length >= 4) {
		score += 0.28;
		reasons.push('multiple short message-like texts visible');
	} else if (facts.messageCandidates.length >= 2) {
		score += 0.14;
		reasons.push('some message-like text visible');
	}
	if (facts.unreadSignal) {
		score += 0.08;
		reasons.push('unread indicator visible');
	}

	const noisyLongText = facts.messageCandidates.filter((entry) => entry.length > 160).length;
	if (noisyLongText >= 3) {
		score -= 0.12;
		reasons.push('screen looks more document-like than chat-like');
	}
	const codeishCount = elements
		.map((element) => detailForElement(element))
		.filter((detail) => CODEISH_PATTERN.test(detail))
		.length;
	if (codeishCount >= 6 && !facts.composerCandidates.length) {
		score -= 0.2;
		reasons.push('screen is code/text heavy without chat affordances');
	}

	return {
		confidence: Math.max(0, Math.min(1, score)),
		reasons,
	};
}

function buildContextSummary(frontmostApp, snapshot, facts, authorship) {
	const lines = [
		`App: ${frontmostApp.name || snapshot.appName || 'Unknown'}`,
		`Window: ${snapshot.windowTitle || 'Unknown'}`,
	];
	if (facts.shortcutHint) lines.push(`Send shortcut hint: ${facts.shortcutHint}`);
	if (facts.unreadSignal) lines.push('Unread indicator visible');
	if (facts.messageCandidates.length) {
		lines.push('Visible conversation context:');
		for (const message of facts.messageCandidates.slice(-8)) {
			lines.push(`- ${message}`);
		}
	}
	if (authorship.latestMessage) {
		lines.push(`Latest visible message: ${authorship.latestMessage}`);
		lines.push(`Latest visible message authored by self: ${authorship.latestAuthoredBySelf ? 'yes' : 'no'}`);
	}
	return lines.join('\n');
}

function buildGenericComposerQueries(candidates = []) {
	return uniqueNonEmpty([
		...candidates,
		'reply',
		'message',
		'write a message',
		'type a message',
		'comment',
		'chat',
		'direct message',
	]);
}

function buildGenericSendQueries(candidates = []) {
	return uniqueNonEmpty([
		...candidates,
		'send',
		'reply',
		'post',
		'submit',
	]);
}

function analyzeReplyOpportunity({ frontmostApp = {}, axSnapshot = {} } = {}) {
	const facts = collectSnapshotFacts(axSnapshot);
	const scoring = scoreConversationLikelihood(axSnapshot, facts);
	const authorship = inferLatestMessageAuthorship(facts.messageCandidates);
	const fingerprints = buildFingerprintInputs(axSnapshot, facts, frontmostApp);
	const needsReply = facts.unreadSignal || Boolean(authorship.latestMessage && !authorship.latestAuthoredBySelf);
	const shouldOffer = scoring.confidence >= 0.72 && needsReply;
	const askToHelp = !shouldOffer && scoring.confidence >= 0.54 && needsReply;
	const contextSummary = buildContextSummary(frontmostApp, axSnapshot, facts, authorship);

	return {
		ok: true,
		frontmostApp: frontmostApp.name || axSnapshot.appName || '',
		windowTitle: axSnapshot.windowTitle || '',
		confidence: scoring.confidence,
		reasons: scoring.reasons,
		shouldOffer,
		askToHelp,
		needsReply,
		unreadSignal: facts.unreadSignal,
		latestMessage: authorship.latestMessage,
		latestMessageAuthoredBySelf: authorship.latestAuthoredBySelf,
		composerQueries: buildGenericComposerQueries(facts.composerCandidates),
		sendQueries: buildGenericSendQueries(facts.sendCandidates),
		sendShortcutHint: facts.shortcutHint || '',
		messageCandidates: facts.messageCandidates,
		contextSummary,
		contextFingerprint: fingerprints.contextFingerprint,
		conversationFingerprint: fingerprints.conversationFingerprint,
	};
}

module.exports = {
	analyzeReplyOpportunity,
	buildGenericComposerQueries,
	buildGenericSendQueries,
	collectSnapshotFacts,
	hashString,
	normalizeText,
	parseFrontmostApp,
	parseJsonResult,
};
