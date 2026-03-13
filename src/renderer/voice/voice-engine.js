import { Emitter } from '../../shared/emitter.js';
import { EVENT_TYPES } from '../../shared/event-types.web.js';
import { cleanTranscript, shouldDropTranscript } from './transcription-policy.js';
import { createToolCallHandler } from './tool-call-handler.js';
import { createScreenCaptureController } from './screen-capture-controller.js';
import { createClaudeCodeBatcher } from './claude-code-batcher.js';
import { BargeInDetector } from './barge-in-detector.js';
import { ListeningGate } from './listening-gate.js';
import { VocabMatcher } from '../vocab/matcher.js';
import { findBestNgram } from '../vocab/learner.js';
import {
	addRecentSeenTerms,
	configureRecentSeenStore,
	findRecentSeenRewrite,
	setRecentSeenKnownTerms,
} from '../vocab/recent-seen-store.js';
import { showBubble, clearBubbles, showStreamingBubble, finalizeStreamingBubble } from '../ui/bubbles.js';
import { setPresence, clearPresence, clearAllPresence } from '../ui/presence-indicator.js';
import { updateIndicator } from '../ui/status-indicators.js';
import { refreshWorkspace } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';

const STATES = {
	IDLE: 'IDLE',
	LISTENING: 'LISTENING',
	USER_SPEAKING: 'USER_SPEAKING',
	PROCESSING: 'PROCESSING',
	RESPONDING: 'RESPONDING',
	TOOL_EXECUTING: 'TOOL_EXECUTING',
};

const AUTONOMOUS_LOOP_INTERVAL_MS = 600000;
const FLASH_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const DEFAULT_VOICE_CONFIG = Object.freeze({
	modelVoiceName: null,
	speechProfile: Object.freeze({
		playbackRate: 0.93,
		pitchSemitones: -2.6,
		lowShelfFrequencyHz: 170,
		lowShelfGainDb: 3.4,
		warmthFrequencyHz: 280,
		warmthGainDb: 2.6,
		warmthQ: 0.9,
		presenceFrequencyHz: 2100,
		presenceGainDb: 0.9,
		presenceQ: 0.7,
		highShelfFrequencyHz: 4800,
		highShelfGainDb: 0.4,
		outputGain: 1.05,
		compressorThresholdDb: -22,
		compressorKneeDb: 8,
		compressorRatio: 2.8,
		compressorAttackSeconds: 0.003,
		compressorReleaseSeconds: 0.22,
	}),
	volumeThreshold: 0.015,
	screenCaptureInterval: 10000,
	newTurnThresholdMs: 3000,
	replyCooldownMs: 45000,
	speechReleaseMs: 160,
	echoSuppressionGain: 0.8,
	recentSeen: {
		ttlMs: 30000,
		maxTerms: 24,
		extractIntervalMs: 10000,
		minConfidence: 0.6,
		rewriteDistance: 3,
		persistEnabled: true,
	},
	listeningGate: {
		minSpeechMs: 180,
		candidateGapMs: 90,
		preRollMs: 450,
		noiseFloorAttack: 0.22,
		noiseFloorRelease: 0.05,
		noiseFloorMultiplier: 1.8,
		noiseFloorOffset: 0.02,
		frameMsFallback: 32,
	},
	bargeIn: {
		minRespondingThreshold: 0.04,
		minSpeechMs: 180,
		candidateGapMs: 90,
		preRollMs: 450,
		playbackDominanceRatio: 0.35,
		settleMs: 120,
		noiseFloorAttack: 0.22,
		noiseFloorRelease: 0.05,
		noiseFloorMultiplier: 1.6,
		noiseFloorOffset: 0.012,
		frameMsFallback: 32,
	},
});

function buildVoiceConfig(voiceConfig = {}) {
	const overrides = voiceConfig && typeof voiceConfig === 'object' ? voiceConfig : {};
	return {
		...DEFAULT_VOICE_CONFIG,
		...overrides,
		listeningGate: {
			...DEFAULT_VOICE_CONFIG.listeningGate,
			...(overrides.listeningGate || {}),
		},
		bargeIn: {
			...DEFAULT_VOICE_CONFIG.bargeIn,
			...(overrides.bargeIn || {}),
		},
		recentSeen: {
			...DEFAULT_VOICE_CONFIG.recentSeen,
			...(overrides.recentSeen || {}),
		},
		speechProfile: {
			...DEFAULT_VOICE_CONFIG.speechProfile,
			...(overrides.speechProfile || {}),
		},
	};
}

