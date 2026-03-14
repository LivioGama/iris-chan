import { findBestNgram } from './learner.js';

const DEFAULT_CONFIG = Object.freeze({
	ttlMs: 30000,
	maxTerms: 40,
	extractIntervalMs: 10000,
	minConfidence: 0.6,
	rewriteDistance: 3,
	persistEnabled: true,
});

const COMMON_TERMS = new Set([
	'account', 'accounts', 'add', 'all', 'back', 'button', 'cancel', 'chat', 'close',
	'continue', 'create', 'dashboard', 'delete', 'done', 'edit', 'enter', 'file',
	'general', 'help', 'home', 'inbox', 'install', 'learn', 'login', 'message',
	'messages', 'next', 'open', 'page', 'password', 'profile', 'project', 'reply',
	'save', 'search', 'send', 'settings', 'sign in', 'submit', 'tab', 'user', 'view',
	'window', 'workspace',
]);

let storeConfig = { ...DEFAULT_CONFIG };
let recentTerms = [];
let knownTerms = new Set();
let knownCorrections = new Set();

export function configureRecentSeenStore(config = {}) {
	storeConfig = {
		...storeConfig,
		...(config || {}),
	};
	pruneExpired();
}

export function setRecentSeenKnownTerms({ vocabTerms = [], hotTerms = [], coreTerms = [], corrections = {} } = {}) {
	knownTerms = new Set(
		[...vocabTerms, ...hotTerms, ...coreTerms]
			.map((term) => normalizeTerm(term))
			.filter(Boolean)
	);
	knownCorrections = new Set(
		Object.entries(corrections || {})
			.flatMap(([wrong, right]) => [normalizeTerm(wrong), normalizeTerm(right)])
			.filter(Boolean)
	);
	pruneExpired();
}

export function addRecentSeenTerms(terms = [], context = {}) {
	if (!Array.isArray(terms) || !terms.length) return [];
	const now = Number(context.now || Date.now());
	const added = [];

	for (const item of terms) {
		const rawTerm = typeof item === 'string' ? item : item?.term;
		const term = String(rawTerm || '').trim();
		if (!term) continue;
		const normalizedTerm = normalizeTerm(term);
		if (!normalizedTerm) continue;
		if (shouldSkipTerm(term, normalizedTerm)) continue;

		const confidence = clampConfidence(typeof item === 'object' ? item?.confidence : null);
		if (confidence < storeConfig.minConfidence) continue;

		const seenAt = Number(item?.seenAt || now);
		const ttl = Number(item?.ttlMs || context.ttlMs || storeConfig.ttlMs);
		const nextEntry = {
			term,
			normalizedTerm,
			source: String(item?.source || context.source || 'screen'),
			seenAt,
			expiresAt: seenAt + ttl,
			confidence,
			captureId: item?.captureId || context.captureId || '',
			appHint: item?.appHint || context.appHint || '',
		};
		const existingIndex = recentTerms.findIndex((entry) => entry.normalizedTerm === normalizedTerm);
		if (existingIndex >= 0) {
			const previous = recentTerms[existingIndex];
			recentTerms[existingIndex] = {
				...previous,
				...nextEntry,
				confidence: Math.max(previous.confidence || 0, nextEntry.confidence),
				seenAt: Math.max(previous.seenAt || 0, nextEntry.seenAt),
				expiresAt: Math.max(previous.expiresAt || 0, nextEntry.expiresAt),
			};
		} else {
			recentTerms.push(nextEntry);
		}
		added.push(nextEntry);
	}

	pruneExpired(now);
	return added;
}

export function listRecentSeenTerms(now = Date.now()) {
	pruneExpired(now);
	return [...recentTerms];
}

export function buildRecentSeenPrompt(now = Date.now()) {
	const active = listRecentSeenTerms(now).slice(0, Math.min(8, storeConfig.maxTerms));
	if (!active.length) return '';
	return `\n\nRECENT SCREEN TERMS — short-lived speech hints from the last ${Math.round(storeConfig.ttlMs / 1000)} seconds:\n${active.map((entry) => `- ${entry.term}`).join('\n')}`;
}

