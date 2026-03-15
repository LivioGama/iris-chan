const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// --- Mock infrastructure (matches voice-barge-in-gate.test.js patterns) ---

class MockEmitter {
	constructor() {
		this.listeners = new Map();
	}

	on(event, fn) {
		const list = this.listeners.get(event) || [];
		list.push(fn);
		this.listeners.set(event, list);
		return this;
	}

	emit(event, ...args) {
		for (const fn of this.listeners.get(event) || []) {
			fn(...args);
		}
	}
}

class FakeGemini extends MockEmitter {
	constructor() {
		super();
		this.sentAudio = [];
	}

	sendAudio(chunk) {
		this.sentAudio.push(chunk);
	}

	sendText() {}
	sendToolResponse() {}
	sendVocabUpdate() {}
	sendRealtimeText() {}
	sendImage() {}
}

class FakeCapture extends MockEmitter {
	constructor() {
		super();
		this.echoSuppressionEnabled = false;
		this.suppressionGain = 0;
	}

	setEchoSuppression(enabled) {
		this.echoSuppressionEnabled = !!enabled;
	}
	setSuppressionGain(gain) {
		this.suppressionGain = gain;
	}
	sendReferenceSignal() {}
	notifyPlaybackStop() {}
	start() {}
	stop() {}
}

class FakePlayback extends MockEmitter {
	constructor() {
		super();
		this.playing = false;
	}

	setReferenceCallback() {}
	enqueue() {}
	stop() {
		this.playing = false;
	}
	getVolume() {
		return 0;
	}
}

class FakeElement {
	constructor(tagName, doc) {
		this.tagName = tagName;
		this.doc = doc;
		this.children = [];
		this.parentNode = null;
		this.dataset = {};
		this.attributes = {};
		this.className = '';
		this.textContent = '';
		this.innerHTML = '';
		this.id = '';
		this.classList = {
			add: () => {},
			remove: () => {},
			toggle: () => {},
		};
	}

	appendChild(child) {
		child.parentNode = this;
		this.children.push(child);
		if (child.id) this.doc.byId.set(child.id, child);
		return child;
	}

	setAttribute(name, value) {
		this.attributes[name] = value;
	}

	remove() {
		if (!this.parentNode) return;
		this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
		this.parentNode = null;
	}
}

function installDomStubs() {
	const originalWindow = global.window;
	const originalDocument = global.document;
	const originalRAF = global.requestAnimationFrame;

	const document = {
		byId: new Map(),
		body: null,
		createElement(tagName) {
			return new FakeElement(tagName, document);
		},
		getElementById(id) {
			return this.byId.get(id) || null;
		},
	};
	document.body = new FakeElement('body', document);

	const bubbles = document.createElement('div');
	bubbles.id = 'bubbles';
	document.byId.set('bubbles', bubbles);
	document.body.appendChild(bubbles);

	const autoBadge = document.createElement('div');
	autoBadge.id = 'auto-badge';
	document.byId.set('auto-badge', autoBadge);
	document.body.appendChild(autoBadge);

	global.document = document;
	global.window = {
		electronAPI: {
			logToFile() {},
			trackVocabulary() {},
			addCorrection() {},
			saveConversationTurn() {},
			searchHide() {},
			endSession() {},
			executeTool: async () => ({ ok: true, result: 'ok' }),
			stopUiTask: async () => {},
		},
	};
	global.requestAnimationFrame = (fn) => {
		if (typeof fn === 'function') fn();
		return 0;
	};

	return () => {
		global.window = originalWindow;
		global.document = originalDocument;
		global.requestAnimationFrame = originalRAF;
	};
}

function withFakeTime(startAt) {
	const originalNow = Date.now;
	let now = startAt;
	Date.now = () => now;
	return {
		advance(ms) {
			now += ms;
		},
		restore() {
			Date.now = originalNow;
		},
	};
}

function withFakeTimers() {
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;
	let nextId = 1;
	const timers = new Map();

	global.setTimeout = (fn, delay = 0, ...args) => {
		const id = nextId++;
		timers.set(id, { fn, delay, args });
		return id;
	};

	global.clearTimeout = (id) => {
		timers.delete(id);
	};

	return {
		activeCount() {
			return timers.size;
		},
		restore() {
			global.setTimeout = originalSetTimeout;
			global.clearTimeout = originalClearTimeout;
			timers.clear();
		},
	};
}

function createVoiceHarness(VoiceEngine) {
	const gemini = new FakeGemini();
	const capture = new FakeCapture();
	const playback = new FakePlayback();
	const behavior = {
		noteUserActivity() {},
		noteIdleResponseSent() {},
		resetIdleGate() {},
		setMode() {},
		sanitize(text) { return text; },
		canSpeakProactively() { return true; },
		noteAssistantSpoke() {},
	};
	const screen = {
		isRunning: false,
		capture() { return Promise.resolve(); },
		start() { this.isRunning = true; },
		stop() { this.isRunning = false; },
		setLastUserSpeechTime() {},
		setIdleGateClosed() {},
		setAutonomousMode() {},
	};
	const claudeCodeBatcher = {
		start() {},
		stop() {},
		addLine() {},
		handleDone() {},
	};

	const voice = new VoiceEngine({
		gemini,
		capture,
		playback,
		behavior,
		screen,
		claudeCodeBatcher,
	});

	return { voice, gemini, capture, playback };
}

// --- WAV parsing ---

