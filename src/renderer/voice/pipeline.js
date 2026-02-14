// State machine orchestration (delegates to sub-modules)

import { GeminiClient } from '../gemini/client.js';
import { AudioCapture } from './capture.js';
import { AudioPlayback } from './playback.js';
import { VocabMatcher } from '../vocab/matcher.js';
import { findBestNgram } from '../vocab/learner.js';
import { updateIndicator, updateStatus } from '../ui/debug-panel.js';
import { showBubble, hideBubbles } from '../ui/bubbles.js';

const STATES = {
	IDLE: 'IDLE',
	LISTENING: 'LISTENING',
	USER_SPEAKING: 'USER_SPEAKING',
	PROCESSING: 'PROCESSING',
	RESPONDING: 'RESPONDING',
	TOOL_EXECUTING: 'TOOL_EXECUTING',
};

export class VoicePipeline {
	constructor() {
		this.gemini = new GeminiClient();
		this.capture = new AudioCapture();
		this.playback = new AudioPlayback();
		this.state = STATES.IDLE;
		this.volumeThreshold = 0.015;
		this.lastVolume = 0;
		this.userTranscript = '';
		this.modelTranscript = '';
		this._accum = { user: '', model: '' };
		this._lastTranscriptTime = { user: 0, model: 0 };
		this._newTurnThresholdMs = 3000;
		this._active = false;
		this._apiKey = null;
		this._toolExecuting = false;
		this._screenInterval = null;
		this._matcher = new VocabMatcher();
		this._correctionCandidates = new Map();
		this._lastUserTurn = '';
		this._lastReplyPromptTime = 0;
		this._replyCooldownMs = 45000;
	}

	async _loadVocabulary() {
		try {
			const allTerms = await window.electronAPI.getVocabulary() || [];
			const hotTerms = await window.electronAPI.getHotVocabulary() || [];
			for (const t of hotTerms) {
				if (!allTerms.includes(t)) allTerms.push(t);
			}
			const corrections = await window.electronAPI.getVocabularyCorrections() || {};
			this._matcher.build(corrections, allTerms);
			const corrCount = Object.keys(corrections).length;
			console.log(`[Vocab] Matcher built: ${allTerms.length} terms, ${corrCount} corrections`);
		} catch (err) {
			console.error('[Vocab] Failed to load vocabulary:', err);
		}
	}

	_scanVocabulary(text) {
		const hits = this._matcher.scan(text);
		if (hits.length > 0) {
			window.electronAPI.trackVocabulary(hits);
		}
	}

	_correctTranscript(text) {
		const result = this._matcher.correct(text);
		if (result !== text) {
			console.log('[Vocab] FIXED:', JSON.stringify(text), '\u2192', JSON.stringify(result));
		}
		return result;
	}

	_learnCorrections(userText, modelText) {
		const modelHits = this._matcher.scan(modelText);
		if (!modelHits.length) return;

		const userLower = userText.toLowerCase();

		for (const term of modelHits) {
			const termLower = term.toLowerCase();
			if (userLower.includes(termLower)) continue;
			if (term.length < 4) continue;

			const termWords = term.split(/\s+/);
			const match = findBestNgram(userText, term, termWords.length);
			if (!match) continue;

			const threshold = Math.ceil(term.length * 0.35);
			if (match.distance === 0 || match.distance > threshold) continue;

			const key = match.ngram.toLowerCase();
			if (this._matcher.hasCorrection(key)) continue;

			if (!this._correctionCandidates.has(key)) {
				this._correctionCandidates.set(key, { target: term, count: 0 });
			}
			const candidate = this._correctionCandidates.get(key);
			if (candidate.target !== term) continue;
			candidate.count++;
			console.log(`[Vocab] Correction candidate: "${match.ngram}" \u2192 "${term}" (\u00d7${candidate.count})`);

			if (candidate.count >= 2) {
				this._correctionCandidates.delete(key);
				this._matcher.addCorrection(key, term);
				window.electronAPI.addCorrection(key, term);
				console.log(`[Vocab] AUTO-LEARNED: "${key}" \u2192 "${term}"`);
			}
		}
	}

