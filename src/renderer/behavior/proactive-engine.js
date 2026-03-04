import { EVENT_TYPES } from '../../shared/event-types.web.js';

export class ProactiveEngine {
	constructor({ behavior, eventBus }) {
		this.behavior = behavior;
		this.eventBus = eventBus;
		this.threshold = 0.92;
	}

	maybeSuggest({ confidence, suggestion, context }) {
		if (confidence < this.threshold) return { ok: false, reason: 'low_confidence' };
		if (!this.behavior.canSuggest({ confidence })) return { ok: false, reason: 'throttled_or_mode' };
		this.eventBus.emitEvent(EVENT_TYPES.PROACTIVE_SUGGESTION, { suggestion, confidence, context }, 'proactive-engine');
		return { ok: true, suggestion };
	}
}
