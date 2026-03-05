import { IDLE_NOISE_PATTERN } from './transcription-policy.js';

export class BehaviorEngine {
	constructor() {
		this.mode = 'silent';
		this.lastUserActivityAt = Date.now();
		this.lastAssistantMessageAt = 0;
		this.userSpokeSinceAssistant = true;
		this.idleAckSent = false;
		this.proactiveLastAt = 0;
		this.proactiveCooldownMs = 90_000;
		this.lastAssistantText = '';
		this.lastAssistantTextAt = 0;
		this.repeatCooldownMs = 20_000;

		// Self-modification readiness: tracks when user announced intent to change Iris
		this.awaitingSelfFixDetails = false;
		this.selfFixIntentAt = 0;
		this.selfFixIntentTimeoutMs = 120_000; // 2 min to provide details before resetting
	}

	setMode(mode) {
		if (!['silent', 'attentive', 'autonomous'].includes(mode)) return false;
		this.mode = mode;
		return true;
	}

	getMode() {
		return this.mode;
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
		if (majorMilestone) return this.mode !== 'silent' || this.userSpokeSinceAssistant;
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

	canSuggest({ confidence = 0, now = Date.now() } = {}) {
		if (confidence < 0.92) return false;
		if (now - this.proactiveLastAt < this.proactiveCooldownMs) return false;
		this.proactiveLastAt = now;
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
		if (this.mode === 'silent') return false;
		if (timeSinceUserMs > 60000) return false;
		return true;
	}
}
