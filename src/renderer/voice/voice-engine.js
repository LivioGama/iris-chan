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
import { setIndicatorLabel, updateIndicator } from '../ui/status-indicators.js';
import { refreshWorkspace } from '../ui/workspace-bar.js';
import { info as logInfo, error as logError } from '../logger.js';
import {
	buildReplyPresentation,
	describeInteractionState,
	getInteractionBadgeState,
	normalizeInteractionState,
} from '../interaction/interaction-policy.js';
import { createObservationTrigger } from '../observations/observation-trigger.js';

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
	volumeThreshold: 0.015,
	screenCaptureInterval: 10000,
	newTurnThresholdMs: 3000,
	replyCooldownMs: 45000,
	speechReleaseMs: 160,
	echoSuppressionGain: 0.8,
	directTurn: {
		fastReleaseMs: 90,
		serverEvidenceGraceMs: 1500,
		resumeWindowMs: 1200,
		continuousSpeechReleaseMs: 500,
		continuousSpeechThresholdMs: 2000,
		trailingNoiseRatio: 0.35,
		trailingNoiseThresholdMultiplier: 1.2,
		repromptText: 'I did not catch that. Please say it again.',
	},
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
		noiseFloorMultiplier: 1.0,
		noiseFloorOffset: 0,
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

const DEFAULT_SPEECH_PROFILE = Object.freeze({
	playbackRate: 1,
	pitchSemitones: 0,
	lowShelfFrequencyHz: 170,
	lowShelfGainDb: 0,
	warmthFrequencyHz: 280,
	warmthGainDb: 0,
	warmthQ: 0.9,
	presenceFrequencyHz: 2100,
	presenceGainDb: 0,
	presenceQ: 0.7,
	highShelfFrequencyHz: 4800,
	highShelfGainDb: 0,
	outputGain: 1,
	compressorThresholdDb: -24,
	compressorKneeDb: 8,
	compressorRatio: 2.2,
	compressorAttackSeconds: 0.003,
	compressorReleaseSeconds: 0.2,
});

const DEFAULT_BEHAVIOR_STATE = Object.freeze(normalizeInteractionState());

function normalizeReplyCommandText(value = '') {
	return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseReplyCommand(text = '', mode = '') {
	const normalized = normalizeReplyCommandText(text);
	if (!normalized) return null;
	const replaceMatch = normalized.match(/^(?:instead say|say instead|reply instead)\s+(.+)$/);
	const numberedEditMatch = normalized.match(/^(?:send|say|tell(?:\s+(?:her|him|them))?|use|pick|choose|option)\s+([1-4])(?:\s*,?\s*but\s+|\s+but\s+)(.+)$/);
	const makeNumberedMatch = normalized.match(/^make\s+([1-4])\s+(.+)$/);
	const currentDraftRewrite = /^(?:make|change|rewrite|rephrase|shorten|soften|warm(?:er)?|casual|formal)\b/.test(normalized)
		? normalized
		: '';
	if (mode === 'prompt') {
		if (/^(yes|yeah|yep|sure|ok|okay|do it|show me|suggest|help)\b/.test(normalized)) {
			return { type: 'open-suggestions' };
		}
		if (/^(no|nope|not now|skip|cancel)\b/.test(normalized)) {
			return { type: 'dismiss' };
		}
		return null;
	}
	if (mode === 'suggestions') {
		if (numberedEditMatch) {
			return {
				type: 'revise-and-send',
				index: Number(numberedEditMatch[1]) - 1,
				instruction: numberedEditMatch[2].trim(),
			};
		}
		if (makeNumberedMatch) {
			return {
				type: 'revise-and-send',
				index: Number(makeNumberedMatch[1]) - 1,
				instruction: `make it ${makeNumberedMatch[2].trim()}`,
			};
		}
		const sendMatch = normalized.match(/^(?:send|use|pick|choose|option)\s+([1-4])\b/);
		if (sendMatch) return { type: 'preview-suggestion', index: Number(sendMatch[1]) - 1 };
		const bareMatch = normalized.match(/^([1-4])$/);
		if (bareMatch) return { type: 'preview-suggestion', index: Number(bareMatch[1]) - 1 };
		if (replaceMatch) return { type: 'replace-and-send', text: replaceMatch[1].trim() };
		if (/^(cancel|skip|not now|never mind)\b/.test(normalized)) return { type: 'dismiss' };
		return null;
	}
	if (mode === 'preview') {
		if (/^(send it|confirm|yes|yeah|do it|go ahead)\b/.test(normalized)) return { type: 'confirm-send' };
		if (replaceMatch) return { type: 'replace-and-send', text: replaceMatch[1].trim() };
		if (numberedEditMatch) {
			return {
				type: 'revise-and-send',
				index: Number(numberedEditMatch[1]) - 1,
				instruction: numberedEditMatch[2].trim(),
			};
		}
		if (currentDraftRewrite) return { type: 'revise-current-and-send', instruction: currentDraftRewrite };
		if (/^(cancel|skip|not now|no)\b/.test(normalized)) return { type: 'dismiss' };
	}
	return null;
}

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
		directTurn: {
			...DEFAULT_VOICE_CONFIG.directTurn,
			...(overrides.directTurn || {}),
		},
		speechProfile: overrides.speechProfile && typeof overrides.speechProfile === 'object'
			? {
				...DEFAULT_SPEECH_PROFILE,
				...(overrides.speechProfile || {}),
			}
			: undefined,
	};
}

function getEffectiveModelVoiceName(voiceConfig = {}) {
	const normalized = String(voiceConfig?.modelVoiceName || '').trim();
	return normalized || null;
}

function createDirectTurnState(id = 0) {
	return {
		id,
		phase: 'idle',
		active: false,
		awaitingResponse: false,
		committed: false,
		hasTranscript: false,
		serverRecognized: false,
		startedAt: 0,
		committedAt: 0,
		firstTranscriptAt: 0,
		lastTranscriptAt: 0,
		firstModelAudioAt: 0,
		graceScheduledAt: 0,
		lastSpeechAt: 0,
		peakVolume: 0,
		lastSuppressionReason: '',
		retryCount: 0,
		recoveryReason: '',
		localSpeechEvidence: false,
		transcriptEvidence: false,
		partialTranscript: false,
		salvageStarted: false,
	};
}

