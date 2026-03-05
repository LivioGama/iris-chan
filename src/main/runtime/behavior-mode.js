class BehaviorModeState {
	constructor() {
		this.mode = 'silent';
		this.directMode = false;
	}

	getMode() {
		return this.mode;
	}

	setMode(mode) {
		if (!['silent', 'attentive', 'autonomous'].includes(mode)) {
			return { ok: false, error: 'Invalid mode' };
		}
		this.mode = mode;
		return { ok: true, mode };
	}

	getDirectMode() {
		return this.directMode;
	}

	setDirectMode(enabled) {
		this.directMode = !!enabled;
		return { ok: true, directMode: this.directMode };
	}
}

module.exports = { BehaviorModeState };
