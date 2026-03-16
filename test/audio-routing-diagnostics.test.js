const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

	disconnect() {}

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

	disconnect() {}
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

	createBuffer(_channels, length, sampleRate) {
		return new FakeAudioBuffer(length, sampleRate);
	}

	createBufferSource() {
		return new FakeBufferSourceNode();
	}

	async resume() {
		this.state = 'running';
	}
}

console.log('Running audio routing diagnostics tests...');

(async () => {
	const originalWindow = globalThis.window;
	const originalWebSocket = globalThis.WebSocket;
	const originalAudioContext = globalThis.AudioContext;
	const originalAtob = globalThis.atob;
	const originalPhrase = process.env.IRIS_AUDIO_ROUTING_TEST_PHRASE;
	const originalEnabled = process.env.IRIS_AUDIO_ROUTING_DIAGNOSTICS;

	process.env.IRIS_AUDIO_ROUTING_TEST_PHRASE = 'Testing audio routing 123.';
	process.env.IRIS_AUDIO_ROUTING_DIAGNOSTICS = '1';

	Object.defineProperty(globalThis, 'window', {
		value: {
			electronAPI: {
				getSkillDeclarations: async () => [],
				getSkillPrompts: async () => [],
				getSkillCatalog: async () => [],
				logToFile() {},
			},
		},
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, 'WebSocket', {
		value: { OPEN: 1 },
		configurable: true,
		writable: true,
	});
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
		const helperUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/audio-routing-diagnostics.js')).href;
		const captureUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/capture.js')).href;
		const playbackUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/playback.js')).href;
		const clientUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;

		const {
			getAudioRoutingDiagnosticsState,
			resetAudioRoutingDiagnosticsForTest,
		} = await import(helperUrl);
		const { AudioCapture } = await import(captureUrl);
		const { AudioPlayback } = await import(playbackUrl);
		const { GeminiClient } = await import(clientUrl);

		resetAudioRoutingDiagnosticsForTest();

		const capture = new AudioCapture();
		let emittedBase64 = '';
		capture.on('data', (base64) => {
			emittedBase64 = base64;
		});
		const captureSamples = new Int16Array([0, 1200, -1200, 0]);
		capture._handleWorkletMessage({ type: 'audio', samples: captureSamples.buffer });
		assert.ok(emittedBase64.length > 0, 'expected capture to emit a base64 audio chunk');
		assert.strictEqual(
			getAudioRoutingDiagnosticsState().capture.chunkCount,
			1,
			'expected capture diagnostics to count emitted chunks',
		);

		const client = new GeminiClient();
		client.sessionReady = true;
		client.ws = {
			readyState: 1,
			send() {},
		};
		client.sendAudio(emittedBase64);
		client._handleMessage({
			serverContent: {
				inputTranscription: { text: 'Testing audio routing 123.' },
				modelTurn: {
					parts: [{ inlineData: { data: emittedBase64 } }],
				},
			},
		});

		const playback = new AudioPlayback();
		playback._setOutputDevice = async () => {};
		await playback.enqueue(emittedBase64);
		assert.strictEqual(playback.sources.length, 1, 'expected playback to queue one source');
		playback.sources[0].onended?.();

		const diagnostics = getAudioRoutingDiagnosticsState();
		assert.strictEqual(diagnostics.gemini.outboundChunkCount, 1, 'expected one outbound chunk to reach Gemini');
		assert.strictEqual(diagnostics.gemini.inboundChunkCount, 1, 'expected one inbound model audio chunk');
		assert.strictEqual(diagnostics.playback.chunkCount, 1, 'expected one playback chunk to be observed');
		assert.ok(diagnostics.activeTrace, 'expected the routing phrase to open an active diagnostic trace');
		assert.strictEqual(
			diagnostics.activeTrace.transcript,
			'Testing audio routing 123.',
			'expected the phrase trace to retain the matched transcript',
		);
		assert.ok(
			diagnostics.activeTrace.geminiAudioReceivedAt > 0,
			'expected phrase trace to record model audio receipt',
		);
		assert.ok(
			diagnostics.activeTrace.playbackStartedAt > 0,
			'expected phrase trace to record playback start',
		);
		assert.ok(
			diagnostics.activeTrace.playbackEndedAt > 0,
			'expected phrase trace to record playback completion',
		);
		assert.ok(
			diagnostics.events.some((entry) => entry.stage === 'phrase_detected'),
			'expected diagnostics to record phrase detection',
		);
		assert.ok(
			diagnostics.events.some((entry) => entry.stage === 'gemini_audio_received_for_phrase'),
			'expected diagnostics to record model audio for the phrase',
		);
		assert.ok(
			diagnostics.events.some((entry) => entry.stage === 'playback_started_for_phrase'),
			'expected diagnostics to record phrase playback start',
		);

		console.log('Audio routing diagnostics tests passed.');
	} finally {
		if (originalPhrase === undefined) {
			delete process.env.IRIS_AUDIO_ROUTING_TEST_PHRASE;
		} else {
			process.env.IRIS_AUDIO_ROUTING_TEST_PHRASE = originalPhrase;
		}
		if (originalEnabled === undefined) {
			delete process.env.IRIS_AUDIO_ROUTING_DIAGNOSTICS;
		} else {
			process.env.IRIS_AUDIO_ROUTING_DIAGNOSTICS = originalEnabled;
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
		if (originalWebSocket === undefined) {
			delete globalThis.WebSocket;
		} else {
			Object.defineProperty(globalThis, 'WebSocket', {
				value: originalWebSocket,
				configurable: true,
				writable: true,
			});
		}
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
	process.exitCode = 1;
});
