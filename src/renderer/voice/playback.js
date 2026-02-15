// Plays PCM16 24kHz audio from Gemini via Web Audio API
import { Emitter } from '../../shared/emitter.js';
import { info as logInfo, error as logError } from '../logger.js';

export class AudioPlayback extends Emitter {
	constructor() {
		super();
		this.ctx = null;
		this.gainNode = null;
		this.queue = [];
		this.nextStartTime = 0;
		this.playing = false;
		this.sources = [];
		this.referenceCallback = null;
		this.referenceProcessor = null;
	}

	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	init() {
		if (this.ctx) return;
		this.ctx = new AudioContext({ sampleRate: 24000 });
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 256;
		this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
		this.gainNode = this.ctx.createGain();
		this.gainNode.connect(this.analyser);
		this.analyser.connect(this.ctx.destination);

		// Set up reference signal extraction (for echo cancellation)
		this._setupReferenceExtraction();
	}

	_setupReferenceExtraction() {
		// Instead of using ScriptProcessor (deprecated, timing issues),
		// we'll extract reference signal directly when enqueuing audio
		// This is more reliable for echo cancellation
		this._lastEnqueuedSamples = null;
	}

	// Called when audio is enqueued - extract and send reference signal
	_sendReferenceSignal(float32Samples) {
		if (this.referenceCallback && float32Samples && float32Samples.length > 0) {
			// Resample from 24kHz to 16kHz before sending
			const resampled = this._resample24kTo16k(float32Samples);
			logInfo('Playback', `Reference signal ready: ${float32Samples.length} → ${resampled.length} samples`);
			this.referenceCallback(resampled);
		} else {
			logError('Playback', `Ref signal failed: callback=${!!this.referenceCallback}, samples=${float32Samples?.length}`);
		}
	}

	getVolume() {
		if (!this.analyser || !this.playing) return 0;
		this.analyser.getByteTimeDomainData(this.analyserData);
		let sum = 0;
		for (let i = 0; i < this.analyserData.length; i++) {
			const v = (this.analyserData[i] - 128) / 128;
			sum += v * v;
		}
		return Math.sqrt(sum / this.analyserData.length);
	}

	enqueue(base64Data) {
		this.init();
		if (this.ctx.state === 'suspended') this.ctx.resume();

		const pcm16 = this._base64ToInt16(base64Data);
		const float32 = new Float32Array(pcm16.length);
		for (let i = 0; i < pcm16.length; i++) {
			float32[i] = pcm16[i] / 32768;
		}

		// Send reference signal immediately for echo cancellation
		if (!this._enqueueCount) this._enqueueCount = 0;
		this._enqueueCount++;
		if (this._enqueueCount % 10 === 1) {
			logInfo('Playback', `Enqueuing audio chunk #${this._enqueueCount}: ${float32.length} samples`);
		}
		this._sendReferenceSignal(float32);

		const audioBuffer = this.ctx.createBuffer(1, float32.length, 24000);
		audioBuffer.getChannelData(0).set(float32);

		const source = this.ctx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(this.gainNode);

		const now = this.ctx.currentTime;
		const startTime = Math.max(now, this.nextStartTime);
		source.start(startTime);
		this.nextStartTime = startTime + audioBuffer.duration;

		this.sources.push(source);
		source.onended = () => {
			const idx = this.sources.indexOf(source);
			if (idx >= 0) this.sources.splice(idx, 1);
			if (this.sources.length === 0) {
				this.playing = false;
				this.emit('ended');
			}
		};

		if (!this.playing) {
			this.playing = true;
			this.emit('started');
		}
	}

	stop() {
		if (this.gainNode) {
			const now = this.ctx.currentTime;
			this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
			this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);

			setTimeout(() => {
				for (const src of this.sources) {
					try { src.stop(); } catch {}
				}
				this.sources = [];
				this.gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
			}, 60);
		}

		this.nextStartTime = 0;
		this.playing = false;
		this.queue = [];
		this.emit('stopped');
	}

	// Resample from 24kHz to 16kHz
	_resample24kTo16k(float32Data) {
		const inputLength = float32Data.length;
		const outputLength = Math.floor((inputLength * 16000) / 24000);
		const output = new Float32Array(outputLength);

		const ratio = inputLength / outputLength;
		for (let i = 0; i < outputLength; i++) {
			const pos = i * ratio;
			const index = Math.floor(pos);
			const nextIndex = Math.min(index + 1, inputLength - 1);
			const frac = pos - index;

			// Linear interpolation
			output[i] = float32Data[index] * (1 - frac) + float32Data[nextIndex] * frac;
		}

		return output;
	}

	_base64ToInt16(base64) {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Int16Array(bytes.buffer);
	}
}
