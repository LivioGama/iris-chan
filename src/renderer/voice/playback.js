// Plays PCM16 24kHz audio from Gemini via Web Audio API
import { Emitter } from '../../shared/emitter.js';
import { info as logInfo, error as logError } from '../logger.js';

const DEFAULT_SPEECH_PROFILE = Object.freeze({
	playbackRate: 1,
	pitchSemitones: 0,
	lowShelfFrequencyHz: 170,
	lowShelfGainDb: 0,
	warmthFrequencyHz: 280,
	warmthGainDb: 0,
	warmthQ: 0.9,
	presenceFrequencyHz: 2100,
	presenceGainDb: 0,
	presenceQ: 0.7,
	highShelfFrequencyHz: 4800,
	highShelfGainDb: 0,
	outputGain: 1,
	compressorThresholdDb: -24,
	compressorKneeDb: 8,
	compressorRatio: 2.2,
	compressorAttackSeconds: 0.003,
	compressorReleaseSeconds: 0.2,
});

function buildSpeechProfile(profile = {}) {
	const overrides = profile && typeof profile === 'object' ? profile : {};
	return {
		...DEFAULT_SPEECH_PROFILE,
		...overrides,
	};
}

export class AudioPlayback extends Emitter {
	constructor() {
		super();
		this.ctx = null;
		this.analyser = null;
		this.analyserData = null;
		this.gainNode = null;
		this.nextStartTime = 0;
		this.playing = false;
		this.sources = [];
		this.referenceCallback = null;
		this._float32Scratch = new Float32Array(8192);
		this._resampleScratch = new Float32Array(8192);
		this._generation = 0;
		this._initPromise = null;
		this._catchUpLeadSeconds = 0.2;
		this._catchUpPlaybackRate = 1.04;
		this.speechProfile = buildSpeechProfile();
		this._playbackRate = this.speechProfile.playbackRate;
		this.processingInputNode = null;
		this.lowShelfFilter = null;
		this.warmthFilter = null;
		this.presenceFilter = null;
		this.highShelfFilter = null;
		this.compressorNode = null;
	}

	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	setSpeechProfile(profile) {
		this.speechProfile = buildSpeechProfile(profile);
		this._playbackRate = this._sanitizePlaybackRate(this.speechProfile.playbackRate);
		if (this.ctx) {
			this._configureProcessingGraph();
		}
	}

