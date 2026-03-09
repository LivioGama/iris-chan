// Mic capture via AudioWorklet -> PCM16 16kHz chunks
import { Emitter } from '../../shared/emitter.js';

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.bufferSize = 2048;
		this.buffer = new Float32Array(this.bufferSize);
		this.writePos = 0;
		this.threshold = 1024; // ~64ms at 16kHz (reduced from 2048/128ms for lower latency)
		this.referenceBuffer = null;
		this.refLength = 0;
		this.echoSuppression = true;
		this.suppressionGain = 1.0;
		this.isPlaybackActive = false;
		this.filterOrder = 128;
		this.filterCoeffs = new Float32Array(this.filterOrder);
		this.referenceHistory = new Float32Array(this.filterOrder);
		this.historyIndex = 0;
		this.stepSize = 0.004;
		this.refPower = 0;
		this.epsilon = 1e-5;
		this._scratchOutput = new Float32Array(128);
		this._scratchSuppressed = new Float32Array(128);
		this._volumeCounter = 0;
		this._meterPeak = {
			effective: 0,
			raw: 0,
			residual: 0,
			clippedRatio: 0,
			unstableEcho: false,
		};
		this._volumeSkip = 4;

		this.port.onmessage = (ev) => {
			const { type } = ev.data;
			if (type === 'reference') {
				this.referenceBuffer = ev.data.samples;
				this.refLength = this.referenceBuffer ? this.referenceBuffer.length : 0;
				this.isPlaybackActive = true;
			} else if (type === 'playbackStop') {
				this.isPlaybackActive = false;
			} else if (type === 'setEchoSuppression') {
				this.echoSuppression = ev.data.enabled;
			} else if (type === 'setSuppressionGain') {
				this.suppressionGain = Math.max(0, Math.min(1, ev.data.gain));
			}
		};
	}

	process(inputs, outputs) {
		const input = inputs[0]?.[0];
		if (!input) return true;
		const len = input.length;

		let processedInput;

		if (this.refLength > 0 && this.echoSuppression) {
			processedInput = this._applyLMSFilter(input, len);
		} else if (this.isPlaybackActive && this.echoSuppression) {
			if (this._scratchSuppressed.length < len) {
				this._scratchSuppressed = new Float32Array(len);
			}
			for (let i = 0; i < len; i++) {
				this._scratchSuppressed[i] = input[i] * 0.01;
			}
			processedInput = this._scratchSuppressed;
		} else {
			processedInput = input;
		}

		let rawSum = 0;
		let residualSum = 0;
		let clippedSamples = 0;
		for (let i = 0; i < len; i++) {
			const raw = input[i];
			rawSum += raw * raw;
			const s = processedInput[i];
			const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
			if (clamped !== s) clippedSamples++;
			residualSum += clamped * clamped;
			this.buffer[this.writePos++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;

			if (this.writePos >= this.threshold) {
				const int16 = new Int16Array(this.threshold);
				for (let j = 0; j < this.threshold; j++) {
					int16[j] = this.buffer[j];
				}
				this.port.postMessage({ type: 'audio', samples: int16.buffer }, [int16.buffer]);
				const remaining = this.writePos - this.threshold;
				if (remaining > 0) {
					this.buffer.copyWithin(0, this.threshold, this.writePos);
				}
				this.writePos = remaining;
			}
		}

		const metrics = this._buildFrameMetrics({
			rawSum,
			residualSum,
			clippedSamples,
			len,
		});
		if (metrics.effective > this._meterPeak.effective) this._meterPeak.effective = metrics.effective;
		if (metrics.raw > this._meterPeak.raw) this._meterPeak.raw = metrics.raw;
		if (metrics.residual > this._meterPeak.residual) this._meterPeak.residual = metrics.residual;
		if (metrics.clippedRatio > this._meterPeak.clippedRatio) this._meterPeak.clippedRatio = metrics.clippedRatio;
		if (metrics.unstableEcho) this._meterPeak.unstableEcho = true;
		this._volumeCounter++;
		if (this._volumeCounter >= this._volumeSkip) {
			this.port.postMessage({ type: 'volume', value: this._meterPeak });
			this._volumeCounter = 0;
			this._meterPeak = {
				effective: 0,
				raw: 0,
				residual: 0,
				clippedRatio: 0,
				unstableEcho: false,
			};
		}

		return true;
	}

	_buildFrameMetrics({ rawSum, residualSum, clippedSamples, len }) {
		const rawRms = Math.sqrt(rawSum / len);
		const residualRms = Math.sqrt(residualSum / len);
		const clippedRatio = clippedSamples / len;
		let effective = residualRms;
		let unstableEcho = false;

		if (this.isPlaybackActive && this.echoSuppression) {
			const overshootLimit = rawRms * 1.15 + 0.02;
			if (residualRms > overshootLimit || clippedRatio > 0.08) {
				unstableEcho = true;
			}
			effective = Math.min(effective, overshootLimit);
		}

		return {
			effective,
			raw: rawRms,
			residual: residualRms,
			clippedRatio,
			unstableEcho,
		};
	}

	_applyLMSFilter(micSignal, len) {
		if (this._scratchOutput.length < len) {
			this._scratchOutput = new Float32Array(len);
		}
		const output = this._scratchOutput;
		const refLen = Math.min(this.refLength, len);
		const filterOrder = this.filterOrder;
		const coeffs = this.filterCoeffs;
		const refHist = this.referenceHistory;

		for (let i = 0; i < len; i++) {
			const refSample = i < refLen ? this.referenceBuffer[i] : 0;

			refHist[this.historyIndex] = refSample;
			this.historyIndex = (this.historyIndex + 1) % filterOrder;

			let echoEstimate = 0;
			for (let j = 0; j < filterOrder; j++) {
				echoEstimate += coeffs[j] * refHist[(this.historyIndex + j) % filterOrder];
			}

			const error = micSignal[i] - echoEstimate;

			this.refPower = 0.99 * this.refPower + 0.01 * (refSample * refSample);
			const step = this.stepSize / (this.refPower + this.epsilon);

			for (let j = 0; j < filterOrder; j++) {
				coeffs[j] += step * error * refHist[(this.historyIndex + j) % filterOrder];
			}

			output[i] = error;
		}

		this.referenceBuffer = null;
		this.refLength = 0;
		this.isPlaybackActive = true;

		return output;
	}
}

