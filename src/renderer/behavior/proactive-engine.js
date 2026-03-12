import { EVENT_TYPES } from '../../shared/event-types.web.js';
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
	if (['reply', 'next-step', 'warning', 'fix', 'follow-up', 'opportunity'].includes(normalized)) {
		return normalized;
	}
	return 'next-step';
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
}