export function findRecentSeenRewrite(text, now = Date.now()) {
	const input = String(text || '').trim();
	if (!input) return null;

	const active = listRecentSeenTerms(now);
	if (!active.length) return null;

	const candidates = [];

	for (const entry of active) {
		if (!entry?.term) continue;

		const termWords = entry.term.split(/\s+/).filter(Boolean).length || 1;
		const match = findBestNgram(input, entry.term, termWords);
		if (!match?.ngram) continue;

		const normalizedNgram = normalizeTerm(match.ngram);
		if (!normalizedNgram) continue;

		const exact = normalizedNgram === entry.normalizedTerm;
		const threshold = exact
			? 0
			: Math.max(
				1,
				Math.min(
					storeConfig.rewriteDistance,
					Math.ceil(entry.normalizedTerm.length * 0.35)
				)
			);
		if (!exact && match.distance > threshold) continue;

		const ageMs = Math.max(0, now - entry.seenAt);
		candidates.push({
			entry,
			match,
			exact,
			distance: match.distance,
			ageMs,
		});
	}

	if (!candidates.length) return null;

	candidates.sort(compareCandidates);
	const [best, second] = candidates;
	if (!isClearWinner(best, second)) return null;

	const updated = replaceNgram(input, best.match.ngram, best.entry.term);
	if (updated === input) return null;

	return {
		text: updated,
		wrong: best.match.ngram,
		right: best.entry.term,
		target: best.entry.term,
		distance: best.distance,
		exact: best.exact,
		confidence: best.entry.confidence,
		seenAt: best.entry.seenAt,
		captureId: best.entry.captureId,
		shouldPersist: !!storeConfig.persistEnabled,
	};
}

export function clearRecentSeenTerms() {
	recentTerms = [];
}

export function normalizeTerm(value = '') {
	return String(value)
		.toLowerCase()
		.replace(/[`'".,!?()[\]{}:;]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function pruneExpired(now = Date.now()) {
	recentTerms = recentTerms
		.filter((entry) => entry && entry.expiresAt > now)
		.sort((a, b) => b.seenAt - a.seenAt || b.confidence - a.confidence)
		.slice(0, storeConfig.maxTerms);
}

function shouldSkipTerm(term, normalizedTerm) {
	if (!normalizedTerm) return true;
	if (normalizedTerm.length < 3) return true;
	if (!/[A-Z0-9]/.test(term) && !/[^a-z\s]/i.test(term)) return true;
	if (!/[A-Za-z]/.test(term)) return true;
	if (COMMON_TERMS.has(normalizedTerm)) return true;
	if (knownTerms.has(normalizedTerm)) return true;
	if (knownCorrections.has(normalizedTerm)) return true;
	return false;
}

function clampConfidence(value) {
	const numeric = Number(value);
	if (Number.isFinite(numeric)) {
		if (numeric < 0) return 0;
		if (numeric > 1) return 1;
		return numeric;
	}
	return 1;
}

function compareCandidates(a, b) {
	if (a.exact !== b.exact) return a.exact ? -1 : 1;
	if (a.distance !== b.distance) return a.distance - b.distance;
	if (a.ageMs !== b.ageMs) return a.ageMs - b.ageMs;
	if (a.entry.confidence !== b.entry.confidence) return b.entry.confidence - a.entry.confidence;
	return a.entry.term.localeCompare(b.entry.term);
}

function isClearWinner(best, second) {
	if (!best) return false;
	if (!second) return true;
	if (best.exact !== second.exact) return true;
	if (best.entry.normalizedTerm === second.entry.normalizedTerm) return true;
	if (best.distance === second.distance) return false;
	if (second.distance - best.distance === 1) {
		const clearlyNewer = best.ageMs + 5000 < second.ageMs;
		const clearlyHigherConfidence = (best.entry.confidence - second.entry.confidence) >= 0.2;
		return clearlyNewer || clearlyHigherConfidence;
	}
	return best.distance < second.distance;
}

function replaceNgram(text, ngram, term) {
	const escaped = escapeRegExp(ngram);
	const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
	return text.replace(pattern, term);
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
