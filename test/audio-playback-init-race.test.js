const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function createConnectError() {
	return new TypeError("Failed to execute 'connect' on 'AudioNode': Overload resolution failed.");
}

class FakeAnalyserNode {
	constructor() {
		this.frequencyBinCount = 128;
	}

	connect(destination) {
		if (!destination) throw createConnectError();
	}

	getByteTimeDomainData(target) {
		target.fill(128);
	}
}

class FakeGainNode {
	constructor() {
		this.gain = {
			value: 1,
			setValueAtTime(value) {
				this.value = value;
			},
			linearRampToValueAtTime(value) {
				this.value = value;
			},
		};
	}

	connect(destination) {
		if (!destination) throw createConnectError();
	}
}

class FakeAudioBuffer {
	constructor(length, sampleRate) {
		this.duration = length / sampleRate;
		this._channelData = [new Float32Array(length)];
	}

	getChannelData(index) {
		return this._channelData[index];
	}
}

class FakeBufferSourceNode {
	constructor() {
		this.buffer = null;
		this.onended = null;
	}

	connect(destination) {
		if (!destination) throw createConnectError();
		this.destination = destination;
	}

	start(when) {
		this.startedAt = when;
	}

	stop() {}
}

class FakeAudioContext {
	constructor({ sampleRate }) {
		this.sampleRate = sampleRate;
		this.destination = { kind: 'destination' };
		this.currentTime = 0;
		this.state = 'running';
	}

	createAnalyser() {
		return new FakeAnalyserNode();
	}

	createGain() {
		return new FakeGainNode();
	}

	createBuffer(channels, length, sampleRate) {
		return new FakeAudioBuffer(length, sampleRate);
	}

	createBufferSource() {
		return new FakeBufferSourceNode();
	}

	async resume() {
		this.state = 'running';
	}
}

console.log('Running audio playback init race tests...');

(async () => {
	const originalAudioContext = globalThis.AudioContext;
	const originalAtob = globalThis.atob;

	Object.defineProperty(globalThis, 'AudioContext', {
		value: FakeAudioContext,
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, 'atob', {
		value: (base64) => Buffer.from(base64, 'base64').toString('binary'),
		configurable: true,
		writable: true,
	});

	try {
		const playbackModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/playback.js')).href;
		const { AudioPlayback } = await import(playbackModuleUrl);

		class BuggyAudioPlayback extends AudioPlayback {
			async init() {
				if (this.ctx) return;
				this.ctx = new AudioContext({ sampleRate: 24000 });
				await this._setOutputDevice();
				this.analyser = this.ctx.createAnalyser();
				this.analyser.fftSize = 256;
				this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
				this.gainNode = this.ctx.createGain();
				this.gainNode.connect(this.analyser);
				this.analyser.connect(this.ctx.destination);
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
			}
		}

		const pcmBytes = Buffer.from(new Int16Array([0, 512, -512, 0]).buffer);
		const base64Chunk = pcmBytes.toString('base64');

		const buggyPlayback = new BuggyAudioPlayback();
		buggyPlayback._setOutputDevice = async () => {
			await delay(25);
		};

		await assert.rejects(
			Promise.all([
				buggyPlayback.enqueue(base64Chunk),
				buggyPlayback.enqueue(base64Chunk),
			]),
			/connect.*Overload resolution failed/
		);

		const fixedPlayback = new AudioPlayback();
		fixedPlayback._setOutputDevice = async () => {
			await delay(25);
		};

		await Promise.all([
			fixedPlayback.enqueue(base64Chunk),
			fixedPlayback.enqueue(base64Chunk),
		]);

		assert.ok(fixedPlayback.gainNode, 'gain node should exist before any source connects');
		assert.strictEqual(fixedPlayback.sources.length, 2, 'both first chunks should enqueue successfully');

		console.log('Audio playback init race tests passed.');
	} finally {
		if (originalAudioContext === undefined) {
			delete globalThis.AudioContext;
		} else {
			Object.defineProperty(globalThis, 'AudioContext', {
				value: originalAudioContext,
				configurable: true,
				writable: true,
			});
		}

		if (originalAtob === undefined) {
			delete globalThis.atob;
		} else {
			Object.defineProperty(globalThis, 'atob', {
				value: originalAtob,
				configurable: true,
				writable: true,
			});
		}
	}
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
