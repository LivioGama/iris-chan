const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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
}

class FakeCapture extends MockEmitter {
	constructor() {
		super();
		this.playbackStopCount = 0;
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
	notifyPlaybackStop() {
		this.playbackStopCount++;
	}
}

class FakePlayback extends MockEmitter {
	constructor() {
		super();
		this.enqueued = [];
		this.stopCount = 0;
		this.playing = false;
		this.volume = 0.08;
	}

	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	enqueue(data) {
		this.enqueued.push(data);
		this.playing = true;
		this.emit('started');
	}

	stop() {
		this.stopCount++;
		this.playing = false;
		this.emit('stopped');
	}

	getVolume() {
		return this.playing ? this.volume : 0;
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
		this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
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

	global.document = document;
	global.window = {
		electronAPI: {
			logToFile() {},
			trackVocabulary() {},
			addCorrection() {},
			saveConversationTurn() {},
			searchHide() {},
			endSession() {},
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

function createVoiceHarness(VoiceEngine) {
	const gemini = new FakeGemini();
	const capture = new FakeCapture();
	const playback = new FakePlayback();
	const behavior = {
		noteUserActivity() {},
		noteIdleResponseSent() {},
		resetIdleGate() {},
		setMode() {},
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

function emitMeter(capture, meter) {
	capture.emit('volume', {
		effective: meter.effective,
		raw: meter.raw ?? meter.effective,
		residual: meter.residual ?? meter.effective,
		clippedRatio: meter.clippedRatio ?? 0,
		unstableEcho: !!meter.unstableEcho,
	});
}

console.log('Running voice barge-in gate tests...');

(async () => {
	const restoreDom = installDomStubs();
	const clock = withFakeTime(1_000);

	try {
		const voiceModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const { VoiceEngine } = await import(voiceModuleUrl);

		{
			const { voice, gemini, capture } = createVoiceHarness(VoiceEngine);
			capture.emit('started');

			capture.emit('data', 'listening-live-0');
			capture.emit('data', 'listening-live-1');
			clock.advance(32);
			emitMeter(capture, {
				effective: 0.02,
				raw: 0.02,
				residual: 0.02,
			});

			assert.strictEqual(capture.echoSuppressionEnabled, true, 'capture should enable echo suppression on start');
			assert.strictEqual(capture.suppressionGain, 0.8, 'capture should receive the configured suppression gain');
			assert.deepStrictEqual(
				gemini.sentAudio.slice(0, 2),
				['listening-live-0', 'listening-live-1'],
				'listening state should stream live audio to Gemini for normal dictation'
			);
			assert.strictEqual(voice.state, 'USER_SPEAKING', 'speech energy should still move the engine into USER_SPEAKING');
		}

		{
			const { voice, gemini, playback } = createVoiceHarness(VoiceEngine);
			playback.volume = 0.12;
			gemini.emit('audio', 'assistant-turn');

			for (let i = 0; i < 8; i++) {
				voice.capture.emit('data', `leak-${i}`);
				clock.advance(32);
				emitMeter(voice.capture, {
					effective: 0.18,
					raw: 0.18,
					residual: 1.413,
					clippedRatio: 0.18,
					unstableEcho: true,
				});
			}

			assert.strictEqual(playback.stopCount, 0, 'playback leakage should not trigger interruption');
			assert.deepStrictEqual(gemini.sentAudio, [], 'buffered leakage audio should not be forwarded to Gemini');
			assert.strictEqual(voice.state, 'RESPONDING', 'voice engine should remain in responding state during leakage');
		}

		{
			const { voice, gemini, capture, playback } = createVoiceHarness(VoiceEngine);
			playback.volume = 0.12;
			gemini.emit('audio', 'assistant-turn');

			for (let i = 0; i < 10; i++) {
				capture.emit('data', `laptop-audio-${i}`);
				clock.advance(32);
				emitMeter(capture, {
					effective: 0.07,
					raw: 0.07,
					residual: 0.07,
				});
			}

			assert.strictEqual(playback.stopCount, 0, 'steady laptop audio should raise the floor instead of interrupting');
			assert.deepStrictEqual(gemini.sentAudio, [], 'steady laptop audio should stay buffered and never flush');
			assert.strictEqual(voice.state, 'RESPONDING', 'steady laptop audio should leave the assistant responding');
		}

		{
			const { voice, gemini, capture, playback } = createVoiceHarness(VoiceEngine);
			playback.volume = 0.08;
			gemini.emit('audio', 'assistant-turn');

			for (let i = 0; i < 4; i++) {
				clock.advance(32);
				emitMeter(capture, {
					effective: 0.02,
					raw: 0.02,
					residual: 0.02,
				});
			}

			for (let i = 0; i < 4; i++) {
				capture.emit('data', `preroll-${i}`);
				clock.advance(32);
				emitMeter(capture, {
					effective: 0.09,
					raw: 0.09,
					residual: 0.09,
				});
				clock.advance(32);
				emitMeter(capture, {
					effective: 0.09,
					raw: 0.09,
					residual: 0.09,
				});
			}

			assert.strictEqual(playback.stopCount, 1, 'sustained user speech should stop playback once');
			assert.strictEqual(capture.playbackStopCount, 1, 'capture should be notified when playback is stopped');
			assert.strictEqual(voice.state, 'USER_SPEAKING', 'confirmed barge-in should transition to USER_SPEAKING');
			assert.deepStrictEqual(
				gemini.sentAudio.slice(0, 4),
				['preroll-0', 'preroll-1', 'preroll-2', 'preroll-3'],
				'buffered pre-roll audio should flush once barge-in is confirmed'
			);

			capture.emit('data', 'live-after-confirm');
			assert.strictEqual(
				gemini.sentAudio[4],
				'live-after-confirm',
				'live mic audio should stream immediately after confirmation'
			);

			gemini.emit('audio', 'stale-model-audio');
			assert.strictEqual(
				playback.enqueued.length,
				1,
				'stale model audio from the interrupted turn should be ignored locally'
			);

			gemini.emit('turnComplete');
			gemini.emit('audio', 'fresh-model-audio');
			assert.strictEqual(
				playback.enqueued.length,
				2,
				'model audio should resume once the interrupted turn has been completed'
			);
		}

		console.log('Voice barge-in gate tests passed.');
	} finally {
		restoreDom();
		clock.restore();
	}
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
