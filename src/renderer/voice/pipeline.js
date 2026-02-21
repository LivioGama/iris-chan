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
import { showActivity, hideActivity } from '../ui/activity-panel.js';
import { showPanel as showToolsPanel, hidePanel as hideToolsPanel } from '../ui/tools-skills-panel.js';
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
		this._echoSuppressionGain = 0.8; // 80% suppression (balanced default)
		this._muted = false;
		this._autonomousMode = false;
		this._autonomousInterval = null;
		this._consecutiveAutoTurns = 0;
		this._lastAutonomousPromptTime = 0;

		// Wire playback reference signals to capture for echo cancellation
		this.playback.setReferenceCallback((float32Samples) => {
			// Always send reference signal if suppression is enabled
			// Capture will only process it if it's active
			if (this._echoSuppressionEnabled) {
				this.capture.sendReferenceSignal(float32Samples);
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

			const threshold = Math.ceil(term.length * 0.4);
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
		window.electronAPI.onToggleAutonomous(() => this.toggleAutonomous());
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
			showToolsPanel();
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
			if (this._muted) return;
			// Suppress unprompted responses — if user hasn't spoken since last
			// turn completed, Gemini is talking to itself (loop). Drop the audio.
			if (this._unpromptedTurnCount >= 1 && !this._autonomousMode) return;
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
			if (this._muted) return;
			this._appendTranscript('user', text);
			updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			if (this._muted) return;
			if (this._unpromptedTurnCount >= 1 && !this._autonomousMode) return;
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
			if (!this._autonomousMode) {
				const timeSinceUserSpoke = Date.now() - this._lastUserSpeechTime;
				if (timeSinceUserSpoke > 3000) {
					this._unpromptedTurnCount++;
					logInfo('Voice', `Unprompted turn #${this._unpromptedTurnCount} (${Math.round(timeSinceUserSpoke / 1000)}s since user spoke)`);
					if (this._unpromptedTurnCount >= 1) {
						logInfo('Voice', 'Idle loop detected \u2014 pausing passive screen captures');
						this._stopScreenCapture();
					}
				} else {
					this._unpromptedTurnCount = 0;
				}
			} else {
				// In autonomous mode: track turn completion for cooldown
				this._lastAutonomousPromptTime = Date.now();
				const timeSinceUserSpoke = Date.now() - this._lastUserSpeechTime;
				if (timeSinceUserSpoke < 5000) {
					this._consecutiveAutoTurns = 0;
				}
			}
		});

		this.gemini.on('interrupted', () => {
			this.playback.stop();
			hideActivity();
			this._setState(STATES.LISTENING);
			logInfo('Voice', 'User interrupted — playback stopped');
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
			if (this._muted) return;
			// Only send mic audio when user is actively speaking or just stopped.
			const send = this.state === STATES.USER_SPEAKING || this.state === STATES.PROCESSING;
			if (send && !this._toolExecuting) {
				this.gemini.sendAudio(base64);
			}
		});

		this.capture.on('volume', (vol) => {
			this.lastVolume = vol;
			if (vol > this.volumeThreshold && this.state === STATES.LISTENING) {
				this._setState(STATES.USER_SPEAKING);
			} else if (vol > this.volumeThreshold && this.state === STATES.RESPONDING) {
				// Full-duplex: user speaking over Iris — stop playback immediately
				logInfo('Voice', 'User speaking during response — interrupting');
				this.playback.stop();
				hideActivity();
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
		const wasAutonomous = this._autonomousMode;
		this.capture.stop();
		this.playback.stop();
		this.gemini.disconnect();
		updateStatus('Reconnecting...');
		await this.gemini.connect(this._apiKey);
		// Re-inject autonomous mode after reconnection
		if (wasAutonomous && this._autonomousMode) {
			this.gemini.sendText('[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED]\nYour idle silence rules are SUSPENDED. You are now in autonomous mode. Proactively suggest tasks, ask what to work on, and take initiative. Do not wait for the user to speak first.');
		}
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

	toggleMute() {
		this._muted = !this._muted;
		if (this._muted) {
			this.playback.stop();
			hideBubbles();
		}
		logInfo('Voice', `Mute ${this._muted ? 'ON' : 'OFF'}`);
		return this._muted;
	}

	get muted() {
		return this._muted;
	}

	toggleAutonomous() {
		this._autonomousMode = !this._autonomousMode;
		const badge = document.getElementById('auto-badge');
		if (badge) badge.classList.toggle('visible', this._autonomousMode);
		updateIndicator('auto', this._autonomousMode);

		if (this._autonomousMode) {
			logInfo('Voice', 'Autonomous mode ACTIVATED');
			// Inject mode change into Gemini conversation
			this.gemini.sendText(
				'[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED]\n' +
				'Your idle silence rules are SUSPENDED. You are now in autonomous mode. ' +
				'Proactively ask what to work on, suggest improvements, and take initiative. ' +
				'Do not wait for the user to speak first. When you have nothing specific to do, ' +
				'ask the user what they would like you to work on.'
			);
			// Ensure screen captures are running (Iris needs visual context)
			if (!this._screenInterval && this._active) {
				this._startScreenCapture();
			}
			this._consecutiveAutoTurns = 0;
			this._startAutonomousLoop();
		} else {
			logInfo('Voice', 'Autonomous mode DEACTIVATED');
			this._stopAutonomousLoop();
			this._consecutiveAutoTurns = 0;
			// Re-inject silence rules
			this.gemini.sendText(
				'[SYSTEM: MODE CHANGE — AUTONOMOUS MODE DEACTIVATED]\n' +
				'Idle silence rules are RESTORED. Return to normal behavior: only respond when the user speaks to you. ' +
				'Do NOT proactively speak or ask questions.'
			);
		}
	}

	_startAutonomousLoop() {
		this._stopAutonomousLoop();
		this._autonomousInterval = setInterval(() => {
			if (!this._autonomousMode || !this._active || this._muted) return;
			if (this.state !== STATES.LISTENING) return;
			if (this._toolExecuting) return;

			// Cooldown: wait at least 15s after last Gemini turn
			const timeSinceTurn = Date.now() - this._lastAutonomousPromptTime;
			if (timeSinceTurn < 15000) return;

			// Auto-disable after max consecutive auto turns without user speech
			if (this._consecutiveAutoTurns >= 3) {
				logInfo('Voice', 'Autonomous mode auto-disabled (3 consecutive turns without user speech)');
				this.toggleAutonomous(); // will flip it off
				return;
			}

			this._consecutiveAutoTurns++;
			logInfo('Voice', `Autonomous prompt #${this._consecutiveAutoTurns}`);

			// Send fresh screenshot + autonomous prompt
			this._sendScreenFrame().then(() => {
				if (this._autonomousMode) {
					this.gemini.sendText(
						'[AUTONOMOUS PROMPT] You are in autonomous mode. Look at the current screen, consider the context, ' +
						'and either continue working on the current task, suggest an improvement, or ask the user what to do next. ' +
						'Be concise and actionable.'
					);
				}
			});
		}, 60000);
	}

	_stopAutonomousLoop() {
		if (this._autonomousInterval) {
			clearInterval(this._autonomousInterval);
			this._autonomousInterval = null;
		}
	}

	_deactivate() {
		this._active = false;
		this._toolExecuting = false;
		this._stopAutonomousLoop();
		this._autonomousMode = false;
		this._consecutiveAutoTurns = 0;
		const autoBadge = document.getElementById('auto-badge');
		if (autoBadge) autoBadge.classList.remove('visible');
		updateIndicator('auto', false);
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
		hideToolsPanel();
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
			this._consecutiveAutoTurns = 0;
			// Resume passive screen captures if they were paused
			if (!this._screenInterval && this._active) {
				logInfo('Voice', 'User speaking — resuming passive screen captures');
				this._startScreenCapture();
			}
		}

		updateIndicator('voice', state === STATES.USER_SPEAKING);
		updateIndicator('think', state === STATES.PROCESSING);
		updateIndicator('speak', state === STATES.RESPONDING);

		// Activity panel updates
		if (state === STATES.PROCESSING) showActivity('\u2728 Thinking...');
		else if (state === STATES.TOOL_EXECUTING) { /* tool name shown in _handleToolCalls */ }
		else if (state === STATES.LISTENING && prev !== STATES.IDLE) hideActivity();
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
			const toolLabel = this._isSearchTool(name, args)
				? `\uD83D\uDD0D ${name}: ${(args?.query || args?.prompt || '').slice(0, 40)}`
				: `\u2699\uFE0F ${name}`;
			showActivity(toolLabel);
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
		// IDLE SILENCE: Completely disabled unprompted messaging.
		// Iris remains silent unless the user explicitly speaks or sends context.
		// This prevents conversational looping and "how can I help?" type responses.
		return;
	}
}
