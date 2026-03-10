const DEFAULTS = {
	activationThreshold: 0.015,
	minSpeechMs: 180,
	candidateGapMs: 90,
	preRollMs: 450,
	noiseFloorAttack: 0.22,
	noiseFloorRelease: 0.05,
	noiseFloorMultiplier: 1.8,
	noiseFloorOffset: 0.02,
	frameMsFallback: 32,
};

export class ListeningGate {
	constructor(options = {}) {
		this.options = { ...DEFAULTS, ...options };
		this.reset();
	}

	reset() {
		this._active = false;
		this._confirmed = false;
		this._candidateMs = 0;
		this._lastFrameAt = 0;
		this._lastCandidateAt = 0;
		this._noiseFloor = this.options.activationThreshold;
		this._buffer = [];
	}

	begin(now = Date.now()) {
		this.reset();
		this._active = true;
		this._lastFrameAt = now;
	}

	end() {
		this.reset();
	}

	bufferChunk(chunk, now = Date.now()) {
		if (!this._active || this._confirmed || !chunk) return;
		this._buffer.push({ chunk, now });
		this._trimBuffer(now);
	}

	observeVolume({ micVolume, now = Date.now() }) {
		const threshold = this._requiredMicVolume();
		if (!this._active || this._confirmed) {
			return {
				confirmed: false,
				candidate: false,
				heldMs: this._candidateMs,
				threshold,
				noiseFloor: this._noiseFloor,
			};
		}

		const delta = this._frameDelta(now);
		const candidate = micVolume >= threshold;

		if (candidate) {
			if (this._lastCandidateAt && now - this._lastCandidateAt > this.options.candidateGapMs) {
				this._candidateMs = 0;
			}
			this._candidateMs += delta;
			this._lastCandidateAt = now;
			if (this._candidateMs >= this.options.minSpeechMs) {
				this._confirmed = true;
			}
		} else if (this._lastCandidateAt && now - this._lastCandidateAt > this.options.candidateGapMs) {
			this._candidateMs = 0;
			this._updateNoiseFloor(micVolume);
		} else {
			this._updateNoiseFloor(micVolume);
		}

		return {
			confirmed: this._confirmed,
			candidate,
			heldMs: this._candidateMs,
			threshold: this._requiredMicVolume(),
			noiseFloor: this._noiseFloor,
		};
	}

	confirm() {
		this._confirmed = true;
		return this.drainBufferedChunks();
	}

	drainBufferedChunks() {
		const chunks = this._buffer.map((entry) => entry.chunk);
		this._buffer = [];
		return chunks;
	}

	_requiredMicVolume() {
		return Math.max(
			this.options.activationThreshold,
			this._noiseFloor * this.options.noiseFloorMultiplier + this.options.noiseFloorOffset
		);
	}

	_updateNoiseFloor(micVolume) {
		const sample = Math.max(0, micVolume || 0);
		const alpha = sample > this._noiseFloor
			? this.options.noiseFloorAttack
			: this.options.noiseFloorRelease;
		this._noiseFloor = Math.max(
			this.options.activationThreshold,
			(1 - alpha) * this._noiseFloor + alpha * sample
		);
	}

	_trimBuffer(now) {
		const cutoff = now - this.options.preRollMs;
		while (this._buffer.length && this._buffer[0].now < cutoff) {
			this._buffer.shift();
		}
	}

	_frameDelta(now) {
		const last = this._lastFrameAt || now;
		this._lastFrameAt = now;
		return Math.max(1, Math.min(120, now - last || this.options.frameMsFallback));
	}
}
