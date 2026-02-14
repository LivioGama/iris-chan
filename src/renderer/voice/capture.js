// Mic capture via AudioWorklet -> PCM16 16kHz chunks
import { Emitter } from '../../shared/emitter.js';

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = [];
		this.threshold = 2048; // ~128ms at 16kHz
	}

	process(inputs) {
		const input = inputs[0]?.[0];
		if (!input) return true;

		// Convert float32 to int16
		for (let i = 0; i < input.length; i++) {
			const s = Math.max(-1, Math.min(1, input[i]));
			this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
		}

		// Compute RMS for volume
		let sum = 0;
		for (let i = 0; i < input.length; i++) {
			sum += input[i] * input[i];
		}
		const rms = Math.sqrt(sum / input.length);
		this.port.postMessage({ type: 'volume', value: rms });

		// Flush when buffer is large enough
		if (this.buffer.length >= this.threshold) {
			const samples = this.buffer.splice(0, this.threshold);
			const int16 = new Int16Array(samples);
			this.port.postMessage({ type: 'audio', samples: int16.buffer }, [int16.buffer]);
		}

		return true;
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

	async start() {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

		this.ctx = new AudioContext({ sampleRate: 16000 });

		const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
		const url = URL.createObjectURL(blob);
		await this.ctx.audioWorklet.addModule(url);
		URL.revokeObjectURL(url);

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
}