export class VoiceEngine extends Emitter {
	constructor({ gemini, capture, playback, behavior, eventBus, vocab, screen, claudeCodeBatcher, voiceConfig, performanceMonitor = null }) {
		super();
		this.gemini = gemini;
		this.capture = capture;
		this.playback = playback;
		this.behavior = behavior;
		this.eventBus = eventBus;
		this.voiceConfig = buildVoiceConfig(voiceConfig);
		this._performanceMonitor = performanceMonitor || null;
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
		this._toolCallPending = false;
		this._speechReleaseTimer = null;
		this._speechReleaseMs = this.voiceConfig.speechReleaseMs;
		this._echoSuppressionGain = this.voiceConfig.echoSuppressionGain;
		this._directTurnConfig = this.voiceConfig.directTurn;
		this._lastSpeechEnergyAt = 0;
		this._turnLatency = null;
		this._benchmarkTurn = null;
		this._directTurnGraceTimer = null;

		this._behaviorState = { ...DEFAULT_BEHAVIOR_STATE };
		this._autonomousMode = false;
		this._autonomousInterval = null;
		this._consecutiveAutoTurns = 0;
		this._lastAutonomousPromptTime = 0;
		this._autonomousResponseExpected = false;
		this._pendingClaudeCodeStatus = null;
		this._proactiveResponseExpected = false;
		this._proactivePromptedAt = 0;
		this._replySession = null;
		this._pendingReplyAction = null;
		this._directTurnCounter = 0;
		this._directTurn = createDirectTurnState();
		this._consecutiveSalvageFailures = 0;
		this._salvageTimer = null;

		this._matcher = vocab || new VocabMatcher();
		this._correctionCandidates = new Map();
		this._vocabRefreshInterval = null;
		this._recentSeenExtractInFlight = null;
		this._lastRecentSeenExtractAt = 0;
		this._observationTrigger = createObservationTrigger();
		this._observationCheckInFlight = null;
		this._modelOutputFenceActive = false;

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
		this._applyVoicePresentationConfig();

		this._bind();
	}

	_applyVoicePresentationConfig() {
		const voiceName = getEffectiveModelVoiceName(this.voiceConfig);
		if (typeof this.gemini?.setVoiceName === 'function') {
			this.gemini.setVoiceName(voiceName);
		}
		if (this.voiceConfig?.speechProfile && typeof this.playback?.setSpeechProfile === 'function') {
			this.playback.setSpeechProfile(this.voiceConfig.speechProfile);
		}
	}

	applyVoiceConfig(nextVoiceConfig = {}) {
		const previousEffectiveVoiceName = getEffectiveModelVoiceName(this.voiceConfig);
		this.voiceConfig = buildVoiceConfig(nextVoiceConfig);
		this._newTurnThresholdMs = this.voiceConfig.newTurnThresholdMs;
		this.volumeThreshold = this.voiceConfig.volumeThreshold;
		this._speechReleaseMs = this.voiceConfig.speechReleaseMs;
		this._echoSuppressionGain = this.voiceConfig.echoSuppressionGain;
		this._directTurnConfig = this.voiceConfig.directTurn;
		this._clearDirectTurnGraceTimer();
		this._listeningGate = new ListeningGate({
			activationThreshold: this.volumeThreshold,
			...this.voiceConfig.listeningGate,
		});
		this._bargeIn = new BargeInDetector({
			activationThreshold: this.volumeThreshold,
			...this.voiceConfig.bargeIn,
		});
		configureRecentSeenStore(this.voiceConfig.recentSeen);
		this._applyVoicePresentationConfig();
		const nextEffectiveVoiceName = getEffectiveModelVoiceName(this.voiceConfig);
		if (previousEffectiveVoiceName !== nextEffectiveVoiceName && this._active && this.gemini?.connected) {
			this.reconnect().catch((err) => {
				logError('Voice', `Voice reconnect failed: ${err?.message || err}`);
				this.needsReconnect = true;
			});
		}
	}

