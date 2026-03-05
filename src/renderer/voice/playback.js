// Plays PCM16 24kHz audio from Gemini via Web Audio API
import { Emitter } from '../../shared/emitter.js';
import { info as logInfo, error as logError } from '../logger.js';

export class AudioPlayback extends Emitter {
	constructor() {
		super();
		this.ctx = null;
		this.gainNode = null;
		this.nextStartTime = 0;
		this.playing = false;
		this.sources = [];
		this.referenceCallback = null;
		this._float32Scratch = new Float32Array(8192);
		this._resampleScratch = new Float32Array(8192);
		this._generation = 0;
	}

	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	async init() {
		if (this.ctx) return;
		this.ctx = new AudioContext({ sampleRate: 24000 });

		// Route to specific output device if available
		await this._setOutputDevice();

		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 256;
		this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
		this.gainNode = this.ctx.createGain();
		this.gainNode.connect(this.analyser);
		this.analyser.connect(this.ctx.destination);
	}

	async _setOutputDevice(preferredName) {
		if (!this.ctx?.setSinkId) {
			logInfo('Playback', 'setSinkId not supported, using system default');
			return;
		}
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			const outputs = devices.filter(d => d.kind === 'audiooutput');
			logInfo('Playback', `Available outputs: ${outputs.map(d => d.label).join(', ')}`);

			const name = preferredName || this._preferredOutput;
			if (name) {
				const match = outputs.find(d => d.label.toLowerCase().includes(name.toLowerCase()));
				if (match) {
					await this.ctx.setSinkId(match.deviceId);
					logInfo('Playback', `Output device set to: ${match.label}`);
					return;
				}
				logError('Playback', `Output device "${name}" not found, using default`);
			}
		} catch (err) {
			logError('Playback', `Failed to set output device: ${err.message}`);
		}
	}

	async setOutputDevice(name) {
		this._preferredOutput = name;
		if (this.ctx) await this._setOutputDevice(name);
	}

	_sendReferenceSignal(float32Samples) {
		if (this.referenceCallback && float32Samples.length > 0) {
			this.referenceCallback(this._resample24kTo16k(float32Samples));
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

	async enqueue(base64Data) {
		if (!this.ctx) await this.init();
		if (this.ctx.state === 'suspended') this.ctx.resume();

		const pcm16 = this._base64ToInt16(base64Data);
		if (pcm16.length > this._float32Scratch.length) {
			this._float32Scratch = new Float32Array(pcm16.length * 2);
		}
		const float32 = this._float32Scratch.subarray(0, pcm16.length);
		for (let i = 0; i < pcm16.length; i++) {
			float32[i] = pcm16[i] / 32768;
		}

		// Send reference signal for echo cancellation
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
		const gen = this._generation;
		source.onended = () => {
			if (gen !== this._generation) return;
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
		this._generation++;
		if (this.gainNode && this.ctx) {
			const now = this.ctx.currentTime;
			this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
			this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);

			const sourcesToStop = [...this.sources];
			setTimeout(() => {
				for (const src of sourcesToStop) {
					try { src.stop(); } catch {}
				}
				if (this.gainNode && this.ctx) {
					this.gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
				}
			}, 60);
		}

		this.sources = [];
		this.nextStartTime = 0;
		this.playing = false;
		this.emit('stopped');
	}

	_resample24kTo16k(float32Data) {
		const inputLength = float32Data.length;
		const outputLength = Math.floor((inputLength * 2) / 3); // 16000/24000 = 2/3
		if (outputLength > this._resampleScratch.length) {
			this._resampleScratch = new Float32Array(outputLength * 2);
		}
		const output = this._resampleScratch.subarray(0, outputLength);
		const ratio = inputLength / outputLength;

		for (let i = 0; i < outputLength; i++) {
			const pos = i * ratio;
			const index = Math.floor(pos);
			const frac = pos - index;
			const next = Math.min(index + 1, inputLength - 1);
			output[i] = float32Data[index] * (1 - frac) + float32Data[next] * frac;
		}

		return output;
	}

	_base64ToInt16(base64) {
		const binary = atob(base64);
		const len = binary.length;
		const bytes = new Uint8Array(len);
		for (let i = 0; i < len; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Int16Array(bytes.buffer);
	}
}