export class VoiceEngine extends Emitter {
	constructor({ gemini, capture, playback, behavior, eventBus, vocab, screen, claudeCodeBatcher, voiceConfig }) {
		super();
		this.gemini = gemini;
		this.capture = capture;
		this.playback = playback;
		this.behavior = behavior;
		this.eventBus = eventBus;
		this.voiceConfig = buildVoiceConfig(voiceConfig);
		this.state = STATES.IDLE;
		this._active = false;
		this._apiKey = null;
		this._muted = false;
		this._toolExecuting = false;
		this.needsReconnect = false;

		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		this._idleMessageSent = false;

		this._accum = { user: '', model: '' };
		this._lastTranscriptTime = { user: 0, model: 0 };
		this._newTurnThresholdMs = this.voiceConfig.newTurnThresholdMs;
		this._lastUserTurn = '';
		this.volumeThreshold = this.voiceConfig.volumeThreshold;
		this._listeningGate = new ListeningGate({
			activationThreshold: this.volumeThreshold,
			...this.voiceConfig.listeningGate,
		});
		this._bargeIn = new BargeInDetector({
			activationThreshold: this.volumeThreshold,
			...this.voiceConfig.bargeIn,
		});
		this._dropModelOutputUntilTurnComplete = false;
		this._speechReleaseTimer = null;
		this._speechReleaseMs = this.voiceConfig.speechReleaseMs;
		this._echoSuppressionGain = this.voiceConfig.echoSuppressionGain;
		this._lastSpeechEnergyAt = 0;
		this._turnLatency = null;

		this._autonomousMode = false;
		this._autonomousInterval = null;
		this._consecutiveAutoTurns = 0;
		this._lastAutonomousPromptTime = 0;
		this._autonomousResponseExpected = false;
		this._proactiveResponseExpected = false;
		this._proactivePromptedAt = 0;

		this._matcher = vocab || new VocabMatcher();
		this._correctionCandidates = new Map();
		this._vocabRefreshInterval = null;
		this._recentSeenExtractInFlight = null;
		this._lastRecentSeenExtractAt = 0;

		this._screen = screen || createScreenCaptureController({
			gemini,
			onEvent: (type, payload) => this.eventBus?.emitEvent?.(type, payload, 'voice-engine'),
		});
		this._unsubscribeScreenCapture = this._screen?.onCapture?.((captureFrame) => {
			this._handleScreenCapture(captureFrame);
		}) || null;
		configureRecentSeenStore(this.voiceConfig.recentSeen);

		this._batcher = claudeCodeBatcher || createClaudeCodeBatcher({ gemini, screen: this._screen });

		this._toolHandler = createToolCallHandler({
			gemini,
			onStateChange: (state, active) => {
				if (state === 'TOOL_EXECUTING') {
					this._toolExecuting = active;
					updateIndicator('tool', active);
					if (active) {
						this._setState(STATES.TOOL_EXECUTING);
					} else {
						this._setState(STATES.LISTENING);
					}
				}
			},
			onEvent: (type, payload) => {
				if (type === 'VOCAB_CHANGED') {
					this.loadVocabulary().then(() => this.gemini.sendVocabUpdate());
				}
				this.eventBus?.emitEvent?.(type, payload, 'voice-engine');
			},
			screen: this._screen,
		});
		this._toolHandler.setShouldAcceptToolCalls(() => this._shouldAcceptModelToolCalls());

		this.playback.setReferenceCallback((float32Samples) => {
			this.capture.sendReferenceSignal(float32Samples);
		});
		if (typeof this.gemini?.setVoiceName === 'function') {
			this.gemini.setVoiceName(this.voiceConfig.modelVoiceName);
		}
		if (typeof this.playback?.setSpeechProfile === 'function') {
			this.playback.setSpeechProfile(this.voiceConfig.speechProfile);
		}

		this._bind();
	}

