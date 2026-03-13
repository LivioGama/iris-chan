const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class FakeAnalyserNode {
	constructor() {
		this.frequencyBinCount = 128;
	}

	connect(destination) {
		this.destination = destination;
	}

	getByteTimeDomainData(target) {
		target.fill(128);
	}
}

class FakeGainNode {
	constructor() {
		this.connections = [];
		this.gain = { value: 1 };
	}

	connect(destination) {
		this.connections.push(destination);
		return destination;
	}
}

class FakeBiquadFilterNode {
	constructor() {
		this.connections = [];
		this.type = 'allpass';
		this.frequency = { value: 0 };
		this.gain = { value: 0 };
		this.Q = { value: 0 };
	}

	connect(destination) {
		this.connections.push(destination);
		return destination;
	}
}

class FakeDynamicsCompressorNode {
	constructor() {
		this.connections = [];
		this.threshold = { value: 0 };
		this.knee = { value: 0 };
		this.ratio = { value: 0 };
		this.attack = { value: 0 };
		this.release = { value: 0 };
	}

	connect(destination) {
		this.connections.push(destination);
		return destination;
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
		this.playbackRate = { value: 1 };
	}

	connect(destination) {
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

	createBiquadFilter() {
		return new FakeBiquadFilterNode();
	}

	createDynamicsCompressor() {
		return new FakeDynamicsCompressorNode();
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

console.log('Running audio playback voice profile tests...');

(async () => {
	const originalAudioContext = globalThis.AudioContext;
	const originalAtob = globalThis.atob;
	const originalWindow = globalThis.window;

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
	Object.defineProperty(globalThis, 'window', {
		value: {
			electronAPI: {
				logToFile() {},
			},
		},
		configurable: true,
		writable: true,
	});

	try {
		const playbackModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/playback.js')).href;
		const { AudioPlayback } = await import(playbackModuleUrl);

		const playback = new AudioPlayback();
		playback.setSpeechProfile({
			playbackRate: 0.93,
			pitchSemitones: -2.6,
			lowShelfFrequencyHz: 170,
			lowShelfGainDb: 3.4,
			warmthFrequencyHz: 280,
			warmthGainDb: 2.6,
			presenceFrequencyHz: 2100,
			presenceGainDb: 0.9,
			highShelfFrequencyHz: 4800,
			highShelfGainDb: 0.4,
			outputGain: 1.05,
			compressorThresholdDb: -22,
			compressorKneeDb: 8,
			compressorRatio: 2.8,
			compressorAttackSeconds: 0.003,
			compressorReleaseSeconds: 0.22,
		});
		await playback.init();

		assert.ok(playback.lowShelfFilter, 'expected low-shelf filter to be created');
		assert.ok(playback.presenceFilter, 'expected presence filter to be created');
		assert.ok(playback.highShelfFilter, 'expected high-shelf filter to be created');
		assert.ok(playback.compressorNode, 'expected compressor node to be created');
		assert.strictEqual(playback.lowShelfFilter.type, 'lowshelf');
		assert.strictEqual(playback.warmthFilter.type, 'peaking');
		assert.strictEqual(playback.presenceFilter.type, 'peaking');
		assert.strictEqual(playback.highShelfFilter.type, 'highshelf');
		assert.strictEqual(playback.lowShelfFilter.frequency.value, 170);
		assert.strictEqual(playback.lowShelfFilter.gain.value, 3.4);
		assert.strictEqual(playback.warmthFilter.frequency.value, 280);
		assert.strictEqual(playback.warmthFilter.gain.value, 2.6);
		assert.strictEqual(playback.warmthFilter.Q.value, 0.9);
		assert.strictEqual(playback.presenceFilter.frequency.value, 2100);
		assert.strictEqual(playback.presenceFilter.gain.value, 0.9);
		assert.strictEqual(playback.presenceFilter.Q.value, 0.7);
		assert.strictEqual(playback.highShelfFilter.frequency.value, 4800);
		assert.strictEqual(playback.highShelfFilter.gain.value, 0.4);
		assert.strictEqual(playback.compressorNode.threshold.value, -22);
		assert.strictEqual(playback.compressorNode.knee.value, 8);
		assert.strictEqual(playback.compressorNode.ratio.value, 2.8);
		assert.strictEqual(playback.compressorNode.attack.value, 0.003);
		assert.strictEqual(playback.compressorNode.release.value, 0.22);
		assert.strictEqual(playback.gainNode.gain.value, 1.05);

		const pcmBytes = Buffer.from(new Int16Array([0, 512, -512, 0]).buffer);
		const base64Chunk = pcmBytes.toString('base64');
		await playback.enqueue(base64Chunk);

		assert.strictEqual(playback.sources.length, 1, 'audio chunk should enqueue');
		assert.strictEqual(playback.sources[0].playbackRate.value, 0.93, 'deeper profile should slow playback enough to lower the perceived voice');

		console.log('Audio playback voice profile tests passed.');
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

		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			Object.defineProperty(globalThis, 'window', {
				value: originalWindow,
				configurable: true,
				writable: true,
			});
		}
	}
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
