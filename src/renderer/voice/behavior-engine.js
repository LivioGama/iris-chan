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
