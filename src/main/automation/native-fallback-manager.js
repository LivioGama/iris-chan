const log = require('../logger');

function now() {
	return Date.now();
}

class NativeFallbackManager {
	constructor() {
		this.activeContext = null;
	}

	beginTask({ taskId, goal = '', appHint = '', nativeEligible = false } = {}) {
		if (!nativeEligible) {
			this.activeContext = null;
			return;
		}
		this.activeContext = {
			taskId,
			goal,
			appHint,
			nativeEligible: true,
			pointerAuthorizedUntil: 0,
			pointerReason: '',
			createdAt: now(),
		};
		log.info('Learning', `Pointer fallback blocked pending native/AX attempts: task=${taskId} goal=${String(goal).slice(0, 120)}`);
	}

	authorizePointerFallback({ taskId, reason = '' } = {}) {
		if (!this.activeContext || this.activeContext.taskId !== taskId) return;
		this.activeContext.pointerAuthorizedUntil = now() + 30_000;
		this.activeContext.pointerReason = reason || 'native and accessibility attempts exhausted';
		log.info('Learning', `Pointer fallback authorized: task=${taskId} reason=${this.activeContext.pointerReason}`);
	}

	endTask(taskId, { preserveAuthorization = false } = {}) {
		if (!this.activeContext || this.activeContext.taskId !== taskId) return;
		if (preserveAuthorization && this.activeContext.pointerAuthorizedUntil > now()) {
			log.info('Learning', `Preserving pointer fallback window after task: task=${taskId}`);
			return;
		}
		this.activeContext = null;
	}

	canUsePointerTools() {
		if (!this.activeContext || !this.activeContext.nativeEligible) {
			return { ok: true };
		}
		if (this.activeContext.pointerAuthorizedUntil > now()) {
			return {
				ok: true,
				reason: this.activeContext.pointerReason,
				pointerAuthorizedUntil: this.activeContext.pointerAuthorizedUntil,
			};
		}
		return {
			ok: false,
			reason: 'Pointer fallback is blocked until native/app-specific and accessibility attempts fail.',
		};
	}
}

module.exports = {
	NativeFallbackManager,
};
