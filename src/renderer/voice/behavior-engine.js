import { IDLE_NOISE_PATTERN } from './transcription-policy.js';

export class BehaviorEngine {
	constructor() {
		this.state = {
			mode: 'silent',
			directMode: false,
			feedbackEnabled: false,
			introversionEnabled: false,
		};
		this.lastUserActivityAt = Date.now();
		this.lastAssistantMessageAt = 0;
		this.userSpokeSinceAssistant = true;
		this.idleAckSent = false;
		this.proactiveLastAt = 0;
		this.proactiveCooldownMs = 90_000;
		this.proactiveMinConfidence = {
			silent: 1,
			passive: 0.9,
			proactive: 0.82,
		};
		this.proactiveModeCooldownMs = {
			silent: Number.MAX_SAFE_INTEGER,
			passive: 30_000,
			proactive: 12_000,
		};
		this.proactiveEvalCooldownMs = {
			silent: Number.MAX_SAFE_INTEGER,
			passive: 10_000,
			proactive: 4_000,
		};
		this.proactiveUserActiveWindowMs = 60_000;
		this.lastProactiveEvalAt = 0;
		this.lastProactiveEvalFingerprint = '';
		this.lastProactiveFingerprint = '';
		this.lastProactiveKind = '';
		this.lastAssistantText = '';
		this.lastAssistantTextAt = 0;
		this.repeatCooldownMs = 20_000;

		// Self-modification readiness: tracks when user announced intent to change Iris
		this.awaitingSelfFixDetails = false;
		this.selfFixIntentAt = 0;
		this.selfFixIntentTimeoutMs = 120_000; // 2 min to provide details before resetting
	}

	setMode(mode) {
		if (!['silent', 'passive', 'proactive'].includes(mode)) return false;
		this.state.mode = mode;
		return true;
	}

	getMode() {
		return this.state.mode;
	}

	setState(nextState = {}) {
		if (!nextState || typeof nextState !== 'object') return false;
		if (!this.setMode(nextState.mode)) return false;
		this.state.directMode = !!nextState.directMode;
		this.state.feedbackEnabled = !!nextState.feedbackEnabled;
		this.state.introversionEnabled = !!nextState.introversionEnabled;
		return true;
	}

	getState() {
		return { ...this.state };
	}

	noteUserActivity() {
		this.lastUserActivityAt = Date.now();
		this.userSpokeSinceAssistant = true;
		this.idleAckSent = false;
	}

	noteAssistantSpoke(text = '') {
		this.lastAssistantMessageAt = Date.now();
		this.userSpokeSinceAssistant = false;
		this.lastAssistantText = String(text || '').trim().toLowerCase();
		this.lastAssistantTextAt = this.lastAssistantMessageAt;
	}

	isBannedIdleText(text = '') {
		return IDLE_NOISE_PATTERN.test(text);
	}

	sanitize(text = '') {
		const clean = String(text || '').trim();
		if (!clean || this.isBannedIdleText(clean)) return '';
		const now = Date.now();
		if (clean.toLowerCase() === this.lastAssistantText && now - this.lastAssistantTextAt < this.repeatCooldownMs) {
			return '';
		}
		return clean;
	}

	canSpeak({ directReply = false, majorMilestone = false, selfFixAck = false } = {}) {
		if (selfFixAck) return !this.idleAckSent;
		if (directReply) return true;
		if (majorMilestone) return this.state.mode !== 'silent' || this.userSpokeSinceAssistant;
		return this.userSpokeSinceAssistant;
	}

	markSelfFixAckSent() {
		this.idleAckSent = true;
	}

	// Called when user announces intent to modify Iris (e.g. "I'm going to change you")
	noteSelfFixIntent() {
		this.awaitingSelfFixDetails = true;
		this.selfFixIntentAt = Date.now();
	}

	// Called when self_fix is actually triggered with full details
	noteSelfFixTriggered() {
		this.awaitingSelfFixDetails = false;
		this.selfFixIntentAt = 0;
		this.idleAckSent = false;
	}

	// Check if we're still waiting for self-fix details (with auto-timeout)
	isAwaitingSelfFixDetails() {
		if (!this.awaitingSelfFixDetails) return false;
		if (Date.now() - this.selfFixIntentAt > this.selfFixIntentTimeoutMs) {
			this.awaitingSelfFixDetails = false;
			return false;
		}
		return true;
	}

	shouldEvaluateProactively({ frontmostApp = '', contextFingerprint = '', captureAgeMs = 0, now = Date.now() } = {}) {
		if (this.state.mode === 'silent') return false;
		if (!String(frontmostApp || '').trim()) return false;
		if (!String(contextFingerprint || '').trim()) return false;
		if (this.state.mode === 'passive' && now - this.lastUserActivityAt > this.proactiveUserActiveWindowMs) return false;
		if (!Number.isFinite(captureAgeMs) || captureAgeMs > 20_000) return false;
		const evalCooldownMs = this.proactiveEvalCooldownMs[this.state.mode] ?? 10_000;
		if (contextFingerprint === this.lastProactiveEvalFingerprint && now - this.lastProactiveEvalAt < evalCooldownMs) {
			return false;
		}
		if (contextFingerprint === this.lastProactiveFingerprint && now - this.proactiveLastAt < evalCooldownMs) {
			return false;
		}
		this.lastProactiveEvalAt = now;
		this.lastProactiveEvalFingerprint = contextFingerprint;
		return true;
	}

	canSuggest({ confidence = 0, contextFingerprint = '', now = Date.now() } = {}) {
		if (this.state.mode === 'silent') return false;
		const threshold = this.proactiveMinConfidence[this.state.mode] ?? 0.92;
		if (confidence < threshold) return false;
		const cooldownMs = this.proactiveModeCooldownMs[this.state.mode] ?? this.proactiveCooldownMs;
		if (now - this.proactiveLastAt < cooldownMs) return false;
		if (this.state.mode === 'passive' && now - this.lastUserActivityAt > this.proactiveUserActiveWindowMs) return false;
		if (contextFingerprint && contextFingerprint === this.lastProactiveFingerprint) return false;
		this.proactiveLastAt = now;
		this.lastProactiveFingerprint = String(contextFingerprint || '');
		return true;
	}

	noteIdleResponseSent() {
		this.idleResponseSent = true;
	}

	resetIdleGate() {
		this.idleResponseSent = false;
		this.idleAckSent = false;
	}

	canSpeakPassive(timeSinceUserMs) {
		if (this.idleResponseSent) return false;
		if (this.state.mode === 'silent') return false;
		if (timeSinceUserMs > 60000) return false;
		return true;
	}

	canSpeakProactively(now = Date.now()) {
		if (this.state.mode === 'silent') return false;
		if (this.state.mode === 'passive' && now - this.lastUserActivityAt > this.proactiveUserActiveWindowMs) return false;
		return true;
	}
}
