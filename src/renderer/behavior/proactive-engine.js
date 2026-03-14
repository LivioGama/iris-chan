import { EVENT_TYPES } from '../../shared/event-types.web.js';
import { INTENT_PREDICTION_TIERS, tierForConfidence } from '../../shared/core-principles.web.js';
import { info as logInfo, error as logError } from '../logger.js';

const FLASH_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const PROACTIVE_POLL_MS = 8000;
const SCREEN_FRESH_MS = 20000;

function normalizeText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashString(input = '') {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) - hash) + input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function buildContextFingerprint(frontmostApp = '', capture = null) {
	const ctx = capture?.context || {};
	const parts = [
		normalizeText(frontmostApp),
		String(ctx.imageWidth || ''),
		String(ctx.imageHeight || ''),
		String(ctx.displayWidth || ''),
		String(ctx.displayHeight || ''),
	];
	return hashString(parts.join('|'));
}

function parseJsonEnvelope(text = '') {
	const match = String(text || '').match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		return JSON.parse(match[0]);
	} catch {
		return null;
	}
}

function coerceKind(kind = '') {
	const normalized = normalizeText(kind);
	if (['reply', 'reply-prompt', 'next-step', 'warning', 'fix', 'follow-up', 'opportunity'].includes(normalized)) {
		return normalized;
	}
	return 'next-step';
}

function parseToolEnvelope(result) {
	if (!result) return null;
	if (result.analysis && typeof result.analysis === 'object') return result.analysis;
	return parseJsonEnvelope(result.result || '');
}

export class ProactiveEngine {
	constructor({ behavior, eventBus, voice, screen }) {
		this.behavior = behavior;
		this.eventBus = eventBus;
		this.voice = voice;
		this.screen = screen;
		this.interval = null;
		this.inFlight = false;
		this.apiKey = '';
		this.lastFrontmostApp = '';
		this.lastEvaluatedFingerprint = '';
		this.lastReplyFingerprint = '';
		this.lastReplyAt = 0;
		this.replyCooldownMs = 45_000;
	}

	async start() {
		this.stop();
		this.apiKey = await window.electronAPI.getApiKey?.().catch(() => '') || '';
		if (!this.apiKey || this.apiKey === 'YOUR_API_KEY_HERE') {
			logInfo('Proactive', 'Skipping proactive engine start because no API key is configured');
			return;
		}
		this.interval = setInterval(() => {
			this.tick().catch((err) => logError('Proactive', `Tick failed: ${err?.message || err}`));
		}, PROACTIVE_POLL_MS);
	}

	stop() {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.inFlight = false;
	}

	async tick() {
		if (this.inFlight) return;
		if (!this.voice?.canEvaluateProactively?.()) return;
		if (this.voice?.hasPendingReplySession?.()) return;

		const capture = this.screen?.latestCapture || null;
		const captureAgeMs = capture?.capturedAt ? (Date.now() - capture.capturedAt) : Number.POSITIVE_INFINITY;
		if (!capture?.data || captureAgeMs > SCREEN_FRESH_MS) return;

		const frontmost = await window.electronAPI.executeTool?.('get_frontmost_app', {});
		const frontmostApp = String(frontmost?.result || '').trim();
		if (!frontmostApp) return;

		const contextFingerprint = buildContextFingerprint(frontmostApp, capture);
		if (!this.behavior.shouldEvaluateProactively({
			frontmostApp,
			contextFingerprint,
			captureAgeMs,
			now: Date.now(),
		})) {
			return;
		}

		this.inFlight = true;
		try {
			this.lastFrontmostApp = frontmostApp;
			this.lastEvaluatedFingerprint = contextFingerprint;

			const handledReply = await this._evaluateReplyOpportunity({ frontmostApp, capture, contextFingerprint });
			if (handledReply) return;

			const suggestion = await this._evaluateWithFlash({ frontmostApp, capture, contextFingerprint });
			if (!suggestion?.suggest) return;
			if (!this.behavior.canSuggest({
				confidence: suggestion.confidence,
				contextFingerprint,
				now: Date.now(),
			})) {
				return;
			}

			const payload = {
				kind: coerceKind(suggestion.kind),
				suggestion: String(suggestion.suggestion || '').trim(),
				confidence: Number(suggestion.confidence || 0),
				tier: tierForConfidence(suggestion.confidence),
				context: {
					app: frontmostApp,
					contextFingerprint,
					rationale: String(suggestion.rationale || '').trim(),
					source: 'visible-work',
				},
			};
			if (!payload.suggestion) return;

			this.eventBus.emitEvent(EVENT_TYPES.PROACTIVE_SUGGESTION, payload, 'proactive-engine');
			this.voice?.speakProactiveSuggestion?.(payload.suggestion, payload);
		} finally {
			this.inFlight = false;
		}
	}

