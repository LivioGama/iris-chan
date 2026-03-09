const DEFAULTS = {
	activationThreshold: 0.015,
	minRespondingThreshold: 0.05,
	minSpeechMs: 240,
	candidateGapMs: 90,
	preRollMs: 450,
	playbackDominanceRatio: 0.5,
	settleMs: 120,
	noiseFloorAttack: 0.22,
	noiseFloorRelease: 0.05,
	noiseFloorMultiplier: 1.45,
	noiseFloorOffset: 0.012,
	frameMsFallback: 32,
};

export class BargeInDetector {
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
		this._responseStartedAt = 0;
		this._noiseFloor = this.options.activationThreshold;
		this._buffer = [];
	}

	beginResponse(now = Date.now()) {
		this.reset();
		this._active = true;
		this._lastFrameAt = now;
		this._responseStartedAt = now;
	}

	endResponse() {
		this.reset();
	}

	bufferChunk(chunk, now = Date.now()) {
		if (!this._active || this._confirmed || !chunk) return;
		this._buffer.push({ chunk, now });
		this._trimBuffer(now);
	}

	observeVolume({ micVolume, playbackVolume = 0, unstableEcho = false, now = Date.now() }) {
		const threshold = this._requiredMicVolume(playbackVolume);
		if (!this._active || this._confirmed) {
			return {
				confirmed: false,
				candidate: false,
				heldMs: this._candidateMs,
				threshold,
				noiseFloor: this._noiseFloor,
				settling: false,
				unstableEcho,
			};
		}

		const delta = this._frameDelta(now);
		if (unstableEcho) {
			this._candidateMs = 0;
			this._updateNoiseFloor(Math.min(micVolume, threshold));
			return {
				confirmed: false,
				candidate: false,
				heldMs: this._candidateMs,
				threshold: this._requiredMicVolume(playbackVolume),
				noiseFloor: this._noiseFloor,
				settling: false,
				unstableEcho: true,
			};
		}

		const settling = now - this._responseStartedAt < this.options.settleMs;
		if (settling) {
			this._candidateMs = 0;
			this._updateNoiseFloor(micVolume);
			return {
				confirmed: false,
				candidate: false,
				heldMs: this._candidateMs,
				threshold: this._requiredMicVolume(playbackVolume),
				noiseFloor: this._noiseFloor,
				settling: true,
				unstableEcho: false,
			};
		}

		const effectiveThreshold = this._requiredMicVolume(playbackVolume);
		const candidate = micVolume >= effectiveThreshold;

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
		} else if (!candidate) {
			this._updateNoiseFloor(micVolume);
		}

		return {
			confirmed: this._confirmed,
			candidate,
			heldMs: this._candidateMs,
			threshold: effectiveThreshold,
			noiseFloor: this._noiseFloor,
			settling: false,
			unstableEcho: false,
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

	_requiredMicVolume(playbackVolume) {
		return Math.max(
			this.options.activationThreshold,
			this.options.minRespondingThreshold,
			playbackVolume * this.options.playbackDominanceRatio,
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