function parseWavToChunks(wavPath, samplesPerChunk = 512) {
	const buf = fs.readFileSync(wavPath);

	// Validate RIFF/WAVE header
	assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF', 'expected RIFF header');
	assert.strictEqual(buf.toString('ascii', 8, 12), 'WAVE', 'expected WAVE format');

	// Find 'data' sub-chunk
	let dataOffset = 12;
	while (dataOffset < buf.length - 8) {
		const id = buf.toString('ascii', dataOffset, dataOffset + 4);
		const size = buf.readUInt32LE(dataOffset + 4);
		if (id === 'data') {
			dataOffset += 8; // skip chunk header
			break;
		}
		dataOffset += 8 + size;
	}

	const pcm = buf.subarray(dataOffset);
	const sampleCount = Math.floor(pcm.length / 2);
	const chunks = [];
	const volumes = [];

	for (let offset = 0; offset + samplesPerChunk <= sampleCount; offset += samplesPerChunk) {
		const byteStart = offset * 2;
		const byteEnd = byteStart + samplesPerChunk * 2;
		const slice = pcm.subarray(byteStart, byteEnd);
		chunks.push(Buffer.from(slice).toString('base64'));

		// Compute RMS volume (normalized to 0-1)
		let sumSq = 0;
		for (let i = 0; i < samplesPerChunk; i++) {
			const sample = pcm.readInt16LE(byteStart + i * 2) / 32768;
			sumSq += sample * sample;
		}
		volumes.push(Math.sqrt(sumSq / samplesPerChunk));
	}

	return { chunks, volumes };
}

// --- Tests ---

console.log('Running local pipeline e2e tests...');

(async () => {
	const restoreDom = installDomStubs();
	const clock = withFakeTime(10_000);
	const timers = withFakeTimers();

	try {
		const voiceModuleUrl = pathToFileURL(
			path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')
		).href;
		const { VoiceEngine } = await import(voiceModuleUrl);

		const wavPath = path.join(process.cwd(), 'test/fixtures/hey-how-are-you.wav');
		const { chunks, volumes } = parseWavToChunks(wavPath);
		assert.ok(chunks.length > 0, 'WAV fixture should produce at least one chunk');

		// Test: real TTS audio flows through listening gate to Gemini boundary
		{
			const { voice, gemini, capture } = createVoiceHarness(VoiceEngine);

			// Trigger capture start → state becomes LISTENING, gate begins
			capture.emit('started');
			assert.strictEqual(voice.state, 'LISTENING', 'should start in LISTENING after capture started');

			let gateOpenedAtChunk = -1;

			for (let i = 0; i < chunks.length; i++) {
				// Emit audio data (buffered by listening gate)
				capture.emit('data', chunks[i]);

				// Advance time by 32ms per chunk (512 samples at 16kHz)
				clock.advance(32);

				// Emit volume reading
				capture.emit('volume', {
					effective: volumes[i],
					raw: volumes[i],
					residual: volumes[i],
					clippedRatio: 0,
					unstableEcho: false,
				});

				if (gateOpenedAtChunk === -1 && voice.state === 'USER_SPEAKING') {
					gateOpenedAtChunk = i;
				}
			}

			// 1. Gate should have opened (state transitioned to USER_SPEAKING)
			assert.strictEqual(
				voice.state,
				'USER_SPEAKING',
				'real speech audio should trigger the listening gate and move to USER_SPEAKING'
			);

			// 2. Gate should have opened within a reasonable time frame
			// minSpeechMs=180, each chunk is 32ms, so gate needs ~6 chunks minimum
			assert.ok(
				gateOpenedAtChunk >= 5 && gateOpenedAtChunk <= 20,
				`gate should open between chunk 5-20 (opened at chunk ${gateOpenedAtChunk})`
			);

			// 3. Audio should have reached Gemini boundary
			assert.ok(
				gemini.sentAudio.length > 0,
				'audio chunks should be forwarded to Gemini after gate confirmation'
			);

			// 4. All audio should eventually reach Gemini:
			//    - buffered chunks are flushed on confirmation
			//    - live chunks stream directly after confirmation
			assert.strictEqual(
				gemini.sentAudio.length,
				chunks.length,
				`all ${chunks.length} audio chunks should reach Gemini (got ${gemini.sentAudio.length})`
			);

			// 5. Audio integrity — decoded chunks should be valid PCM16 of correct size
			for (let i = 0; i < gemini.sentAudio.length; i++) {
				const decoded = Buffer.from(gemini.sentAudio[i], 'base64');
				assert.strictEqual(
					decoded.length,
					512 * 2,
					`chunk ${i} should decode to 1024 bytes (512 Int16 samples)`
				);
			}

			// 6. Pre-roll audio should be included (buffered chunks flushed before live streaming)
			// The first few chunks (before gate opened) should appear in sentAudio
			assert.strictEqual(
				gemini.sentAudio[0],
				chunks[0],
				'first buffered chunk should be flushed to Gemini (pre-roll preserved)'
			);

			console.log(
				`  Gate opened at chunk ${gateOpenedAtChunk} (${gateOpenedAtChunk * 32}ms), ` +
				`${gemini.sentAudio.length}/${chunks.length} chunks reached Gemini`
			);
		}

		// Test: silence should NOT trigger the gate
		{
			const { voice, gemini, capture } = createVoiceHarness(VoiceEngine);
			capture.emit('started');

			// Emit 20 silent chunks (volume well below 0.015 threshold)
			for (let i = 0; i < 20; i++) {
				capture.emit('data', Buffer.alloc(1024).toString('base64'));
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.001,
					raw: 0.001,
					residual: 0.001,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}

			assert.strictEqual(
				voice.state,
				'LISTENING',
				'silence should keep the engine in LISTENING state'
			);
			assert.strictEqual(
				gemini.sentAudio.length,
				0,
				'silent audio should remain buffered and not reach Gemini'
			);
		}

		console.log('Local pipeline e2e tests passed.');
	} finally {
		timers.restore();
		restoreDom();
		clock.restore();
	}
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