	async _evaluateReplyOpportunity({ frontmostApp, capture, contextFingerprint }) {
		let analysis = null;
		try {
			const detectResult = await window.electronAPI.executeTool?.('detect_reply_opportunity', {});
			analysis = parseToolEnvelope(detectResult);
		} catch (err) {
			logError('ReplyAssistant', `Detection failed: ${err?.message || err}`);
			return false;
		}
		if (!analysis?.ok) return false;
		if (!analysis.needsReply) return false;
		if (analysis.conversationFingerprint === this.lastReplyFingerprint && Date.now() - this.lastReplyAt < this.replyCooldownMs) {
			return false;
		}
		if (!analysis.shouldOffer && !analysis.askToHelp) return false;

		const drafts = await this._generateReplySuggestions({ frontmostApp, capture, analysis });
		if (!Array.isArray(drafts) || drafts.length === 0) return false;

		const replyPayload = {
			kind: coerceKind(analysis.askToHelp ? 'reply-prompt' : 'reply'),
			suggestion: analysis.askToHelp ? 'Want a suggested reply here?' : drafts.map((draft, index) => `${index + 1}. ${draft}`).join('  '),
			confidence: Number(analysis.confidence || 0),
			replyPrompt: !!analysis.askToHelp,
			replyOptions: drafts,
			context: {
				app: analysis.frontmostApp || frontmostApp,
				contextFingerprint: analysis.contextFingerprint || contextFingerprint,
				conversationFingerprint: analysis.conversationFingerprint,
				rationale: Array.isArray(analysis.reasons) ? analysis.reasons.join('; ') : '',
				source: 'reply-assistant',
			},
			replyAssistant: {
				composerQueries: Array.isArray(analysis.composerQueries) ? analysis.composerQueries : [],
				sendQueries: Array.isArray(analysis.sendQueries) ? analysis.sendQueries : [],
				contextSummary: analysis.contextSummary || '',
				sendShortcutHint: analysis.sendShortcutHint || '',
				conversationFingerprint: analysis.conversationFingerprint || contextFingerprint,
				needsReply: !!analysis.needsReply,
				askToHelp: !!analysis.askToHelp,
				confidence: Number(analysis.confidence || 0),
			},
		};

		this.eventBus.emitEvent(EVENT_TYPES.PROACTIVE_SUGGESTION, replyPayload, 'reply-assistant');
		const spoken = this.voice?.presentReplySuggestions?.(replyPayload);
		if (spoken) {
			this.lastReplyFingerprint = analysis.conversationFingerprint || contextFingerprint;
			this.lastReplyAt = Date.now();
			return true;
		}
		return false;
	}

	async _evaluateWithFlash({ frontmostApp, capture, contextFingerprint }) {
		const ctx = capture?.context || {};
		const prompt = [
			'You are deciding whether to surface a proactive suggestion to a user based on their current visible work.',
			'Return ONLY JSON. No markdown.',
			'If there is no concrete, high-confidence next step, set "suggest" to false.',
			'Never recommend taking destructive action. Never recommend sending messages or submitting forms automatically.',
			'Allowed kinds: reply, next-step, warning, fix, follow-up, opportunity.',
			'The suggestion must be one short sentence, specific to the current screen, and advisory only.',
			`Frontmost app/window: ${frontmostApp}`,
			`Capture fingerprint: ${contextFingerprint}`,
			`Capture geometry: ${ctx.imageWidth || '?'}x${ctx.imageHeight || '?'} image, ${ctx.displayWidth || '?'}x${ctx.displayHeight || '?'} display`,
			`Intent prediction tiers: ${INTENT_PREDICTION_TIERS.map(t => `${t.name}(>=${t.minConfidence})`).join(', ')}`,
			'JSON schema:',
			'{"suggest":boolean,"kind":"next-step","suggestion":"string","confidence":0.0,"rationale":"string"}',
		].join('\n');

		const body = {
			contents: [{
				parts: [
					{ text: prompt },
					{
						inlineData: {
							mimeType: 'image/jpeg',
							data: capture.data,
						},
					},
				],
			}],
			generationConfig: {
				temperature: 0.2,
				maxOutputTokens: 180,
				responseMimeType: 'application/json',
			},
		};

		try {
			const resp = await fetch(`${FLASH_ENDPOINT}?key=${this.apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(12000),
			});
			if (!resp.ok) {
				logError('Proactive', `Flash request failed: HTTP ${resp.status}`);
				return null;
			}
			const data = await resp.json();
			const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
			const parsed = parseJsonEnvelope(text);
			if (!parsed) return null;
			return {
				suggest: !!parsed.suggest,
				kind: coerceKind(parsed.kind),
				suggestion: String(parsed.suggestion || '').trim(),
				confidence: Number(parsed.confidence || 0),
				rationale: String(parsed.rationale || '').trim(),
			};
		} catch (err) {
			logError('Proactive', `Flash evaluation error: ${err?.message || err}`);
			return null;
		}
	}

	async _generateReplySuggestions({ frontmostApp, capture, analysis }) {
		if (!this.apiKey || !capture?.data) return [];
		const prompt = [
			'You generate concise reply suggestions for a visible conversation.',
			'Return ONLY JSON. No markdown.',
			'Use the accessibility summary as the primary source of truth. Use the screenshot only if the accessibility summary is incomplete.',
			'Do not mention seeing a screenshot or UI. Do not include numbering in the reply texts.',
			'Make the replies short, natural, and sendable as-is.',
			'JSON schema:',
			'{"drafts":["Sure, I can take a look.","I\'ll reply shortly."]}',
			`Frontmost app: ${frontmostApp}`,
			`Conversation summary:\n${analysis?.contextSummary || 'No context'}`,
		].join('\n');

		const body = {
			contents: [{
				parts: [
					{ text: prompt },
					{
						inlineData: {
							mimeType: 'image/jpeg',
							data: capture.data,
						},
					},
				],
			}],
			generationConfig: {
				temperature: 0.35,
				maxOutputTokens: 220,
				responseMimeType: 'application/json',
			},
		};

		try {
			const resp = await fetch(`${FLASH_ENDPOINT}?key=${this.apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(12000),
			});
			if (!resp.ok) {
				logError('ReplyAssistant', `Draft generation failed: HTTP ${resp.status}`);
				return [];
			}
			const data = await resp.json();
			const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
			const parsed = parseJsonEnvelope(text);
			const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
			return drafts
				.map((draft) => String(draft || '').trim())
				.filter(Boolean)
				.slice(0, 4);
		} catch (err) {
			logError('ReplyAssistant', `Draft generation error: ${err?.message || err}`);
			return [];
		}
	}
}
