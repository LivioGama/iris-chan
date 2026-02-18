// Mic capture via AudioWorklet -> PCM16 16kHz chunks
import { Emitter } from '../../shared/emitter.js';

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = [];
		this.threshold = 2048; // ~128ms at 16kHz
		this.referenceBuffer = [];
		this.echoSuppression = true;
		this.suppressionGain = 1.0;
		this.isPlaybackActive = false;
		// LMS Adaptive Filter for echo cancellation (same algorithm as WebRTC)
		this.filterOrder = 512; // Length of adaptive filter
		this.filterCoeffs = new Float32Array(this.filterOrder); // Weights
		this.referenceHistory = new Float32Array(this.filterOrder); // Recent ref samples
		this.historyIndex = 0;
		this.stepSize = 0.01; // Learning rate for adaptation
		this.refPower = 0; // Running estimate of reference signal power
		this.epsilon = 1e-5; // Small value to avoid division by zero

		// Set up message handler for IPC from main thread
		this._setupMessageHandler();
	}

	_setupMessageHandler() {
		this.port.onmessage = (ev) => {
			if (ev.data.type === 'reference') {
				this.referenceBuffer = ev.data.samples;
				this.isPlaybackActive = true;
			} else if (ev.data.type === 'playbackStop') {
				this.isPlaybackActive = false;
			} else if (ev.data.type === 'setEchoSuppression') {
				this.echoSuppression = ev.data.enabled;
			} else if (ev.data.type === 'setSuppressionGain') {
				this.suppressionGain = Math.max(0, Math.min(1, ev.data.gain));
			}
		};
	}

	process(inputs, outputs) {
		const input = inputs[0]?.[0];
		if (!input) return true;

		let processedInput;

		if (this.referenceBuffer.length > 0 && this.echoSuppression) {
			// Use LMS adaptive filter with reference signal (most effective)
			processedInput = this._applyLMSFilter(input);
		} else if (this.isPlaybackActive && this.echoSuppression) {
			// Fallback: heavy suppression when playback is active but no reference
			processedInput = new Float32Array(input.length);
			for (let i = 0; i < input.length; i++) {
				processedInput[i] = input[i] * 0.01; // 99% suppression
			}
		} else {
			// No echo cancellation needed
			processedInput = input;
		}

		// Convert float32 to int16
		for (let i = 0; i < processedInput.length; i++) {
			const s = Math.max(-1, Math.min(1, processedInput[i]));
			this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
		}

		// Compute RMS for volume
		let sum = 0;
		for (let i = 0; i < processedInput.length; i++) {
			sum += processedInput[i] * processedInput[i];
		}
		const rms = Math.sqrt(sum / processedInput.length);
		this.port.postMessage({ type: 'volume', value: rms });

		// Flush when buffer is large enough
		if (this.buffer.length >= this.threshold) {
			const samples = this.buffer.splice(0, this.threshold);
			const int16 = new Int16Array(samples);
			this.port.postMessage({ type: 'audio', samples: int16.buffer }, [int16.buffer]);
		}

		return true;
	}

	_applyLMSFilter(micSignal) {
		// LMS (Least Mean Squares) Adaptive Filter
		// This is the core algorithm used by WebRTC for echo cancellation
		const output = new Float32Array(micSignal.length);
		const refLen = Math.min(this.referenceBuffer.length, micSignal.length);

		for (let i = 0; i < micSignal.length; i++) {
			// Current reference sample
			const refSample = i < refLen ? this.referenceBuffer[i] : 0;

			// Update reference history buffer (circular)
			this.referenceHistory[this.historyIndex] = refSample;
			this.historyIndex = (this.historyIndex + 1) % this.filterOrder;

			// Compute filter output: estimate of echo from reference signal
			let echo_estimate = 0;
			for (let j = 0; j < this.filterOrder; j++) {
				const idx = (this.historyIndex + j) % this.filterOrder;
				echo_estimate += this.filterCoeffs[j] * this.referenceHistory[idx];
			}

			// Error signal: microphone - estimated echo
			const error = micSignal[i] - echo_estimate;

			// Update reference power estimate (for normalization)
			this.refPower = 0.99 * this.refPower + 0.01 * (refSample * refSample);

			// LMS weight update rule: adaptive step-size NLMS (Normalized LMS)
			const normalization = this.refPower + this.epsilon;
			const step = this.stepSize / normalization;

			for (let j = 0; j < this.filterOrder; j++) {
				const idx = (this.historyIndex + j) % this.filterOrder;
				this.filterCoeffs[j] += step * error * this.referenceHistory[idx];
			}

			// Output is the error signal (echo cancelled)
			output[i] = error;
		}

		// Clear reference buffer after processing
		this.referenceBuffer = [];
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
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
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
					const base64 = this._arrayBufferToBase64(samples);
					this.emit('data', base64);
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
			this.workletNode.disconnect();
			this.workletNode = null;
		}
		if (this.stream) {
			this.stream.getTracks().forEach(t => t.stop());
			this.stream = null;
		}
		if (this.ctx) {
			this.ctx.close();
			this.ctx = null;
		}
		this.emit('stopped');
	}

	_arrayBufferToBase64(buffer) {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	// Send reference signal (playback audio) to the worklet for echo suppression
	sendReferenceSignal(float32Samples) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'reference',
			samples: float32Samples
		});
	}

	// Enable/disable software echo suppression in worklet
	setEchoSuppression(enabled) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'setEchoSuppression',
			enabled: !!enabled
		});
	}

	// Set how aggressively to suppress detected echoes (0-1)
	setSuppressionGain(gain) {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({
			type: 'setSuppressionGain',
			gain: Math.max(0, Math.min(1, gain))
		});
	}

	// Notify worklet that playback has stopped (for gating)
	notifyPlaybackStop() {
		if (!this.workletNode) return;
		this.workletNode.port.postMessage({ type: 'playbackStop' });
	}
}