	async start() {
		this._apiKey = await window.electronAPI.getApiKey();
		if (!this._apiKey || this._apiKey === 'YOUR_API_KEY_HERE') {
			updateStatus('No API key \u2014 set GEMINI_API_KEY in .env');
			return;
		}

		await this._loadVocabulary();
		this._vocabRefreshInterval = setInterval(() => this._loadVocabulary(), 60000);
		this._bindEvents();

		window.electronAPI.onToggleVoice(() => this.toggle());
		window.electronAPI.onMessagingAppFocused((app) => this._onMessagingAppFocused(app));
		window.electronAPI.onMessagingAppLeft(() => { this._lastReplyPromptTime = 0; });

		await this._activate();
	}

	_bindEvents() {
		this.gemini.on('connected', () => {
			updateIndicator('ws', true);
			updateStatus('WebSocket connected, setting up...');
		});

		this.gemini.on('ready', async () => {
			updateStatus('Session ready \u2014 starting mic');
			try {
				await this.capture.start();
			} catch (err) {
				console.error('[Voice] Mic error:', err);
				updateStatus('Mic error: ' + err.message);
			}
			this._startScreenCapture();
		});

		this.gemini.on('disconnected', () => {
			updateIndicator('ws', false);
			updateIndicator('send', false);
			updateStatus('Disconnected');
			this._setState(STATES.IDLE);
		});

		this.gemini.on('error', (err) => {
			updateStatus('Error: ' + (err.message || 'WebSocket error'));
		});

		this.gemini.on('maxRetriesReached', () => {
			updateStatus('Max retries reached \u2014 reload to reconnect');
		});

		this.gemini.on('audio', (data) => {
			if (this.state !== STATES.RESPONDING) {
				if (this._accum.user) this._lastUserTurn = this._accum.user;
				this._accum.user = '';
			}
			this._setState(STATES.RESPONDING);
			this.playback.enqueue(data);
		});

		this.gemini.on('inputTranscription', (text) => {
			this._appendTranscript('user', text);
			updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			this._appendTranscript('model', text);
		});

		this.gemini.on('turnComplete', () => {
			this._setState(STATES.LISTENING);
			updateIndicator('think', false);
			if (this._accum.model) this._scanVocabulary(this._accum.model);
			if (this._lastUserTurn && this._accum.model) {
				this._learnCorrections(this._lastUserTurn, this._accum.model);
			}
			this._accum.model = '';
		});

		this.gemini.on('interrupted', () => {
			this.playback.stop();
			this._setState(STATES.LISTENING);
		});

		this.gemini.on('toolCall', (calls) => this._handleToolCalls(calls));

		this.capture.on('started', () => {
			updateIndicator('mic', true);
			updateIndicator('send', true);
			this._setState(STATES.LISTENING);
			updateStatus('Listening...');
		});

		this.capture.on('data', (base64) => {
			if (!this._toolExecuting) {
				this.gemini.sendAudio(base64);
			}
		});

		this.capture.on('volume', (vol) => {
			this.lastVolume = vol;
			if (vol > this.volumeThreshold && this.state === STATES.LISTENING) {
				this._setState(STATES.USER_SPEAKING);
			} else if (vol < this.volumeThreshold * 0.5 && this.state === STATES.USER_SPEAKING) {
				this._setState(STATES.PROCESSING);
			}
		});

		this.capture.on('stopped', () => {
			updateIndicator('mic', false);
			updateIndicator('send', false);
		});

		this.playback.on('started', () => {
			updateIndicator('speak', true);
		});

		this.playback.on('ended', () => {
			updateIndicator('speak', false);
			if (this.state === STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
		});

		this.playback.on('stopped', () => {
			updateIndicator('speak', false);
		});
	}

	async toggle() {
		if (this._active) {
			this._deactivate();
		} else {
			await this._activate();
		}
	}

	async _activate() {
		this._active = true;
		updateStatus('Connecting...');
		await this.gemini.connect(this._apiKey);
	}

	_deactivate() {
		this._active = false;
		this._toolExecuting = false;
		if (this._vocabRefreshInterval) {
			clearInterval(this._vocabRefreshInterval);
			this._vocabRefreshInterval = null;
		}
		this._stopScreenCapture();
		this.playback.stop();
		this.capture.stop();
		this.gemini.disconnect();
		this._setState(STATES.IDLE);
		for (const id of ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool', 'srch']) {
			updateIndicator(id, false);
		}
		hideBubbles();
		window.electronAPI.searchHide();
		updateStatus('Voice off (Ctrl+I to enable)');
	}

	getSpeakingVolume() {
		return this.playback.getVolume();
	}

	_setState(state) {
		const prev = this.state;
		this.state = state;

		if (prev === STATES.LISTENING && state === STATES.USER_SPEAKING) {
			this._sendScreenFrame();
		}

		updateIndicator('voice', state === STATES.USER_SPEAKING);
		updateIndicator('think', state === STATES.PROCESSING);
		updateIndicator('speak', state === STATES.RESPONDING);
	}

	_appendTranscript(who, chunk) {
		if (!chunk) return;
		const now = Date.now();
		const gap = now - this._lastTranscriptTime[who];

		if (gap > this._newTurnThresholdMs || !this._accum[who]) {
			if (this._accum[who]) this._scanVocabulary(this._accum[who]);
			this._accum[who] = chunk;
		} else {
			this._accum[who] += chunk;
		}
		this._lastTranscriptTime[who] = now;

		showBubble(who, this._correctTranscript(this._accum[who]));
	}

	async _handleToolCalls(calls) {
		this._setState(STATES.TOOL_EXECUTING);
		this._toolExecuting = true;
		updateIndicator('tool', true);

		for (let i = 0; i < calls.length; i++) {
			const { name, args, id } = calls[i];
			if (i > 0) await new Promise(r => setTimeout(r, 200));

			if (name === 'web_search') {
				window.electronAPI.searchSpinner(args.query || 'Searching...');
				updateIndicator('srch', true);
			}

			try {
				const result = await window.electronAPI.executeTool(name, args);
				this.gemini.sendToolResponse(id, name, result.result || 'done');

				if (name === 'web_search') {
					updateIndicator('srch', false);
					window.electronAPI.searchResult(args.query || 'Search', result.ok ? result.result : (result.result || 'Search failed'));
				}
			} catch (err) {
				this.gemini.sendToolResponse(id, name, 'Error: ' + err.message);
				if (name === 'web_search') {
					updateIndicator('srch', false);
					window.electronAPI.searchResult(args.query || 'Search', 'Error: ' + err.message);
				}
			}
		}

		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			await this._loadVocabulary();
			this.gemini.sendVocabUpdate();
		}

		await this._sendScreenFrame();

		this._toolExecuting = false;
		updateIndicator('tool', false);
		this._setState(STATES.LISTENING);
	}

