import { EVENT_TYPES } from '../../shared/event-types.web.js';

export class ActionEngine {
	constructor({ eventBus, captureScreen }) {
		this.eventBus = eventBus;
		this.captureScreen = captureScreen;
	}

	async executeWithVerification(action, { perform, verify, maxRetries = 3, delayMs = 200 } = {}) {
		let lastError = null;
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			await perform(action, attempt);
			await wait(delayMs);
			const snap = await this.captureScreen();
			const ok = await verify({ action, attempt, snap });
			if (ok) {
				this.eventBus.emitEvent(EVENT_TYPES.ACTION_VERIFY_OK, { action, attempt }, 'action-engine');
				return { ok: true, attempt };
			}
			lastError = new Error(`Verification failed at attempt ${attempt}`);
			this.eventBus.emitEvent(EVENT_TYPES.ACTION_VERIFY_FAIL, { action, attempt }, 'action-engine');
		}
		return { ok: false, error: lastError ? lastError.message : 'Verification failed' };
	}
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