registerProcessor('capture-processor', CaptureProcessor);
`;

export class AudioCapture extends Emitter {
	constructor() {
		super();
		this.ctx = null;
		this.stream = null;
		this.workletNode = null;
		this.active = false;
	}

	async start(retries = 2) {
		this.stop();
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
		});
		this.ctx = new AudioContext({ sampleRate: 16000 });

		const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
		const url = URL.createObjectURL(blob);
		try {
			await this.ctx.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}

		try {
			const source = this.ctx.createMediaStreamSource(this.stream);
			this.workletNode = new AudioWorkletNode(this.ctx, 'capture-processor');

			this.workletNode.port.onmessage = (ev) => {
				const { type, value, samples } = ev.data;
				if (type === 'volume') {
					this.emit('volume', value);
				} else if (type === 'audio') {
					this.emit('data', this._arrayBufferToBase64(samples));
				}
			};

			source.connect(this.workletNode);
			const silentGain = this.ctx.createGain();
			silentGain.gain.value = 0;
			this.workletNode.connect(silentGain);
			silentGain.connect(this.ctx.destination);
			this.active = true;
			this.emit('started');
		} catch (err) {
			this.stop();
			if (retries > 0) {
				await new Promise(r => setTimeout(r, 300));
				return this.start(retries - 1);
			}
			throw err;
		}
	}

	stop() {
		this.active = false;
		if (this.workletNode) {
			try { this.workletNode.disconnect(); } catch {}
			this.workletNode = null;
		}
		if (this.stream) {
			this.stream.getTracks().forEach(t => t.stop());
			this.stream = null;
		}
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
		this.emit('stopped');
	}

	_arrayBufferToBase64(buffer) {
		const bytes = new Uint8Array(buffer);
		const len = bytes.length;
		const CHUNK = 8192;
		let binary = '';
		for (let i = 0; i < len; i += CHUNK) {
			const end = Math.min(i + CHUNK, len);
			binary += String.fromCharCode.apply(null, bytes.subarray(i, end));
		}
		return btoa(binary);
	}

	sendReferenceSignal(float32Samples) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'reference',
			samples: float32Samples
		});
	}

	setEchoSuppression(enabled) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'setEchoSuppression',
			enabled: !!enabled
		});
	}

	setSuppressionGain(gain) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'setSuppressionGain',
			gain: Math.max(0, Math.min(1, gain))
		});
	}

	notifyPlaybackStop() {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({ type: 'playbackStop' });
	}
}