	async _sendScreenFrame() {
		try {
			const capture = await window.electronAPI.captureScreen();
			if (capture?.ok && capture.data) {
				this.gemini.sendImage(capture.data);
			}
		} catch (err) {
			console.error('[Voice] Screen capture error:', err);
		}
	}

	_startScreenCapture() {
		this._stopScreenCapture();
		this._sendScreenFrame();
		this._screenInterval = setInterval(() => {
			if (!this._toolExecuting && this._active) {
				this._sendScreenFrame();
			}
		}, 10000);
	}

	_stopScreenCapture() {
		if (this._screenInterval) {
			clearInterval(this._screenInterval);
			this._screenInterval = null;
		}
	}

	async _onMessagingAppFocused(app) {
		if (!this._active || !this.gemini.sessionReady) return;
		if (this._toolExecuting) return;
		const now = Date.now();
		if (now - this._lastReplyPromptTime < this._replyCooldownMs) return;
		this._lastReplyPromptTime = now;

		try {
			const capture = await window.electronAPI.captureScreen();
			if (capture?.ok && capture.data) {
				this.gemini.sendImage(capture.data);
			}
		} catch {}

		this.gemini.sendText(
			`The user just switched to ${app}. Look at the screen \u2014 if there's an unread message or ongoing conversation visible, proactively suggest a reply using the propose_reply tool. Be natural, match the conversation tone, and keep it brief. If there's nothing to reply to, stay silent.`
		);
	}
}
