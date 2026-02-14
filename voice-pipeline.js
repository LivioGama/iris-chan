// Voice pipeline: capture → Gemini → playback + debug UI

import { GeminiClient } from './gemini-client.js';
import { AudioCapture } from './audio-capture.js';
import { AudioPlayback } from './audio-playback.js';
import { VocabMatcher, levenshtein, findBestNgram } from './vocab-matcher.js';

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
		// Accumulation state for transcriptions
		this._accum = { user: '', model: '' };
		this._lastTranscriptTime = { user: 0, model: 0 };
		this._newTurnThresholdMs = 3000;
		this._active = false;
		this._apiKey = null;
		this._toolExecuting = false;
		this._screenInterval = null;
		this._searchHideTimeout = null;
		// Vocabulary — Aho-Corasick matcher for single-pass detection & correction
		this._matcher = new VocabMatcher();
		this._correctionCandidates = new Map();
		this._lastUserTurn = '';
		// Proactive reply
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
			console.log('[Vocab] FIXED:', JSON.stringify(text), '→', JSON.stringify(result));
		}
		return result;
	}

	// Auto-learn corrections by comparing user STT errors vs model vocab usage
	_learnCorrections(userText, modelText) {
		// Find vocab terms Iris used in her response
		const modelHits = this._matcher.scan(modelText);
		if (!modelHits.length) return;

		const userLower = userText.toLowerCase();

		for (const term of modelHits) {
			const termLower = term.toLowerCase();
			// Skip if term already matches in user text (no mismatch)
			if (userLower.includes(termLower)) continue;
			// Skip very short terms (too many false positives)
			if (term.length < 4) continue;

			// Find the closest n-gram in user text
			const termWords = term.split(/\s+/);
			const match = findBestNgram(userText, term, termWords.length);
			if (!match) continue;

			// Only accept if edit distance < 35% of term length and not zero
			const threshold = Math.ceil(term.length * 0.35);
			if (match.distance === 0 || match.distance > threshold) continue;

			const key = match.ngram.toLowerCase();
			// Skip if already a known correction
			if (this._matcher.hasCorrection(key)) continue;

			// Track candidate
			if (!this._correctionCandidates.has(key)) {
				this._correctionCandidates.set(key, { target: term, count: 0 });
			}
			const candidate = this._correctionCandidates.get(key);
			if (candidate.target !== term) continue;
			candidate.count++;
			console.log(`[Vocab] Correction candidate: "${match.ngram}" → "${term}" (×${candidate.count})`);

			// Promote after 2 occurrences
			if (candidate.count >= 2) {
				this._correctionCandidates.delete(key);
				this._matcher.addCorrection(key, term);
				window.electronAPI.addCorrection(key, term);
				console.log(`[Vocab] AUTO-LEARNED: "${key}" → "${term}"`);
			}
		}
	}

	async start() {
		this._apiKey = await window.electronAPI.getApiKey();
		if (!this._apiKey || this._apiKey === 'YOUR_API_KEY_HERE') {
			this._updateStatus('No API key — set GEMINI_API_KEY in .env');
			return;
		}

		await this._loadVocabulary();
		// Periodic vocab refresh to pick up background changes (auto-extraction, hot promotion)
		this._vocabRefreshInterval = setInterval(() => this._loadVocabulary(), 60000);
		this._bindEvents();

		// Listen for Ctrl+I toggle
		window.electronAPI.onToggleVoice(() => this.toggle());

		// Proactive reply on messaging app focus
		window.electronAPI.onMessagingAppFocused((app) => this._onMessagingAppFocused(app));
		window.electronAPI.onMessagingAppLeft(() => { this._lastReplyPromptTime = 0; });

		await this._activate();
	}

	_bindEvents() {
		// Gemini events
		this.gemini.on('connected', () => {
			this._updateIndicator('ws', true);
			this._updateStatus('WebSocket connected, setting up...');
		});

		this.gemini.on('ready', async () => {
			this._updateStatus('Session ready — starting mic');
			try {
				await this.capture.start();
			} catch (err) {
				console.error('[Voice] Mic error:', err);
				this._updateStatus('Mic error: ' + err.message);
			}
			this._startScreenCapture();
		});

		this.gemini.on('disconnected', () => {
			this._updateIndicator('ws', false);
			this._updateIndicator('send', false);
			this._updateStatus('Disconnected');
			this._setState(STATES.IDLE);
		});

		this.gemini.on('error', (err) => {
			this._updateStatus('Error: ' + (err.message || 'WebSocket error'));
		});

		this.gemini.on('maxRetriesReached', () => {
			this._updateStatus('Max retries reached — reload to reconnect');
		});

		this.gemini.on('audio', (data) => {
			// First audio chunk of a response — save user turn then reset
			if (this.state !== STATES.RESPONDING) {
				if (this._accum.user) this._lastUserTurn = this._accum.user;
				this._accum.user = '';
			}
			this._setState(STATES.RESPONDING);
			this.playback.enqueue(data);
		});

		this.gemini.on('inputTranscription', (text) => {
			this._appendTranscript('user', text);
			this._updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			this._appendTranscript('model', text);
		});

		this.gemini.on('turnComplete', () => {
			this._setState(STATES.LISTENING);
			this._updateIndicator('think', false);
			// Scan model turn for vocabulary before clearing
			if (this._accum.model) this._scanVocabulary(this._accum.model);
			// Auto-learn corrections from user STT vs model vocabulary usage
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

		// Capture events
		this.capture.on('started', () => {
			this._updateIndicator('mic', true);
			this._updateIndicator('send', true);
			this._setState(STATES.LISTENING);
			this._updateStatus('Listening...');
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
			this._updateIndicator('mic', false);
			this._updateIndicator('send', false);
		});

		// Playback events
		this.playback.on('started', () => {
			this._updateIndicator('speak', true);
		});

		this.playback.on('ended', () => {
			this._updateIndicator('speak', false);
			if (this.state === STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
		});

		this.playback.on('stopped', () => {
			this._updateIndicator('speak', false);
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
		this._updateStatus('Connecting...');
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
		// Reset all indicators
		for (const id of ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool', 'srch']) {
			this._updateIndicator(id, false);
		}
		// Hide bubbles and search overlay
		document.getElementById('bubble-user')?.classList.remove('visible');
		document.getElementById('bubble-iris')?.classList.remove('visible');
		window.electronAPI.searchHide();
		this._updateStatus('Voice off (Ctrl+I to enable)');
	}

	getSpeakingVolume() {
		return this.playback.getVolume();
	}

	_setState(state) {
		const prev = this.state;
		this.state = state;

		// VAD-triggered screen capture: send when user starts speaking
		if (prev === STATES.LISTENING && state === STATES.USER_SPEAKING) {
			this._sendScreenFrame();
		}

		// Update indicators based on state
		this._updateIndicator('voice', state === STATES.USER_SPEAKING);
		this._updateIndicator('think', state === STATES.PROCESSING);
		this._updateIndicator('speak', state === STATES.RESPONDING);
	}

	_updateIndicator(id, active) {
		const el = document.getElementById(`dbg-${id}`);
		if (el) el.classList.toggle('active', active);
	}

	_updateStatus(text) {
		const el = document.getElementById('dbg-status');
		if (el) el.textContent = text;
	}

	_appendTranscript(who, chunk) {
		if (!chunk) return;
		const now = Date.now();
		const gap = now - this._lastTranscriptTime[who];

		// New turn: large time gap, or accumulator was reset
		if (gap > this._newTurnThresholdMs || !this._accum[who]) {
			// Scan previous turn's text for vocabulary hits before resetting
			if (this._accum[who]) this._scanVocabulary(this._accum[who]);
			this._accum[who] = chunk;
		} else {
			this._accum[who] += chunk;
		}
		this._lastTranscriptTime[who] = now;

		// Update DOM with vocabulary-corrected text
		const el = document.getElementById(`dbg-${who}-text`);
		if (el) el.textContent = this._correctTranscript(this._accum[who]);

		const bubbleId = who === 'user' ? 'bubble-user' : 'bubble-iris';
		const bubble = document.getElementById(bubbleId);
		if (bubble) {
			bubble.classList.add('visible');
			const key = `_hide_${who}`;
			clearTimeout(this[key]);
			this[key] = setTimeout(() => bubble.classList.remove('visible'), 8000);
		}
	}

	_showSearchOverlay(query, content) {
		window.electronAPI.searchResult(query, content);
	}

	_showSearchSpinner(query) {
		window.electronAPI.searchSpinner(query);
	}

	async _handleToolCalls(calls) {
		this._setState(STATES.TOOL_EXECUTING);
		this._toolExecuting = true;
		this._updateIndicator('tool', true);

		for (let i = 0; i < calls.length; i++) {
			const { name, args, id } = calls[i];
			// Delay between sequential tool calls so web apps can process
			if (i > 0) await new Promise(r => setTimeout(r, 200));

			// Show search spinner for web_search
			if (name === 'web_search') {
				this._showSearchSpinner(args.query || 'Searching...');
				this._updateIndicator('srch', true);
			}

			try {
				const result = await window.electronAPI.executeTool(name, args);
				this.gemini.sendToolResponse(id, name, result.result || 'done');

				// Display search results in overlay
				if (name === 'web_search') {
					this._updateIndicator('srch', false);
					if (result.ok) {
						this._showSearchOverlay(args.query || 'Search', result.result);
					} else {
						this._showSearchOverlay(args.query || 'Search', result.result || 'Search failed');
					}
				}
			} catch (err) {
				this.gemini.sendToolResponse(id, name, 'Error: ' + err.message);
				if (name === 'web_search') {
					this._updateIndicator('srch', false);
					this._showSearchOverlay(args.query || 'Search', 'Error: ' + err.message);
				}
			}
		}

		// Hot-reload vocabulary if it was modified by a tool
		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			await this._loadVocabulary();
			this.gemini.sendVocabUpdate();
		}

		await this._sendScreenFrame();

		this._toolExecuting = false;
		this._updateIndicator('tool', false);
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

		// Send a fresh screenshot so Gemini sees the conversation
		try {
			const capture = await window.electronAPI.captureScreen();
			if (capture?.ok && capture.data) {
				this.gemini.sendImage(capture.data);
			}
		} catch {}

		// Nudge Gemini to proactively suggest a reply
		this.gemini.sendText(
			`The user just switched to ${app}. Look at the screen — if there's an unread message or ongoing conversation visible, proactively suggest a reply using the propose_reply tool. Be natural, match the conversation tone, and keep it brief. If there's nothing to reply to, stay silent.`
		);
	}
}