	_bind() {
		this.gemini.on('connected', () => {
			updateIndicator('ws', true);
			clearPresence('recovery');
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
			clearPresence('recovery');
			setPresence('voice', 'disconnected', {
				title: 'Disconnected',
				detail: 'Reconnect to resume voice',
			});
			// Finalize any in-flight streaming bubbles so they don't hang forever
			finalizeStreamingBubble('stream-model');
			finalizeStreamingBubble('stream-user');
			this._clearSpeechReleaseTimer();
			this._resetTurnLatency();
			this._cancelBenchmarkTurn();
			this._setState(STATES.IDLE);
		});

		this.gemini.on('maxRetriesReached', () => {
			this.needsReconnect = true;
		});

		this.gemini.on('audio', (data) => {
			if (this._muted) return;
			if (this.state === STATES.USER_SPEAKING || this._modelOutputFenceActive) {
				this._noteDirectTurnSuppressed(this.state === STATES.USER_SPEAKING ? 'user-speaking' : 'model-output-fenced');
				return;
			}
			if (this._dropModelOutputUntilTurnComplete) {
				this._noteDirectTurnSuppressed('drop-until-turn-complete');
				return;
			}
			if (!this._shouldAcceptModelOutput()) {
				this._noteDirectTurnSuppressed('model-output-gate');
				return;
			}
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
			this._noteDirectTurnModelAudio();
			this.playback.enqueue(data);
		});

		this.gemini.on('inputTranscription', (text) => {
			if (this._muted) return;
			this._appendTranscript('user', text);
			this._noteDirectTurnTranscript(text);
			this._maybeCaptureReplyCommand();
			updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			if (this._muted) return;
			if (this.state === STATES.USER_SPEAKING || this._modelOutputFenceActive) {
				this._noteDirectTurnSuppressed(this.state === STATES.USER_SPEAKING ? 'user-speaking' : 'model-output-fenced');
				return;
			}
			if (this._dropModelOutputUntilTurnComplete) {
				this._noteDirectTurnSuppressed('drop-until-turn-complete');
				return;
			}
			if (!this._shouldAcceptModelOutput()) {
				this._noteDirectTurnSuppressed('model-output-gate');
				return;
			}
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
			if (this._directTurn.awaitingResponse) {
				if (this._toolCallPending) {
					// A tool call is in-flight — Gemini will send follow-up tool calls
					// or audio after receiving the tool response. Don't finish the
					// direct turn yet; we'll finalize on a later turnComplete.
					logInfo('DirectAsk', `[${this._directTurn.id}] turnComplete deferred — tool call in progress`);
				} else if (this._accum.model) {
					this._finishDirectTurn('answered', {
						hadTranscript: this._directTurn.hasTranscript,
						hadModel: true,
					});
				} else if (this._directTurn.salvageStarted) {
					this._failPendingDirectTurn('salvage_completed_without_response');
				} else if (this._directTurn.retryCount > 0) {
					this._failPendingDirectTurn('retry_completed_without_playback');
				} else if (!this._directTurn.serverRecognized) {
					this._failPendingDirectTurn('aborted_no_server_turn');
				} else {
					this._finishDirectTurn('completed_without_playback');
				}
			}
			this._accum.model = '';
			this._lastUserTurn = '';
			this._resetTurnLatency();
			if (this._pendingReplyAction) {
				const pending = this._pendingReplyAction;
				this._pendingReplyAction = null;
				this._runReplyAction(pending).catch((err) => {
					logError('ReplyAssistant', `Reply action failed: ${err?.message || err}`);
				});
			}

			// Skip idle-gate accounting while a tool call is pending — the model
			// is still working on the user's request, not generating idle chatter.
			if (this._toolCallPending) {
				// no-op: preserve current unpromptedTurnCount / idleMessageSent
			} else if (!this._autonomousMode) {
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
			this._cancelBenchmarkTurn();
			this._setState(STATES.LISTENING);
			// Finalize the model bubble on interruption so it doesn't hang
			finalizeStreamingBubble('stream-model');
			if (this._directTurn.awaitingResponse && !this._directTurn.firstModelAudioAt) {
				const failure = this._getDirectTurnFailureMode();
				if (failure.mode === 'heard_but_backend_failed' || failure.mode === 'heard_partial_transcript') {
					this._failPendingDirectTurn(failure.mode);
					logInfo('Voice', 'Server interrupted pending direct turn before playback');
					return;
				}
				if (this._directTurn.serverRecognized && this._retryPendingDirectTurn('server_superseded_before_playback')) {
					logInfo('Voice', 'Server interrupted pending direct turn before playback — retrying once');
					return;
				}
				this._failPendingDirectTurn(this._directTurn.serverRecognized ? 'server_superseded_before_playback' : 'aborted_no_server_turn');
				logInfo('Voice', 'Server interrupted pending direct turn before playback');
				return;
			}
			logInfo('Voice', 'User interrupted — playback stopped');
		});

		this.gemini.on('toolCall', (calls) => {
			this._toolCallPending = true;
			this._toolHandler.handleToolCalls(calls).finally(() => {
				this._toolCallPending = false;
			});
		});

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
			if ((this.state === STATES.LISTENING || this.state === STATES.PROCESSING) && !this._directTurn.committed) {
				this._listeningGate.bufferChunk(base64);
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

			if (this.state === STATES.LISTENING || this.state === STATES.PROCESSING) {
				const gate = this._listeningGate.observeVolume({
					micVolume: meter.effective,
					now,
				});
				if (gate.confirmed) {
					this._confirmListeningSpeech('confirmed speech', {
						heldMs: gate.heldMs,
						micVolume: meter.effective,
						rawMicVolume: meter.raw,
						residualMicVolume: meter.residual,
						threshold: gate.threshold,
						noiseFloor: gate.noiseFloor,
						clippedRatio: meter.clippedRatio,
					});
				}
				return;
			}

			if (this.state === STATES.USER_SPEAKING) {
				this._directTurn.peakVolume = Math.max(this._directTurn.peakVolume || 0, meter.effective || 0);
				this._directTurn.lastSpeechAt = now;
				if (meter.effective > this.volumeThreshold && !this._shouldUseDirectTurnFastRelease(meter)) {
					this._lastSpeechEnergyAt = now;
					this._clearDirectTurnGraceTimer();
					this._clearSpeechReleaseTimer();
					return;
				}
				if (!this._directTurn.serverRecognized) {
					if (this._directTurn.awaitingResponse && !this._directTurnGraceTimer) {
						logInfo('DirectAsk', `[${this._directTurn.id}] finalization_deferred_waiting_for_transcript`);
					}
					this._scheduleDirectTurnGraceTimer();
					return;
				}
				const turnAge = now - (this._directTurn.startedAt || now);
				let releaseMs;
				if (this._shouldUseDirectTurnFastRelease(meter)) {
					releaseMs = this._directTurnConfig.fastReleaseMs;
				} else if (turnAge > this._directTurnConfig.continuousSpeechThresholdMs) {
					releaseMs = this._directTurnConfig.continuousSpeechReleaseMs;
				} else {
					releaseMs = this._speechReleaseMs;
				}
				this._scheduleSpeechRelease(now, releaseMs);
			}
		});

		this.capture.on('stopped', () => {
			updateIndicator('mic', false);
			updateIndicator('send', false);
		});

		this.playback.on('started', () => {
			updateIndicator('speak', true);
			this._notePlaybackStarted();
		});

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
		if (this._directTurn.awaitingResponse) return true;
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

	_clearDirectTurnGraceTimer() {
		if (!this._directTurnGraceTimer) return;
		clearTimeout(this._directTurnGraceTimer);
		this._directTurnGraceTimer = null;
	}

	_clearSalvageTimer() {
		if (!this._salvageTimer) return;
		clearTimeout(this._salvageTimer);
		this._salvageTimer = null;
	}

	_scheduleDirectTurnGraceTimer() {
		if (!this._directTurn.awaitingResponse || this._directTurn.serverRecognized) return;
		if (this._directTurnGraceTimer) return;
		this._directTurn.graceScheduledAt = Date.now();
		this._directTurnGraceTimer = setTimeout(() => {
			this._directTurnGraceTimer = null;
			if (!this._directTurn.awaitingResponse || this._directTurn.serverRecognized) return;
			logInfo(
				'DirectAsk',
				`[${this._directTurn.id}] grace expired without server evidence (${Date.now() - this._directTurn.committedAt}ms)`
			);
			this._failPendingDirectTurn('aborted_no_server_turn');
		}, this._directTurnConfig.serverEvidenceGraceMs);
	}

	_noteDirectTurnSuppressed(reason) {
		if (!this._directTurn.awaitingResponse) return;
		if (this._directTurn.lastSuppressionReason === reason) return;
		this._directTurn.lastSuppressionReason = reason;
		logInfo('DirectAsk', `[${this._directTurn.id}] output suppressed (${reason})`);
	}

	_beginDirectTurn(kind = 'direct') {
		clearPresence('recovery');
		if (
			this._directTurn.awaitingResponse
			&& this._directTurn.phase !== 'responding'
			&& kind !== 'barge-in'
			&& Date.now() - (this._directTurn.lastSpeechAt || this._directTurn.committedAt || this._directTurn.startedAt || 0) <= this._directTurnConfig.resumeWindowMs
		) {
			this._clearDirectTurnGraceTimer();
			this._directTurn.phase = this._directTurn.serverRecognized ? 'server_recognized' : 'pending_local';
			logInfo('DirectAsk', `[${this._directTurn.id}] merged_local_fragment`);
			return;
		}
		if (this._parallelManager?.isActive) {
			this._parallelManager.cancel();
			logInfo('Parallel', 'Cancelled by new speech turn');
		}
		if (this._directTurn.salvageStarted && this._directTurn.awaitingResponse) {
			this._consecutiveSalvageFailures++;
			this._clearSalvageTimer();
			logInfo('DirectAsk', `[${this._directTurn.id}] salvage abandoned by new turn (consecutive: ${this._consecutiveSalvageFailures})`);
			if (this._consecutiveSalvageFailures >= 2) {
				logInfo('Voice', `Multiple salvage failures (${this._consecutiveSalvageFailures}) — forcing WebSocket reconnect`);
				this._consecutiveSalvageFailures = 0;
				this.reconnect().catch((err) => {
					logError('Voice', `Salvage-triggered reconnect failed: ${err?.message || err}`);
				});
				return;
			}
		}
		this._directTurn = {
			...createDirectTurnState(++this._directTurnCounter),
			active: true,
			awaitingResponse: true,
			phase: 'pending_local',
			startedAt: Date.now(),
			kind,
		};
		logInfo('DirectAsk', `[${this._directTurn.id}] started (${kind})`);
	}

	_commitDirectTurn(details = {}) {
		if (!this._directTurn.awaitingResponse || this._directTurn.committed) return;
		this._directTurn.committed = true;
		this._directTurn.localSpeechEvidence = true;
		this._directTurn.committedAt = Date.now();
		this._directTurn.lastSpeechAt = this._directTurn.committedAt;
		this._directTurn.peakVolume = Math.max(this._directTurn.peakVolume || 0, details.micVolume || 0);
		logInfo(
			'DirectAsk',
			`[${this._directTurn.id}] committed (mic=${(details.micVolume || 0).toFixed(3)}, threshold=${(details.threshold || 0).toFixed(3)})`
		);
	}

	_noteDirectTurnTranscript(text = '') {
		if (!this._directTurn.awaitingResponse) return;
		if (!String(text || '').trim()) return;
		const transcript = this._getDirectTurnTranscript();
		this._directTurn.transcriptEvidence = this._hasMeaningfulTranscriptEvidence(transcript);
		this._directTurn.partialTranscript = this._isTranscriptProbablyPartial(transcript);
		const now = Date.now();
		if (!this._directTurn.hasTranscript) {
			this._directTurn.hasTranscript = true;
			this._directTurn.firstTranscriptAt = now;
			this._directTurn.serverRecognized = true;
			this._directTurn.phase = 'server_recognized';
			this._clearDirectTurnGraceTimer();
			logInfo('DirectAsk', `[${this._directTurn.id}] server_recognized`);
			if (this.state === STATES.USER_SPEAKING && Date.now() - this._lastSpeechEnergyAt >= this._directTurnConfig.fastReleaseMs) {
				this._scheduleSpeechRelease(Date.now(), 0);
			}
		}
		this._directTurn.lastTranscriptAt = now;
	}

	_noteDirectTurnModelAudio() {
		if (!this._directTurn.awaitingResponse || this._directTurn.firstModelAudioAt) return;
		clearPresence('recovery');
		this._modelOutputFenceActive = false;
		this._consecutiveSalvageFailures = 0;
		this._directTurn.firstModelAudioAt = Date.now();
		this._directTurn.serverRecognized = true;
		this._directTurn.phase = 'responding';
		this._clearDirectTurnGraceTimer();
		logInfo('DirectAsk', `[${this._directTurn.id}] first model audio`);
	}

	_finishDirectTurn(outcome, details = {}) {
		if (!this._directTurn.awaitingResponse) return;
		this._clearDirectTurnGraceTimer();
		this._clearSalvageTimer();
		this._modelOutputFenceActive = false;
		logInfo('DirectAsk', `[${this._directTurn.id}] ${outcome}${details.reason ? ` (${details.reason})` : ''}`);
		this._directTurn = createDirectTurnState(this._directTurn.id);
	}

	_getDirectTurnTranscript() {
		return this._correctTranscript(this._accum.user || this._lastUserTurn || '').trim();
	}

	_hasMeaningfulTranscriptEvidence(text = '') {
		const normalized = String(text || '').trim();
		if (!normalized) return false;
		const words = normalized.split(/\s+/).filter(Boolean);
		return normalized.length >= 16 || words.length >= 4;
	}

	_isTranscriptProbablyPartial(text = '') {
		const normalized = String(text || '').trim();
		if (!normalized) return false;
		const lower = normalized.toLowerCase();
		if (/[.!?]["']?$/.test(normalized)) return false;
		if (/\b(of|to|for|with|about|all of|all|and|or|but|that|this|these|those|just|want to|need to)\s*$/i.test(lower)) {
			return true;
		}
		const words = lower.split(/\s+/).filter(Boolean);
		const lastWord = words[words.length - 1] || '';
		if (words.length < 4) return true;
		return lastWord.length <= 2;
	}

	_clearSupersededModelOutput(reason = 'superseded_turn') {
		this._modelOutputFenceActive = true;
		if (this._accum.model) {
			logInfo('DirectAsk', `[${this._directTurn.id}] discarded_stale_model_output (${reason})`);
		}
		this._accum.model = '';
		finalizeStreamingBubble('stream-model');
	}

	_getDirectTurnFailureMode() {
		const transcript = this._getDirectTurnTranscript();
		const hasMeaningfulTranscript = this._hasMeaningfulTranscriptEvidence(transcript);
		if (!this._directTurn.localSpeechEvidence && !hasMeaningfulTranscript && !transcript) {
			return { mode: 'no_local_speech_evidence', transcript: '' };
		}
		if (transcript) {
			return {
				mode: this._isTranscriptProbablyPartial(transcript) ? 'heard_partial_transcript' : 'heard_but_backend_failed',
				transcript,
			};
		}
		return { mode: 'no_local_speech_evidence', transcript: '' };
	}

	_startTranscriptSalvage(reason = 'heard_but_backend_failed') {
		const transcript = this._getDirectTurnTranscript();
		if (!transcript || !this.gemini?.sessionReady || this._directTurn.salvageStarted) return false;
		this._clearDirectTurnGraceTimer();
		this._clearSupersededModelOutput(reason);
		this._directTurn.serverRecognized = true;
		this._directTurn.hasTranscript = true;
		this._directTurn.transcriptEvidence = this._hasMeaningfulTranscriptEvidence(transcript);
		this._directTurn.partialTranscript = this._isTranscriptProbablyPartial(transcript);
		this._directTurn.salvageStarted = true;
		this._directTurn.recoveryReason = reason;
		this._directTurn.phase = 'salvaging';
		setPresence('recovery', 'recovering', {
			title: 'Recovering',
			detail: this._directTurn.partialTranscript ? 'Finishing what I heard' : 'Recovering from what I heard',
		});
		this._setState(STATES.PROCESSING);
		this._modelOutputFenceActive = false;
		this.gemini.sendText(
			`[SYSTEM: DIRECT TURN SALVAGE — do not mention backend failure]\n` +
			`Use the captured user transcript below to continue the conversation.\n` +
			`Transcript: ${transcript}\n` +
			`Rules:\n` +
			`- Continue naturally as if the conversation had proceeded normally.\n` +
			`- If the request is clear enough, answer/help directly.\n` +
			`- If the transcript is partial, infer the most likely conversational intent and answer naturally when possible.\n` +
			`- If the transcript is too weak to support a sensible reply, stay silent instead of asking a clarification.\n` +
			`- Never quote the transcript back to the user.\n` +
			`- Never say "I did not catch that" and never ask the user to repeat the whole thing.\n`
		);
		logInfo('DirectAsk', `[${this._directTurn.id}] transcript_salvage_started (${reason})`);
		this._clearSalvageTimer();
		const salvageTurnId = this._directTurn.id;
		this._salvageTimer = setTimeout(() => {
			this._salvageTimer = null;
			if (!this._directTurn.awaitingResponse || this._directTurn.id !== salvageTurnId) return;
			if (!this._directTurn.salvageStarted) return;
			logInfo('DirectAsk', `[${this._directTurn.id}] salvage timed out after 8s — no WebSocket response`);
			this._failPendingDirectTurn('salvage_timed_out');
		}, 8000);
		return true;
	}

	_retryPendingDirectTurn(reason = 'server_superseded_before_playback') {
		if (!this._directTurn.awaitingResponse || this._directTurn.firstModelAudioAt) return false;
		if (this._directTurn.retryCount >= 1) return false;
		if (!this.gemini?.sessionReady) return false;
		const retryText = this._correctTranscript(this._accum.user || this._lastUserTurn || '');
		if (!retryText) return false;
		this._clearDirectTurnGraceTimer();
		this._directTurn.retryCount += 1;
		this._directTurn.recoveryReason = reason;
		this._directTurn.phase = 'retrying';
		setPresence('recovery', 'recovering', {
			title: 'Recovering',
			detail: 'Retrying your last request',
		});
		this._setState(STATES.PROCESSING);
		this.gemini.sendText(
			`[SYSTEM: RETRY DIRECT TURN — do not mention this unless recovery fails]\n` +
			`The prior live voice turn was interrupted before playback. Retry once using the recognized user request below.\n` +
			`User request: ${retryText}`
		);
		logInfo('DirectAsk', `[${this._directTurn.id}] retrying_pre_playback_turn (${reason})`);
		return true;
	}

	_failPendingDirectTurn(reason = 'aborted_no_server_turn') {
		const failure = this._getDirectTurnFailureMode();
		if ((failure.mode === 'heard_but_backend_failed' || failure.mode === 'heard_partial_transcript') && this._startTranscriptSalvage(failure.mode)) {
			return;
		}
		if (this._directTurn.salvageStarted) {
			this._consecutiveSalvageFailures++;
			logInfo('DirectAsk', `[${this._directTurn.id}] consecutive salvage failures: ${this._consecutiveSalvageFailures}`);
			this._finishDirectTurn(reason);
			if (this._consecutiveSalvageFailures >= 2) {
				logInfo('Voice', `Multiple salvage failures (${this._consecutiveSalvageFailures}) — forcing WebSocket reconnect`);
				this._consecutiveSalvageFailures = 0;
				this.reconnect().catch((err) => {
					logError('Voice', `Salvage-triggered reconnect failed: ${err?.message || err}`);
				});
				return;
			}
			if (this.state !== STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
			return;
		}
		setPresence('recovery', 'recovering', {
			title: 'Recovering',
			detail: reason === 'aborted_no_server_turn' ? 'Resetting the voice turn' : 'Resetting after a missed response',
		});
		this._finishDirectTurn(reason);
		if (this.state !== STATES.RESPONDING) {
			this._setState(STATES.LISTENING);
		}
	}

	_shouldUseDirectTurnFastRelease(meter = {}) {
		if (!this._directTurn.awaitingResponse || !this._directTurn.committed) return false;
		const trailingThreshold = Math.max(
			this.volumeThreshold * this._directTurnConfig.trailingNoiseThresholdMultiplier,
			(this._directTurn.peakVolume || 0) * this._directTurnConfig.trailingNoiseRatio
		);
		return (meter.effective || 0) <= trailingThreshold;
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
			this._dropModelOutputUntilTurnComplete = true;
			this._clearSupersededModelOutput('user_started_speaking');
			if (prev !== STATES.USER_SPEAKING) {
				this._beginDirectTurn(prev === STATES.RESPONDING ? 'barge-in' : 'direct');
			}
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

		if (state === STATES.LISTENING) {
			setPresence('voice', 'listening', {
				title: 'Listening',
				detail: 'Ready for the next request',
			});
		} else if (state === STATES.PROCESSING) {
			this._dropModelOutputUntilTurnComplete = false;
			this._modelOutputFenceActive = false;
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
			clearPresence('recovery');
			setPresence('voice', 'responding', {
				title: 'Replying',
				detail: 'Turning the answer into speech',
			});
		} else if (state === STATES.IDLE && !this.gemini?.connected) {
			setPresence('voice', 'disconnected', {
				title: 'Disconnected',
				detail: 'Reconnect to resume voice',
			});
		} else {
			clearPresence('voice');
		}
	}

	_scheduleSpeechRelease(now = Date.now(), releaseMs = this._speechReleaseMs) {
		if (this._speechReleaseTimer) return;
		const remaining = Math.max(0, releaseMs - (now - this._lastSpeechEnergyAt));
		this._speechReleaseTimer = setTimeout(() => {
			this._speechReleaseTimer = null;
			if (this.state !== STATES.USER_SPEAKING) return;
			if (Date.now() - this._lastSpeechEnergyAt < releaseMs) {
				this._scheduleSpeechRelease(Date.now(), releaseMs);
				return;
			}
			if (this._directTurn.awaitingResponse) {
				logInfo('DirectAsk', `[${this._directTurn.id}] finalizing speech`);
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
		this._benchmarkTurn = this._performanceMonitor?.beginVoiceTurn?.({ source: 'user' }) || null;
	}

	_noteFirstModelAudio() {
		if (!this._turnLatency?.userSpeechStartedAt || this._turnLatency.firstModelAudioAt) return;
		this._turnLatency.firstModelAudioAt = Date.now();
		logInfo(
			'Latency',
			`Speech -> first audio chunk: ${this._turnLatency.firstModelAudioAt - this._turnLatency.userSpeechStartedAt}ms`
		);
		this._noteFirstModelChunk('audio');
	}

	_noteFirstModelChunk(type = 'audio') {
		if (!this._benchmarkTurn || this._benchmarkTurn.firstChunkAt) return;
		this._benchmarkTurn.firstChunkAt = performance.now();
		this._benchmarkTurn.firstChunkType = type;
	}

	_notePlaybackStarted() {
		if (!this._benchmarkTurn) return;
		this._benchmarkTurn.playbackStartedAt = performance.now();
		this._performanceMonitor?.completeVoiceTurn?.(this._benchmarkTurn);
		this._benchmarkTurn = null;
	}

	_cancelBenchmarkTurn() {
		if (!this._benchmarkTurn) return;
		this._performanceMonitor?.cancelVoiceTurn?.(this._benchmarkTurn);
		this._benchmarkTurn = null;
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
		this._commitDirectTurn(details);
		this._lastSpeechEnergyAt = Date.now();
		this._flushAudioChunks(bufferedChunks);
	}

	_confirmBargeIn(reason, details = {}) {
		if (this.state !== STATES.RESPONDING) return;
		const bufferedChunks = this._bargeIn.confirm();
		this._dropModelOutputUntilTurnComplete = true;
		this._finishDirectTurn('playback_barge_in', { reason });
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

	_maybeCaptureReplyCommand() {
		if (!this._replySession) return;
		const transcript = this._correctTranscript(this._accum.user || '');
		const parsed = parseReplyCommand(transcript, this._replySession.mode);
		if (!parsed) return;
		this._pendingReplyAction = parsed;
		this._dropModelOutputUntilTurnComplete = true;
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

		// Recent-seen term extraction (existing)
		if (!this._recentSeenExtractInFlight) {
			const now = Date.now();
			if (now - this._lastRecentSeenExtractAt >= this.voiceConfig.recentSeen.extractIntervalMs) {
				this._lastRecentSeenExtractAt = now;
				this._recentSeenExtractInFlight = this._extractRecentSeenTerms(captureFrame)
					.catch((err) => {
						logError('RecentSeen', `Extraction failed: ${err?.message || err}`);
					})
					.finally(() => {
						this._recentSeenExtractInFlight = null;
					});
			}
		}

		// Observation trigger check (runs independently)
		// Skip during pending DirectAsk — the realtimeText would interrupt the user's speech turn
		if (!this._observationCheckInFlight && !this._directTurn.awaitingResponse) {
			this._observationCheckInFlight = this._checkObservationTrigger(captureFrame)
				.catch((err) => {
					logError('Observation', `Trigger check failed: ${err?.message || err}`);
				})
				.finally(() => {
					this._observationCheckInFlight = null;
				});
		}
	}

	async _checkObservationTrigger(captureFrame) {
		if (!this._observationTrigger || !this.gemini) return;
		// Don't fire observations while a DirectAsk is pending — the realtimeText
		// would cause an 'interrupted' event that aborts the user's speech turn.
		if (this._directTurn.awaitingResponse) return;
		try {
			const appResult = await window.electronAPI.executeTool('get_frontmost_app', {});
			const appName = typeof appResult === 'string'
				? appResult
				: appResult?.name || appResult?.result || '';
			const trigger = this._observationTrigger.check(appName);
			if (!trigger) return;
			this.gemini.sendRealtimeText(
				`[OBSERVATION TRIGGER: ${trigger}] Describe what you see on screen and call save_observation with trigger="${trigger}". Do not speak aloud.`
			);
			logInfo('Observation', `Trigger fired: ${trigger} (app: ${appName}, count: ${this._observationTrigger.count})`);
		} catch (err) {
			logError('Observation', `Failed to check trigger: ${err?.message || err}`);
		}
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
		const nextMode = this._behaviorState.mode === 'proactive' ? 'silent' : 'proactive';
		window.electronAPI.setBehaviorState({
			...this._behaviorState,
			mode: nextMode,
		}).catch(() => {});
	}

	_applyBehaviorState(inputState = {}, { announce = false, source = 'runtime' } = {}) {
		const nextState = normalizeInteractionState(inputState);
		const previousMode = this._behaviorState.mode;
		this._behaviorState = nextState;
		this.behavior.setState(nextState);
		this.gemini.setBehaviorState(nextState);
		this._autonomousMode = nextState.mode === 'proactive';
		this._screen.setBehaviorMode?.(nextState.mode);
		this._screen.setAutonomousMode?.(this._autonomousMode);
		const badgeState = getInteractionBadgeState(nextState);
		updateIndicator('auto', badgeState.indicatorActive);
		setIndicatorLabel('auto', badgeState.indicatorLabel);

		if (this._autonomousMode) {
			if (!this._screen.isRunning && this._active) {
				this._screen.start();
			}
			if (previousMode !== 'proactive') {
				logInfo('Voice', `Interaction mode ACTIVATED: ${describeBehaviorState(nextState)} (${source})`);
				this._autonomousResponseExpected = true;
				this._consecutiveAutoTurns = 0;
				this._startAutonomousLoop();
				if (announce) {
					this.gemini.sendText(
						'[SYSTEM: MODE CHANGE — PROACTIVE MODE ACTIVATED]\n' +
						'You are now in proactive assistance mode. Confirm with ONE short sentence (e.g. "Proactive mode on.") then STOP. ' +
						'Do NOT describe the mode, list capabilities, mention schedules, or say you are idle/waiting/standing by. ' +
						'IDLE RULES STILL APPLY: after your initial confirmation, remain COMPLETELY SILENT until the user speaks or you receive an [AUTONOMOUS CODING PROMPT] system message. ' +
						'When you receive [AUTONOMOUS CODING PROMPT], keep active coding work in the background and speak only if there is no active task. ' +
						'When the user describes a task, call fix_project immediately with a detailed description. ' +
						'Share Claude Code progress ONLY when the user asks. Do not volunteer logs, background coding updates, or task completion notices.'
					);
				}
			}
		} else if (previousMode === 'proactive') {
			logInfo('Voice', `Interaction mode DEACTIVATED: proactive -> ${describeBehaviorState(nextState)} (${source})`);
			this._stopAutonomousLoop();
			this._consecutiveAutoTurns = 0;
			this._autonomousResponseExpected = false;
			if (announce) {
				this.gemini.sendText(
					'[SYSTEM: MODE CHANGE — PROACTIVE MODE DEACTIVATED]\n' +
					'Idle silence rules are RESTORED. Return to normal behavior: only respond when the user speaks to you. ' +
					'Do NOT proactively speak or ask questions.'
				);
			}
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
							'[AUTONOMOUS CODING PROMPT] If a Claude Code task is running, continue working silently. ' +
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
		window.electronAPI.getBehaviorState().then((state) => {
			this._applyBehaviorState(state, { source: 'bootstrap' });
		}).catch(() => {});
		window.electronAPI.getDirectMode().then((enabled) => {
			this._applyBehaviorState({ ...this._behaviorState, directMode: !!enabled }, { source: 'bootstrap:direct' });
		}).catch(() => {});
		window.electronAPI.onBehaviorStateChanged((state) => {
			this._applyBehaviorState(state, { source: 'ipc' });
		});
		window.electronAPI.onBehaviorModeChanged((mode) => {
			if (typeof mode === 'string') {
				this._applyBehaviorState({ ...this._behaviorState, mode }, { source: 'legacy-mode' });
			}
		});
		window.electronAPI.onDirectModeChanged((enabled) => {
			this._applyBehaviorState({ ...this._behaviorState, directMode: !!enabled }, { source: 'legacy-direct' });
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
		this._clearDirectTurnGraceTimer();
		this._clearSpeechReleaseTimer();
		this._resetTurnLatency();
		this._stopAutonomousLoop();
		this._behaviorState = { ...DEFAULT_BEHAVIOR_STATE };
		this._autonomousMode = false;
		this._consecutiveAutoTurns = 0;
		this._proactiveResponseExpected = false;
		this._directTurn = createDirectTurnState(this._directTurn.id);
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
		this._clearDirectTurnGraceTimer();
		this._clearSpeechReleaseTimer();
		this._resetTurnLatency();
		this._lastUserSpeechTime = Date.now();
		this._unpromptedTurnCount = 0;
		this._idleMessageSent = false;
		this._proactiveResponseExpected = false;
		this._directTurn = createDirectTurnState(this._directTurn.id);
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
			&& !this._directTurn.awaitingResponse
			&& !this._proactiveResponseExpected
			&& this.state === STATES.LISTENING
			&& this.gemini?.sessionReady;
	}

	hasPendingReplySession() {
		return !!this._replySession;
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

	presentReplySuggestions(payload = {}) {
		const presentation = buildReplyPresentation(payload, this._behaviorState);
		if (!presentation.allowed) return false;
		const meta = payload.replyAssistant || {};
		this._replySession = {
			mode: presentation.sessionMode,
			options: presentation.options,
			composerQueries: Array.isArray(meta.composerQueries) ? meta.composerQueries : [],
			sendQueries: Array.isArray(meta.sendQueries) ? meta.sendQueries : [],
			contextSummary: String(meta.contextSummary || ''),
			sendShortcutHint: String(meta.sendShortcutHint || ''),
			conversationFingerprint: String(meta.conversationFingerprint || ''),
			createdAt: Date.now(),
			draft: '',
			baseDraft: '',
			latestDraft: '',
			selectedOptionIndex: null,
		};
		return this._speakSystemSentence(presentation.spoken, presentation.kind);
	}

	async _runReplyAction(action) {
		if (!this._replySession || !action?.type) return;
		if (action.type === 'dismiss') {
			this._replySession = null;
			this._speakSystemSentence('Okay.', 'reply-dismiss');
			return;
		}
		if (action.type === 'open-suggestions') {
			this._replySession.mode = 'suggestions';
			this._speakSystemSentence(
				`Possible replies. ${this._replySession.options.map((option, index) => `Option ${index + 1}: ${option}.`).join(' ')} Say send 1, send 2, send 3, or send 4. Or say instead say and your reply.`,
				'reply-suggestions'
			);
			return;
		}
		if (action.type === 'preview-suggestion') {
			const text = this._replySession.options[action.index] || '';
			if (!text) return;
			await this._previewReplyDraft(text);
			return;
		}
		if (action.type === 'replace-and-send') {
			await this._composeAndSendReply(action.text, { replace: true });
			return;
		}
		if (action.type === 'revise-and-send') {
			const baseDraft = this._replySession.options[action.index] || '';
			if (!baseDraft) return;
			this._replySession.selectedOptionIndex = action.index;
			await this._reviseAndSendReply(baseDraft, action.instruction, { selectedOptionIndex: action.index });
			return;
		}
		if (action.type === 'revise-current-and-send') {
			const baseDraft = this._replySession.latestDraft || this._replySession.baseDraft || this._replySession.draft;
			if (!baseDraft) {
				this._speakSystemSentence('Please tell me which reply to use first.', 'reply-clarify');
				return;
			}
			await this._reviseAndSendReply(baseDraft, action.instruction, { selectedOptionIndex: this._replySession.selectedOptionIndex });
			return;
		}
		if (action.type === 'confirm-send') {
			await this._sendReplyDraft();
		}
	}

	async _previewReplyDraft(text) {
		if (!this._replySession) return;
		const clean = String(text || '').trim();
		if (!clean) return;
		const result = await window.electronAPI.executeTool?.('prepare_reply_draft', {
			text: clean,
			composer_queries: this._replySession.composerQueries,
		});
		if (!result?.ok) {
			this._speakSystemSentence('I could not prepare that reply.', 'reply-error');
			return;
		}
		this._replySession.mode = 'preview';
		this._replySession.draft = clean;
		this._replySession.baseDraft = clean;
		this._replySession.latestDraft = clean;
		const selectedIndex = this._replySession.options.findIndex((option) => option === clean);
		if (selectedIndex >= 0) this._replySession.selectedOptionIndex = selectedIndex;
		this._speakSystemSentence(`Previewing: ${clean}. Say send it to send, or say instead say and your new reply.`, 'reply-preview');
	}

	async _composeAndSendReply(text, { replace = false } = {}) {
		if (!this._replySession) return;
		const clean = String(text || '').trim();
		if (!clean) {
			this._speakSystemSentence('Please rephrase how you want that reply changed.', 'reply-clarify');
			return;
		}
		this._replySession.draft = clean;
		if (!this._replySession.baseDraft) this._replySession.baseDraft = clean;
		this._replySession.latestDraft = clean;
		const prepare = await window.electronAPI.executeTool?.('prepare_reply_draft', {
			text: clean,
			composer_queries: this._replySession.composerQueries,
		});
		if (!prepare?.ok) {
			this._speakSystemSentence(`I could not ${replace ? 'prepare that replacement reply' : 'prepare that revised reply'}.`, 'reply-error');
			return;
		}
		await this._sendReplyDraft();
	}

	async _reviseAndSendReply(baseDraft, instruction, { selectedOptionIndex = null } = {}) {
		if (!this._replySession) return;
		const revised = await this._reviseReplyDraft({
			baseDraft,
			instruction,
			options: this._replySession.options,
			contextSummary: this._replySession.contextSummary,
		});
		if (!revised?.ok || !revised.draft) {
			this._speakSystemSentence('Please rephrase how you want that reply changed.', 'reply-clarify');
			return;
		}
		this._replySession.selectedOptionIndex = selectedOptionIndex;
		this._replySession.baseDraft = String(baseDraft || '').trim();
		this._replySession.latestDraft = revised.draft;
		this._replySession.mode = 'preview';
		await this._composeAndSendReply(revised.draft);
	}

	async _reviseReplyDraft({ baseDraft = '', instruction = '', options = [], contextSummary = '' } = {}) {
		const draft = String(baseDraft || '').trim();
		const changeRequest = String(instruction || '').trim();
		if (!draft || !changeRequest || !this._apiKey) return { ok: false };
		const prompt = [
			'Rewrite the selected reply using the spoken instruction.',
			'Return ONLY JSON. No markdown.',
			'Rules:',
			'- Output exactly one sendable reply.',
			'- Do not explain changes.',
			'- Do not add numbering or quotes unless the reply itself needs them.',
			'- If the instruction is too ambiguous to act on safely, return {"ok":false}.',
			'JSON schema:',
			'{"ok":true,"draft":"string"}',
			`Selected draft: ${draft}`,
			`Spoken instruction: ${changeRequest}`,
			`Other options for context: ${options.join(' || ') || 'none'}`,
			`Conversation summary:\n${contextSummary || 'none'}`,
		].join('\n');
		try {
			const resp = await fetch(`${FLASH_ENDPOINT}?key=${this._apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.25,
						maxOutputTokens: 140,
						responseMimeType: 'application/json',
					},
				}),
				signal: AbortSignal.timeout(12000),
			});
			if (!resp.ok) return { ok: false };
			const data = await resp.json();
			const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
			const parsed = parseJsonEnvelope(text);
			const nextDraft = String(parsed?.draft || '').trim();
			if (parsed?.ok !== true || !nextDraft) return { ok: false };
			return { ok: true, draft: nextDraft };
		} catch {
			return { ok: false };
		}
	}

	async _sendReplyDraft() {
		if (!this._replySession?.draft) return;
		const result = await window.electronAPI.executeTool?.('send_reply_draft', {
			send_queries: this._replySession.sendQueries,
			context_text: this._replySession.contextSummary,
			shortcut_hint: this._replySession.sendShortcutHint,
		});
		if (result?.ok) {
			this._replySession = null;
			this._speakSystemSentence('Sent.', 'reply-sent');
			return;
		}
		this._speakSystemSentence('I could not send that reply.', 'reply-send-failed');
	}

	_speakSystemSentence(text, kind = 'next-step') {
		const clean = this.behavior.sanitize(text);
		if (!clean) return false;
		if (!this.canEvaluateProactively()) return false;
		if (!this.behavior.canSpeakProactively()) return false;
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
