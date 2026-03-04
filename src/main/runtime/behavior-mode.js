class BehaviorModeState {
	constructor() {
		this.mode = 'silent';
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
}

module.exports = { BehaviorModeState };