	_bind() {
		this.gemini.on('connected', () => {
			updateIndicator('ws', true);
			this._newConvexSession();
		});

		this.gemini.on('ready', async () => {
			this.capture.stop();
			this.playback.stop();
			if (typeof this.playback.init === 'function') {
				try {
					await this.playback.init();
				} catch (err) {
					logError('Playback', 'Warmup error:', err);
				}
			}
			try {
				await this.capture.start();
			} catch (err) {
				logError('Voice', 'Mic error:', err);
				}
				this._screen.start();
			});

		this.gemini.on('disconnected', () => {
			updateIndicator('ws', false);
			updateIndicator('send', false);
			clearPresence('voice');
			// Finalize any in-flight streaming bubbles so they don't hang forever
			finalizeStreamingBubble('stream-model');
			finalizeStreamingBubble('stream-user');
			this._clearSpeechReleaseTimer();
			this._resetTurnLatency();
			this._setState(STATES.IDLE);
		});

		this.gemini.on('maxRetriesReached', () => {
			this.needsReconnect = true;
		});

		this.gemini.on('audio', (data) => {
			if (this._muted) return;
			if (this._dropModelOutputUntilTurnComplete) return;
			if (!this._shouldAcceptModelOutput()) return;
			if (this.state !== STATES.RESPONDING) {
				if (this._accum.user) {
					const correctedUser = this._correctTranscript(this._accum.user);
					logInfo('Conversation', `[USER] ${correctedUser}`);
					this._lastUserTurn = correctedUser;
				}
				this._accum.user = '';
			}
			this._setState(STATES.RESPONDING);
			this._noteFirstModelAudio();
			this.playback.enqueue(data);
		});

		this.gemini.on('inputTranscription', (text) => {
			if (this._muted) return;
			this._appendTranscript('user', text);
			updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			if (this._muted) return;
			if (this._dropModelOutputUntilTurnComplete) return;
			if (!this._shouldAcceptModelOutput()) return;
			if (shouldDropTranscript(text)) return;
			this._appendTranscript('model', text);
		});

		this.gemini.on('turnComplete', () => {
			this._dropModelOutputUntilTurnComplete = false;
			this._clearSpeechReleaseTimer();
			this._setState(STATES.LISTENING);
			updateIndicator('think', false);
			// Finalize streaming bubbles so they start their auto-hide timers
			finalizeStreamingBubble('stream-model');
			finalizeStreamingBubble('stream-user');
			if (this._accum.model) {
				logInfo('Conversation', `[IRIS] ${this._accum.model}`);
				this._scanVocabulary(this._accum.model);
				this.behavior.noteAssistantSpoke(this._accum.model);
			}
			if (this._lastUserTurn) {
				this._saveConversationTurn('user', this._lastUserTurn);
			}
			if (this._accum.model) {
				this._saveConversationTurn('iris', this._accum.model);
			}
			if (this._lastUserTurn && this._accum.model) {
				this._learnCorrections(this._lastUserTurn, this._accum.model);
			}
			this._accum.model = '';
			this._lastUserTurn = '';
			this._resetTurnLatency();

			if (!this._autonomousMode) {
				if (this._proactiveResponseExpected) {
					this._proactiveResponseExpected = false;
					this._proactivePromptedAt = Date.now();
				} else {
					const timeSinceUserSpoke = Date.now() - this._lastUserSpeechTime;
					if (timeSinceUserSpoke > 3000) {
						this._unpromptedTurnCount++;
						logInfo('Voice', `Unprompted turn #${this._unpromptedTurnCount}`);
						if (this._unpromptedTurnCount >= 1) {
							this._idleMessageSent = true;
							this.behavior.noteIdleResponseSent();
							logInfo('Voice', 'Idle gate closed — blocking further idle output');
							this._screen.stop();
							this._screen.setIdleGateClosed(true);
						}
					} else {
						this._unpromptedTurnCount = 0;
					}
				}
			} else {
				this._autonomousResponseExpected = false;
				this._lastAutonomousPromptTime = Date.now();
				const timeSinceUserSpoke = Date.now() - this._lastUserSpeechTime;
				if (timeSinceUserSpoke < 5000) {
					this._consecutiveAutoTurns = 0;
				}
			}
		});

		this.gemini.on('interrupted', () => {
			this._dropModelOutputUntilTurnComplete = false;
			this.playback.stop();
			this._clearSpeechReleaseTimer();
			this._resetTurnLatency();
			this._setState(STATES.LISTENING);
			// Finalize the model bubble on interruption so it doesn't hang
			finalizeStreamingBubble('stream-model');
			logInfo('Voice', 'User interrupted — playback stopped');
		});

		this.gemini.on('toolCall', (calls) => this._toolHandler.handleToolCalls(calls));

		this.capture.on('started', () => {
			updateIndicator('mic', true);
			updateIndicator('send', true);
			this._setState(STATES.LISTENING);
			this.capture.setEchoSuppression(true);
			this.capture.setSuppressionGain(this._echoSuppressionGain);
			logInfo(
				'Echo',
				`Echo cancellation active (browser AEC + software suppression at ${Math.round(this._echoSuppressionGain * 100)}%)`
			);
		});

		this.capture.on('data', (base64) => {
			if (this._muted) return;
			// Only block audio for synchronous tool execution (not background tasks
			// like fix_project/self_fix which run async in main process)
			if (this._toolExecuting) return;
			if (this.state === STATES.RESPONDING) {
				this._bargeIn.bufferChunk(base64);
				return;
			}
			if (this.state !== STATES.IDLE) {
				this.gemini.sendAudio(base64);
			}
		});

		this.capture.on('volume', (reading) => {
			const meter = this._normalizeVolumeReading(reading);
			const now = Date.now();
			if (this.state === STATES.RESPONDING) {
				const playbackVolume = this.playback.getVolume();
				const gate = this._bargeIn.observeVolume({
					micVolume: meter.effective,
					playbackVolume,
					unstableEcho: meter.unstableEcho,
				});
				if (gate.confirmed) {
					this._confirmBargeIn('sustained speech', {
						heldMs: gate.heldMs,
						micVolume: meter.effective,
						rawMicVolume: meter.raw,
						residualMicVolume: meter.residual,
						playbackVolume,
						threshold: gate.threshold,
						noiseFloor: gate.noiseFloor,
						clippedRatio: meter.clippedRatio,
						unstableEcho: meter.unstableEcho,
					});
				}
				return;
			}

			if (meter.effective > this.volumeThreshold) {
				this._lastSpeechEnergyAt = now;
				this._clearSpeechReleaseTimer();
				if (this.state === STATES.LISTENING || this.state === STATES.PROCESSING) {
					this._setState(STATES.USER_SPEAKING);
				}
				return;
			}

			if (this.state === STATES.USER_SPEAKING) {
				this._scheduleSpeechRelease(now);
			}
		});

		this.capture.on('stopped', () => {
			updateIndicator('mic', false);
			updateIndicator('send', false);
		});

		this.playback.on('started', () => updateIndicator('speak', true));

		this.playback.on('ended', () => {
			updateIndicator('speak', false);
			this.capture.notifyPlaybackStop();
			if (this.state === STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
		});

		this.playback.on('stopped', () => {
			updateIndicator('speak', false);
			this.capture.notifyPlaybackStop();
			if (this.state === STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
		});
	}

	_shouldAcceptModelOutput() {
		if (this._proactiveResponseExpected) return true;
		if (!this._autonomousMode) {
			if (this._idleMessageSent) return false;
			if (this._unpromptedTurnCount >= 1) return false;
			const timeSinceUser = Date.now() - this._lastUserSpeechTime;
			if (timeSinceUser > 10000 && this.state !== STATES.RESPONDING) return false;
		} else {
			if (!this._autonomousResponseExpected && this.state !== STATES.RESPONDING) return false;
		}
		return true;
	}

	_shouldAcceptModelToolCalls() {
		if (this._dropModelOutputUntilTurnComplete) return false;
		if (this._proactiveResponseExpected) return false;
		return this._shouldAcceptModelOutput();
	}

	_setState(state) {
		if (this.state === state) return;
		const prev = this.state;
		this.state = state;

		if (!this._isListeningGateState(prev) && this._isListeningGateState(state)) {
			this._listeningGate.begin();
		} else if (this._isListeningGateState(prev) && !this._isListeningGateState(state)) {
			this._listeningGate.end();
		}

		if (prev !== STATES.RESPONDING && state === STATES.RESPONDING) {
			this._bargeIn.beginResponse();
		} else if (prev === STATES.RESPONDING && state !== STATES.RESPONDING) {
			this._bargeIn.endResponse();
		}

		if ((prev === STATES.LISTENING || prev === STATES.PROCESSING) && state === STATES.USER_SPEAKING) {
			this._screen.capture({ passive: false, force: true });
		}

		this._toolHandler?.setUserSpeechActive?.(state === STATES.USER_SPEAKING);

		if (state === STATES.USER_SPEAKING) {
			window.electronAPI.stopUiTask?.('User speech interrupted the foreground UI task').catch(() => {});
			if (prev === STATES.LISTENING || prev === STATES.RESPONDING || prev === STATES.IDLE) {
				this._beginTurnLatency();
			}
			this._lastUserSpeechTime = Date.now();
			this._lastSpeechEnergyAt = this._lastUserSpeechTime;
			this._screen.setLastUserSpeechTime(this._lastUserSpeechTime);
			this._unpromptedTurnCount = 0;
			this._consecutiveAutoTurns = 0;
			this._autonomousResponseExpected = true;
			this._proactiveResponseExpected = false;
			this.behavior.noteUserActivity();
			if (this._idleMessageSent) {
				logInfo('Voice', 'User speaking — resetting idle gate');
				this._idleMessageSent = false;
				this.behavior.resetIdleGate();
				this._screen.setIdleGateClosed(false);
			}
			if (!this._screen.isRunning && this._active) {
				logInfo('Voice', 'User speaking — resuming passive screen captures');
				this._screen.start();
			}
		}

		updateIndicator('voice', state === STATES.USER_SPEAKING);
		updateIndicator('think', state === STATES.PROCESSING);
		updateIndicator('speak', state === STATES.RESPONDING);

		if (state === STATES.PROCESSING) {
			setPresence('voice', 'thinking', {
				title: 'Thinking',
				detail: 'Working out the next response',
			});
		} else if (state === STATES.TOOL_EXECUTING) {
			setPresence('voice', 'thinking', {
				title: 'Working',
				detail: 'Using tools to make progress',
			});
		} else if (state === STATES.RESPONDING) {
			setPresence('voice', 'responding', {
				title: 'Replying',
				detail: 'Turning the answer into speech',
			});
		} else {
			clearPresence('voice');
		}
	}

	_scheduleSpeechRelease(now = Date.now()) {
		if (this._speechReleaseTimer) return;
		const remaining = Math.max(0, this._speechReleaseMs - (now - this._lastSpeechEnergyAt));
		this._speechReleaseTimer = setTimeout(() => {
			this._speechReleaseTimer = null;
			if (this.state !== STATES.USER_SPEAKING) return;
			if (Date.now() - this._lastSpeechEnergyAt < this._speechReleaseMs) {
				this._scheduleSpeechRelease();
				return;
			}
			this._setState(STATES.PROCESSING);
		}, remaining);
	}

	_clearSpeechReleaseTimer() {
		if (!this._speechReleaseTimer) return;
		clearTimeout(this._speechReleaseTimer);
		this._speechReleaseTimer = null;
	}

	_beginTurnLatency() {
		this._turnLatency = {
			userSpeechStartedAt: Date.now(),
			firstModelAudioAt: 0,
		};
	}

	_noteFirstModelAudio() {
		if (!this._turnLatency?.userSpeechStartedAt || this._turnLatency.firstModelAudioAt) return;
		this._turnLatency.firstModelAudioAt = Date.now();
		logInfo(
			'Latency',
			`Speech -> first audio chunk: ${this._turnLatency.firstModelAudioAt - this._turnLatency.userSpeechStartedAt}ms`
		);
	}

	_resetTurnLatency() {
		this._turnLatency = null;
	}

	_isListeningGateState(state = this.state) {
		return state === STATES.LISTENING || state === STATES.PROCESSING;
	}

	_flushAudioChunks(chunks) {
		for (const chunk of chunks) {
			this.gemini.sendAudio(chunk);
		}
	}

	_confirmListeningSpeech(reason, details = {}) {
		if (!this._isListeningGateState()) return;
		const bufferedChunks = this._listeningGate.confirm();
		logInfo(
			'Voice',
			`Local speech gate opened (${reason}, held=${details.heldMs ?? 0}ms, mic=${(details.micVolume || 0).toFixed(3)}, raw=${(details.rawMicVolume || 0).toFixed(3)}, residual=${(details.residualMicVolume || 0).toFixed(3)}, threshold=${(details.threshold || 0).toFixed(3)}, floor=${(details.noiseFloor || 0).toFixed(3)}, clipped=${(details.clippedRatio || 0).toFixed(3)})`
		);
		this._setState(STATES.USER_SPEAKING);
		this._flushAudioChunks(bufferedChunks);
	}

	_confirmBargeIn(reason, details = {}) {
		if (this.state !== STATES.RESPONDING) return;
		const bufferedChunks = this._bargeIn.confirm();
		this._dropModelOutputUntilTurnComplete = true;
		logInfo(
			'Voice',
			`User speaking during response — interrupting (${reason}, held=${details.heldMs ?? 0}ms, mic=${(details.micVolume || 0).toFixed(3)}, raw=${(details.rawMicVolume || 0).toFixed(3)}, residual=${(details.residualMicVolume || 0).toFixed(3)}, playback=${(details.playbackVolume || 0).toFixed(3)}, threshold=${(details.threshold || 0).toFixed(3)}, floor=${(details.noiseFloor || 0).toFixed(3)}, clipped=${(details.clippedRatio || 0).toFixed(3)}, unstableEcho=${details.unstableEcho ? 'yes' : 'no'})`
		);
		this.playback.stop();
		this._setState(STATES.USER_SPEAKING);
		this._flushAudioChunks(bufferedChunks);
	}

	_normalizeVolumeReading(reading) {
		if (typeof reading === 'number') {
			return {
				effective: reading,
				raw: reading,
				residual: reading,
				clippedRatio: 0,
				unstableEcho: false,
			};
		}

		return {
			effective: reading?.effective || 0,
			raw: reading?.raw || 0,
			residual: reading?.residual || 0,
			clippedRatio: reading?.clippedRatio || 0,
			unstableEcho: !!reading?.unstableEcho,
		};
	}

	_appendTranscript(who, chunk) {
		if (!chunk) return;
		const now = Date.now();
		const gap = now - this._lastTranscriptTime[who];

		if (gap > this._newTurnThresholdMs || !this._accum[who]) {
			// New turn — finalize the previous streaming bubble for this role
			if (this._accum[who]) {
				finalizeStreamingBubble(`stream-${who}`);
				this._scanVocabulary(this._accum[who]);
			}
			this._accum[who] = chunk;
		} else {
			this._accum[who] += chunk;
		}
		this._lastTranscriptTime[who] = now;

		const role = who === 'model' ? 'iris' : 'user';
		showStreamingBubble('chat', this._correctTranscript(this._accum[who]), `stream-${who}`, { role });
	}

	async loadVocabulary() {
		try {
			const allTerms = await window.electronAPI.getVocabulary() || [];
			const hotTerms = await window.electronAPI.getHotVocabulary() || [];
			const coreTerms = await window.electronAPI.getVocabularyCore() || [];
			for (const t of hotTerms) {
				if (!allTerms.includes(t)) allTerms.push(t);
			}
			const corrections = await window.electronAPI.getVocabularyCorrections() || {};
			this._matcher.build(corrections, allTerms);
			setRecentSeenKnownTerms({ vocabTerms: allTerms, hotTerms, coreTerms, corrections });
			logInfo('Vocab', `Matcher built: ${allTerms.length} terms, ${Object.keys(corrections).length} corrections`);
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
		const cleaned = cleanTranscript(text);
		let result = this._matcher.correct(cleaned);
		const recentSeenRewrite = findRecentSeenRewrite(result);
		if (recentSeenRewrite?.text) {
			result = recentSeenRewrite.text;
			this._persistRecentSeenRewrite(recentSeenRewrite);
		}
		if (result !== text) {
			logInfo('Vocab', `FIXED: ${JSON.stringify(text)} → ${JSON.stringify(result)}`);
		}
		return result;
	}

	_persistRecentSeenRewrite(rewrite) {
		if (!rewrite?.shouldPersist) return;
		const wrong = String(rewrite.wrong || '').trim().toLowerCase();
		const right = String(rewrite.right || '').trim();
		if (!wrong || !right) return;
		if (this._matcher.hasCorrection(wrong)) return;
		this._matcher.addCorrection(wrong, right);
		window.electronAPI.addCorrection(wrong, right);
		this.gemini.sendRecentSeenUpdate?.();
		logInfo('Vocab', `RECENT-SCREEN LEARNED: "${wrong}" → "${right}"`);
	}

	_handleScreenCapture(captureFrame) {
		if (!captureFrame?.data || !this._apiKey) return;
		if (this._recentSeenExtractInFlight) return;

		const now = Date.now();
		if (now - this._lastRecentSeenExtractAt < this.voiceConfig.recentSeen.extractIntervalMs) return;
		this._lastRecentSeenExtractAt = now;
		this._recentSeenExtractInFlight = this._extractRecentSeenTerms(captureFrame)
			.catch((err) => {
				logError('RecentSeen', `Extraction failed: ${err?.message || err}`);
			})
			.finally(() => {
				this._recentSeenExtractInFlight = null;
			});
	}

	async _extractRecentSeenTerms(captureFrame) {
		const prompt = [
			'Extract unique visible UI terms from this screenshot that would help correct speech recognition.',
			'Return ONLY JSON. No markdown.',
			'Rules:',
			'- Include only unusual terms, product names, app names, usernames, channel names, workspace names, branded labels, and other distinctive visible text.',
			'- Exclude common English words, generic buttons, navigation words, dates, long sentences, URLs, and anything already likely to be in the vocabulary.',
			'- Prefer terms that are short and likely to be spoken aloud.',
			'- Preserve exact casing.',
			'JSON schema:',
			'{"terms":[{"term":"Discord","confidence":0.92}]}',
		].join('\n');

		const body = {
			contents: [{
				parts: [
					{ text: prompt },
					{
						inlineData: {
							mimeType: 'image/jpeg',
							data: captureFrame.data,
						},
					},
				],
			}],
			generationConfig: {
				temperature: 0,
				maxOutputTokens: 180,
				responseMimeType: 'application/json',
			},
		};

		const resp = await fetch(`${FLASH_ENDPOINT}?key=${this._apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(12000),
		});
		if (!resp.ok) {
			throw new Error(`HTTP ${resp.status}`);
		}

		const data = await resp.json();
		const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
		const parsed = parseJsonEnvelope(text);
		const terms = Array.isArray(parsed?.terms) ? parsed.terms : [];
		const added = addRecentSeenTerms(terms, {
			source: 'screen',
			captureId: captureFrame.context?.captureId,
			appHint: captureFrame.context?.app,
		});
		if (added.length) {
			this.gemini.sendRecentSeenUpdate?.();
			logInfo('RecentSeen', `Added ${added.length} recent screen term(s): ${added.map((item) => item.term).join(', ')}`);
		}
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
			logInfo('Vocab', `Correction candidate: "${match.ngram}" → "${term}" (x${candidate.count})`);

			if (candidate.count >= 2) {
				this._correctionCandidates.delete(key);
				this._matcher.addCorrection(key, term);
				window.electronAPI.addCorrection(key, term);
				logInfo('Vocab', `AUTO-LEARNED: "${key}" → "${term}"`);
			}
		}
	}

	toggleAutonomous() {
		this._autonomousMode = !this._autonomousMode;
		const badge = document.getElementById('auto-badge');
		if (badge) badge.classList.toggle('visible', this._autonomousMode);
		updateIndicator('auto', this._autonomousMode);
		this._screen.setAutonomousMode(this._autonomousMode);

		if (this._autonomousMode) {
			logInfo('Voice', 'Autonomous mode ACTIVATED');
			this._autonomousResponseExpected = true;
			this.behavior.setMode('autonomous');
			this.gemini.sendText(
				'[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED]\n' +
				'You are now in autonomous coding mode. Confirm with ONE short sentence (e.g. "Autonomous mode on — what should I work on?") then STOP. ' +
				'Do NOT describe the mode, list capabilities, mention schedules, or say you are idle/waiting/standing by. ' +
				'IDLE RULES STILL APPLY: after your initial confirmation, remain COMPLETELY SILENT until the user speaks or you receive an [AUTONOMOUS CODING PROMPT] system message. ' +
				'When you receive [AUTONOMOUS CODING PROMPT], ask briefly what to work on, then STOP. ' +
				'When the user describes a task, call fix_project immediately with a detailed description. ' +
				'Share Claude Code progress ONLY when the user asks. When a task finishes, report the result in one sentence, then go silent.'
			);
			if (!this._screen.isRunning && this._active) {
				this._screen.start();
			}
			this._consecutiveAutoTurns = 0;
			this._startAutonomousLoop();
		} else {
			logInfo('Voice', 'Autonomous mode DEACTIVATED');
			this._stopAutonomousLoop();
			this._consecutiveAutoTurns = 0;
			this._autonomousResponseExpected = false;
			this.behavior.setMode('silent');
			this.gemini.sendText(
				'[SYSTEM: MODE CHANGE — AUTONOMOUS MODE DEACTIVATED]\n' +
				'Idle silence rules are RESTORED. Return to normal behavior: only respond when the user speaks to you. ' +
				'Do NOT proactively speak or ask questions.'
			);
		}
	}

	_startAutonomousLoop() {
		this._stopAutonomousLoop();
		this._autonomousInterval = setTimeout(() => {
			this._autonomousInterval = null;
			try {
				if (!this._autonomousMode || !this._active || this._muted) return;
				if (this.state !== STATES.LISTENING) return;
				if (this._toolExecuting) return;

				const timeSinceTurn = Date.now() - this._lastAutonomousPromptTime;
				if (timeSinceTurn < 15000) return;

				if (this._consecutiveAutoTurns >= 1) {
					logInfo('Voice', 'Autonomous mode: already prompted without response, staying quiet');
					return;
				}

				this._consecutiveAutoTurns++;
				this._autonomousResponseExpected = true;
				logInfo('Voice', `Autonomous follow-up prompt #${this._consecutiveAutoTurns}`);

				this._screen.capture().then(() => {
					if (this._autonomousMode) {
						this.gemini.sendText(
							'[AUTONOMOUS CODING PROMPT] If a Claude Code task is running, give a one-sentence progress update. ' +
							'Otherwise, ask ONE short question about what to work on. ' +
							'No filler, no status commentary. One sentence max, then STOP.'
						);
					}
				});
			} finally {
				if (this._autonomousMode) {
					this._startAutonomousLoop();
				}
			}
		}, AUTONOMOUS_LOOP_INTERVAL_MS);
	}

	_stopAutonomousLoop() {
		if (this._autonomousInterval) {
			clearTimeout(this._autonomousInterval);
			this._autonomousInterval = null;
		}
	}

	async start() {
		this._apiKey = await window.electronAPI.getApiKey();
		if (!this._apiKey || this._apiKey === 'YOUR_API_KEY_HERE') {
			logError('Voice', 'No API key — set GEMINI_API_KEY in .env');
			return;
		}

		await this.loadVocabulary();
		this._vocabRefreshInterval = setInterval(() => this.loadVocabulary(), 60000);
		if (!this._unsubscribeScreenCapture && this._screen?.onCapture) {
			this._unsubscribeScreenCapture = this._screen.onCapture((captureFrame) => {
				this._handleScreenCapture(captureFrame);
			});
		}
		refreshWorkspace();

		window.electronAPI.onToggleVoice(() => this.toggle());
		window.electronAPI.onToggleAutonomous(() => this.toggleAutonomous());
		window.electronAPI.onReloadSession(() => {
			if (this._active) this.reconnect();
		});

		// Direct mode: sync initial state and listen for changes
		window.electronAPI.getDirectMode().then((enabled) => {
			this.gemini.setDirectMode(!!enabled);
		}).catch(() => {});
		window.electronAPI.getBehaviorMode().then((mode) => {
			if (typeof mode === 'string') this.behavior.setMode(mode);
		}).catch(() => {});
		window.electronAPI.onBehaviorModeChanged((mode) => {
			if (typeof mode === 'string') {
				this.behavior.setMode(mode);
				this._autonomousMode = mode === 'autonomous';
				this._screen.setAutonomousMode(this._autonomousMode);
				updateIndicator('auto', this._autonomousMode);
				const badge = document.getElementById('auto-badge');
				if (badge) badge.classList.toggle('visible', this._autonomousMode);
			}
		});
		window.electronAPI.onDirectModeChanged((enabled) => {
			this.gemini.setDirectMode(!!enabled);
			logInfo('Voice', `Direct mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
		});

		window.electronAPI.onClaudeCodeStream((data) => {
			if (data.type === 'log') {
				this._batcher.addLine(data.taskId, data.line);
			} else if (data.type === 'done') {
				this._batcher.handleDone(data.taskId, data.status, data.summary);
			}
		});

		this._batcher.start();
		this._active = true;
		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		this._idleMessageSent = false;
		this._proactiveResponseExpected = false;
		await this.gemini.connect(this._apiKey);
	}

	deactivate() {
		this._active = false;
		this._toolExecuting = false;
		this._clearSpeechReleaseTimer();
		this._resetTurnLatency();
		this._stopAutonomousLoop();
		this._autonomousMode = false;
		this._consecutiveAutoTurns = 0;
		this._proactiveResponseExpected = false;
		const autoBadge = document.getElementById('auto-badge');
		if (autoBadge) autoBadge.classList.remove('visible');
		updateIndicator('auto', false);
		if (this._vocabRefreshInterval) {
			clearInterval(this._vocabRefreshInterval);
			this._vocabRefreshInterval = null;
		}
		this._batcher.stop();
		this._screen.stop();
		this.playback.stop();
		this.capture.stop();
		this.gemini.disconnect();
		this._setState(STATES.IDLE);
		for (const id of ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool', 'srch']) {
			updateIndicator(id, false);
			}
			clearAllPresence();
			clearBubbles();
			this._unsubscribeScreenCapture?.();
			this._unsubscribeScreenCapture = null;
			window.electronAPI.searchHide();
		window.electronAPI.endSession?.();
	}

	async reconnect() {
		this.needsReconnect = false;
		this._clearSpeechReleaseTimer();
		this._resetTurnLatency();
		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		this._idleMessageSent = false;
		this._proactiveResponseExpected = false;
		const wasAutonomous = this._autonomousMode;
		this.capture.stop();
		this.playback.stop();
		this.gemini.disconnect();
		await this.gemini.connect(this._apiKey);
		if (wasAutonomous && this._autonomousMode) {
			this.gemini.sendText(
				'[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED (reconnect)]\n' +
				'Autonomous coding mode is still active after reconnection. Do NOT announce or confirm this — remain SILENT. ' +
				'Wait for the user to speak or for an [AUTONOMOUS CODING PROMPT] system message. Normal idle rules apply.'
			);
		}
	}

	async toggle() {
		if (this._active) {
			this.deactivate();
		} else {
			await this.start();
		}
	}

	toggleMute() {
		this._muted = !this._muted;
		if (this._muted) {
			this.playback.stop();
			clearBubbles();
		}
		logInfo('Voice', `Mute ${this._muted ? 'ON' : 'OFF'}`);
		return this._muted;
	}

	get muted() {
		return this._muted;
	}

	getSpeakingVolume() {
		return this.playback.getVolume();
	}

	get active() {
		return this._active;
	}

	canEvaluateProactively() {
		return this._active
			&& !this._muted
			&& !this._toolExecuting
			&& !this._proactiveResponseExpected
			&& this.state === STATES.LISTENING
			&& this.gemini?.sessionReady;
	}

	speakProactiveSuggestion(text, meta = {}) {
		const clean = this.behavior.sanitize(text);
		if (!clean) return false;
		if (!this.canEvaluateProactively()) return false;
		if (!this.behavior.canSpeakProactively()) return false;
		const kind = String(meta?.kind || 'next-step').trim() || 'next-step';
		this._proactiveResponseExpected = true;
		this._proactivePromptedAt = Date.now();
		this.gemini.sendText(
			`[PROACTIVE SUGGESTION]\n` +
			`Do NOT use tools. Speak EXACTLY the sentence below, naturally, once, and add nothing before or after.\n` +
			`Kind: ${kind}\n` +
			`Sentence: ${clean}`
		);
		return true;
	}

	_newConvexSession() {
		window.electronAPI.newConvexSession();
	}

	_saveConversationTurn(role, content) {
		window.electronAPI.saveConversationTurn(role, content);
	}

	_saveToolExecution(toolName, args, result) {
		window.electronAPI.saveToolExecution(toolName, args, result);
	}
}

function parseJsonEnvelope(text) {
	const trimmed = String(text || '').trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/\{[\s\S]*\}/);
		if (!match) return null;
		try {
			return JSON.parse(match[0]);
		} catch {
			return null;
		}
	}
}
