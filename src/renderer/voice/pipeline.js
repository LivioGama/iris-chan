// State machine orchestration (delegates to sub-modules)

import { GeminiClient } from '../gemini/client.js';
import { AudioCapture } from './capture.js';
import { AudioPlayback } from './playback.js';
import { VocabMatcher } from '../vocab/matcher.js';
import { findBestNgram } from '../vocab/learner.js';
import { updateIndicator, updateStatus } from '../ui/debug-panel.js';
import { showBubble, hideBubbles } from '../ui/bubbles.js';
import { showToolStart, showToolDone, hideToolLog } from '../ui/tool-log.js';
import { refreshWorkspace, updateIfWorkspaceTool } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';

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
		this.needsReconnect = false;
		this._lastUserSpeechTime = 0;
		this._unpromptedTurnCount = 0;
		this._echoSuppressionEnabled = true;
		this._echoSuppressionGain = 1.0; // Maximum suppression

		// Wire playback reference signals to capture for echo cancellation
		this.playback.setReferenceCallback((float32Samples) => {
			// Always send reference signal if suppression is enabled
			// Capture will only process it if it's active
			if (this._echoSuppressionEnabled) {
				this.capture.sendReferenceSignal(float32Samples);
				logInfo('Echo', `Ref signal sent: ${float32Samples.length} samples`);
			}
		});
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
			logInfo('Vocab', `Matcher built: ${allTerms.length} terms, ${corrCount} corrections`);
		} catch (err) {
			logError('Vocab', 'Failed to load vocabulary:', err);
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
			logInfo('Vocab', `FIXED: ${JSON.stringify(text)} → ${JSON.stringify(result)}`);
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
			logInfo('Vocab', `Correction candidate: "${match.ngram}" → "${term}" (×${candidate.count})`);

			if (candidate.count >= 2) {
				this._correctionCandidates.delete(key);
				this._matcher.addCorrection(key, term);
				window.electronAPI.addCorrection(key, term);
				logInfo('Vocab', `AUTO-LEARNED: "${key}" → "${term}"`);
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
		refreshWorkspace();
		this._bindEvents();

		window.electronAPI.onToggleVoice(() => this.toggle());
		window.electronAPI.onMessagingAppFocused((app) => this._onMessagingAppFocused(app));
		window.electronAPI.onMessagingAppLeft(() => { this._lastReplyPromptTime = 0; });
		window.electronAPI.onReloadSession(() => {
			if (this._active) this.reconnect();
		});

		await this._activate();
	}

	_bindEvents() {
		this.gemini.on('connected', () => {
			updateIndicator('ws', true);
			updateStatus('WebSocket connected, setting up...');
			window.electronAPI.newConvexSession();
		});

		this.gemini.on('ready', async () => {
			updateStatus('Session ready \u2014 starting mic');
			this.capture.stop();
			this.playback.stop();
			try {
				await this.capture.start();
			} catch (err) {
				logError('Voice', 'Mic error:', err);
				updateStatus('Mic error: ' + err.message);
			}
			this._startScreenCapture();
		});

		this.gemini.on('disconnected', () => {
			updateIndicator('ws', false);
			updateIndicator('send', false);
			updateStatus('Disconnected \u2014 reconnecting...');
			this._setState(STATES.IDLE);
		});

		this.gemini.on('error', (err) => {
			updateStatus('Error: ' + (err.message || 'WebSocket error'));
		});

		this.gemini.on('maxRetriesReached', () => {
			this.needsReconnect = true;
			updateStatus('Disconnected \u2014 click Iris to reconnect');
		});

		this.gemini.on('audio', (data) => {
			if (this.state !== STATES.RESPONDING) {
				if (this._accum.user) {
					logInfo('Conversation', `[USER] ${this._accum.user}`);
					this._lastUserTurn = this._accum.user;
				}
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
			if (this._accum.model) {
				logInfo('Conversation', `[IRIS] ${this._accum.model}`);
				this._scanVocabulary(this._accum.model);
			}
			if (this._lastUserTurn) {
				window.electronAPI.saveConversationTurn('user', this._lastUserTurn);
			}
			if (this._accum.model) {
				window.electronAPI.saveConversationTurn('iris', this._accum.model);
			}
			if (this._lastUserTurn && this._accum.model) {
				this._learnCorrections(this._lastUserTurn, this._accum.model);
			}
			this._accum.model = '';

			// Idle loop prevention: if the user hasn't spoken recently and
			// the model keeps producing turns, pause passive screen captures
			// to stop feeding it visual input that triggers more responses.
			const timeSinceUserSpoke = Date.now() - this._lastUserSpeechTime;
			if (timeSinceUserSpoke > 30000) {
				this._unpromptedTurnCount++;
				if (this._unpromptedTurnCount >= 2) {
					logInfo('Voice', `Idle loop detected (${this._unpromptedTurnCount} unprompted turns, ${Math.round(timeSinceUserSpoke / 1000)}s idle) — pausing passive screen captures`);
					this._stopScreenCapture();
				}
			} else {
				this._unpromptedTurnCount = 0;
			}
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
			// Configure echo suppression
			this.capture.setEchoSuppression(this._echoSuppressionEnabled);
			this.capture.setSuppressionGain(this._echoSuppressionGain);
			logInfo('Echo', `Echo cancellation active (browser AEC + software suppression at ${(this._echoSuppressionGain * 100).toFixed(0)}%)`);
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
			// Notify capture that playback has ended (for echo suppression)
			this.capture.notifyPlaybackStop();
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

	async reconnect() {
		this.needsReconnect = false;
		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		this.capture.stop();
		this.playback.stop();
		this.gemini.disconnect();
		updateStatus('Reconnecting...');
		await this.gemini.connect(this._apiKey);
	}

	async _activate() {
		this._active = true;
		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		updateStatus('Connecting...');
		await this.gemini.connect(this._apiKey);
	}

	// Control echo suppression (software-based, in addition to browser AEC)
	setEchoSuppressionEnabled(enabled) {
		this._echoSuppressionEnabled = !!enabled;
		this.capture.setEchoSuppression(this._echoSuppressionEnabled);
		logInfo('Echo', `Echo suppression ${enabled ? 'enabled' : 'disabled'}`);
	}

	// Set suppression aggressiveness (0-1, where 1 is most aggressive)
	setEchoSuppressionGain(gain) {
		this._echoSuppressionGain = Math.max(0, Math.min(1, gain));
		this.capture.setSuppressionGain(this._echoSuppressionGain);
		logInfo('Echo', `Echo suppression gain set to ${(this._echoSuppressionGain * 100).toFixed(0)}%`);
	}

	getEchoSuppressionEnabled() {
		return this._echoSuppressionEnabled;
	}

	getEchoSuppressionGain() {
		return this._echoSuppressionGain;
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
		window.electronAPI.endSession?.();
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

		// Track user speech activity for idle loop prevention
		if (state === STATES.USER_SPEAKING) {
			this._lastUserSpeechTime = Date.now();
			this._unpromptedTurnCount = 0;
			// Resume passive screen captures if they were paused
			if (!this._screenInterval && this._active) {
				logInfo('Voice', 'User speaking — resuming passive screen captures');
				this._startScreenCapture();
			}
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

	_isSearchTool(name, args) {
		if (name === 'web_search' || name === 'ask_chatgpt' || name === 'research') return true;
		if (name === 'run_terminal_command') {
			const cmd = (args?.command || '').toLowerCase();
			if (cmd.includes('search.py') || cmd.includes('perplexity')) return true;
		}
		if (name.includes('search')) return true;
		return false;
	}

	_searchLabel(name, args) {
		if (name === 'web_search') return args?.query || 'Searching...';
		if (name === 'ask_chatgpt') return args?.prompt || 'Asking ChatGPT...';
		if (name === 'research') return args?.query || 'Deep researching...';
		if (name === 'run_terminal_command') {
			const m = (args?.command || '').match(/search\.py\s+["']([^"']+)["']/);
			return m ? m[1] : 'Searching...';
		}
		return args?.query || 'Searching...';
	}

	async _handleToolCalls(calls) {
		this._setState(STATES.TOOL_EXECUTING);
		this._toolExecuting = true;
		updateIndicator('tool', true);

		for (let i = 0; i < calls.length; i++) {
			const { name, args, id } = calls[i];
			if (i > 0) await new Promise(r => setTimeout(r, 200));

			showToolStart(name, args, i, calls.length);
			logInfo('Tool', `Executing: ${name}(${JSON.stringify(args || {})})`.slice(0, 500));

			const isSearch = this._isSearchTool(name, args);
			if (isSearch) {
				window.electronAPI.searchSpinner(this._searchLabel(name, args));
				updateIndicator('srch', true);
			}

			const toolStart = Date.now();
			try {
				const result = await window.electronAPI.executeTool(name, args);
				showToolDone(name, i, result.ok !== false);
				updateIfWorkspaceTool(name);
				logInfo('Tool', `Result: ${name} → ${result.ok !== false ? 'OK' : 'FAIL'}: ${(result.result || 'done').slice(0, 300)}`);
				this.gemini.sendToolResponse(id, name, result.result || 'done');
				window.electronAPI.saveToolExecution(name, args, result.result || 'done', result.ok !== false, Date.now() - toolStart);

				if (isSearch) {
					updateIndicator('srch', false);
					window.electronAPI.searchResult(this._searchLabel(name, args), result.ok ? result.result : (result.result || 'Search failed'));
				}
			} catch (err) {
				showToolDone(name, i, false);
				logError('Tool', `Error: ${name} → ${err.message}`);
				this.gemini.sendToolResponse(id, name, 'Error: ' + err.message);
				window.electronAPI.saveToolExecution(name, args, err.message, false, Date.now() - toolStart);
				if (isSearch) {
					updateIndicator('srch', false);
					window.electronAPI.searchResult(this._searchLabel(name, args), 'Error: ' + err.message);
				}
			}
		}

		hideToolLog();

		if (calls.some(c => c.name === 'manage_vocabulary' && (c.args?.action === 'add' || c.args?.action === 'remove'))) {
			await this._loadVocabulary();
			this.gemini.sendVocabUpdate();
		}

		await this._sendScreenFrame();

		this._toolExecuting = false;
		updateIndicator('tool', false);
		this._setState(STATES.LISTENING);
	}

	async _sendScreenFrame(passive = false) {
		try {
			const capture = await window.electronAPI.captureScreen();
			if (capture?.ok && capture.data) {
				// Only send context text for active captures (user speaking, post-tool).
				// Periodic captures send the image silently to avoid triggering a response.
				if (!passive && capture.context) {
					const ctx = capture.context;
					this.gemini.sendText(`[SCREEN CONTEXT] Image: ${ctx.imageWidth}x${ctx.imageHeight}px, Display: ${ctx.displayWidth}x${ctx.displayHeight}, Scale: ${ctx.scaleFactor}x, Cursor: (${ctx.cursorX}, ${ctx.cursorY}). IMPORTANT: Use the IMAGE pixel coordinates (from ${ctx.imageWidth}x${ctx.imageHeight} image) directly for mouse_move, click_at, and drag. The image shows exactly what is at each pixel location.`);
				}
				this.gemini.sendImage(capture.data);
			}
		} catch (err) {
			logError('Voice', 'Screen capture error:', err);
		}
	}

	_startScreenCapture() {
		this._stopScreenCapture();
		this._sendScreenFrame();
		this._screenInterval = setInterval(() => {
			if (!this._toolExecuting && this._active) {
				this._sendScreenFrame(true); // passive: image only, no turn trigger
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