	async init() {
		if (this._initPromise) return this._initPromise;
		if (this.ctx && this.gainNode && this.analyser) return;

		this._initPromise = (async () => {
			if (!this.ctx) {
				this.ctx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
			}

			if (!this.analyser || !this.gainNode) {
				this.analyser = this.ctx.createAnalyser();
				this.analyser.fftSize = 256;
				this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
				this.gainNode = this.ctx.createGain();
			}
			this._configureProcessingGraph();

			// Route to specific output device if available
			await this._setOutputDevice();
		})();

		try {
			await this._initPromise;
		} finally {
			this._initPromise = null;
		}
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
		await this.init();
		if (this.ctx.state === 'suspended') await this.ctx.resume();

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
		source.connect(this.processingInputNode || this.gainNode);

		const now = this.ctx.currentTime;
		const bufferedLead = Math.max(0, this.nextStartTime - now);
		const playbackRate = this._resolvePlaybackRate(bufferedLead);
		if (source.playbackRate && typeof source.playbackRate.value === 'number') {
			source.playbackRate.value = playbackRate;
		}
		const startTime = Math.max(now, this.nextStartTime);
		source.start(startTime);
		this.nextStartTime = startTime + (audioBuffer.duration / playbackRate);

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

	_sanitizePlaybackRate(value) {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return 1;
		return Math.min(1.08, Math.max(0.8, numeric));
	}

	_resolvePlaybackRate(bufferedLead) {
		const baseRate = this._sanitizePlaybackRate(this._playbackRate);
		if (bufferedLead <= this._catchUpLeadSeconds) {
			return baseRate;
		}
		return Math.max(baseRate, Math.min(1.08, baseRate * this._catchUpPlaybackRate));
	}

	_disconnectNode(node) {
		if (!node || typeof node.disconnect !== 'function') return;
		try {
			node.disconnect();
		} catch {}
	}

	_configureProcessingGraph() {
		if (!this.ctx || !this.gainNode || !this.analyser) return;

		this._disconnectNode(this.lowShelfFilter);
		this._disconnectNode(this.warmthFilter);
		this._disconnectNode(this.presenceFilter);
		this._disconnectNode(this.highShelfFilter);
		this._disconnectNode(this.compressorNode);
		this._disconnectNode(this.gainNode);
		this._disconnectNode(this.analyser);

		this.lowShelfFilter = null;
		this.warmthFilter = null;
		this.presenceFilter = null;
		this.highShelfFilter = null;
		this.compressorNode = null;

		this.gainNode.gain.value = this.speechProfile.outputGain;

		const chain = [];
		if (typeof this.ctx.createBiquadFilter === 'function') {
			this.lowShelfFilter = this.ctx.createBiquadFilter();
			this.lowShelfFilter.type = 'lowshelf';
			this.lowShelfFilter.frequency.value = this.speechProfile.lowShelfFrequencyHz;
			this.lowShelfFilter.gain.value = this.speechProfile.lowShelfGainDb;
			chain.push(this.lowShelfFilter);

			this.warmthFilter = this.ctx.createBiquadFilter();
			this.warmthFilter.type = 'peaking';
			this.warmthFilter.frequency.value = this.speechProfile.warmthFrequencyHz;
			this.warmthFilter.gain.value = this.speechProfile.warmthGainDb;
			this.warmthFilter.Q.value = this.speechProfile.warmthQ;
			chain.push(this.warmthFilter);

			this.presenceFilter = this.ctx.createBiquadFilter();
			this.presenceFilter.type = 'peaking';
			this.presenceFilter.frequency.value = this.speechProfile.presenceFrequencyHz;
			this.presenceFilter.gain.value = this.speechProfile.presenceGainDb;
			this.presenceFilter.Q.value = this.speechProfile.presenceQ;
			chain.push(this.presenceFilter);

			this.highShelfFilter = this.ctx.createBiquadFilter();
			this.highShelfFilter.type = 'highshelf';
			this.highShelfFilter.frequency.value = this.speechProfile.highShelfFrequencyHz;
			this.highShelfFilter.gain.value = this.speechProfile.highShelfGainDb;
			chain.push(this.highShelfFilter);
		}

		if (typeof this.ctx.createDynamicsCompressor === 'function') {
			this.compressorNode = this.ctx.createDynamicsCompressor();
			this.compressorNode.threshold.value = this.speechProfile.compressorThresholdDb;
			this.compressorNode.knee.value = this.speechProfile.compressorKneeDb;
			this.compressorNode.ratio.value = this.speechProfile.compressorRatio;
			this.compressorNode.attack.value = this.speechProfile.compressorAttackSeconds;
			this.compressorNode.release.value = this.speechProfile.compressorReleaseSeconds;
			chain.push(this.compressorNode);
		}

		let currentNode = this.gainNode;
		for (const node of chain) {
			currentNode.connect(node);
			currentNode = node;
		}
		currentNode.connect(this.analyser);
		this.analyser.connect(this.ctx.destination);
		this.processingInputNode = chain[0] || this.gainNode;
	}

	stop() {
		this._generation++;
		if (this.gainNode && this.ctx) {
			const now = this.ctx.currentTime;
			this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
			this.gainNode.gain.linearRampToValueAtTime(0, now + 0.02);

			const sourcesToStop = [...this.sources];
			setTimeout(() => {
				for (const src of sourcesToStop) {
					try { src.stop(); } catch {}
				}
				if (this.gainNode && this.ctx) {
					this.gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
				}
			}, 25);
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
