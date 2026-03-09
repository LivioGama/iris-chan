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
		this.sentTexts = [];
	}

	sendAudio() {}
	sendToolResponse() {}
	sendVocabUpdate() {}

	sendText(text) {
		this.sentTexts.push(text);
	}

	sendRealtimeText() {}

	sendImage() {}
}

class FakeCapture extends MockEmitter {
	setEchoSuppression() {}
	setSuppressionGain() {}
	sendReferenceSignal() {}
	notifyPlaybackStop() {}
	start() {}
	stop() {}
}

class FakePlayback extends MockEmitter {
	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	stop() {}

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
		async runNextTimer() {
			assert(timers.size > 0, 'expected a scheduled timer');
			const [id, timer] = timers.entries().next().value;
			timers.delete(id);
			const result = timer.fn(...timer.args);
			if (result && typeof result.then === 'function') {
				await result;
			}
			await Promise.resolve();
			await Promise.resolve();
			return timer;
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
	};
	const screen = {
		captureCount: 0,
		isRunning: false,
		capture() {
			this.captureCount++;
			return Promise.resolve();
		},
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

	return { voice, gemini, screen };
}

console.log('Running autonomous loop timer tests...');

(async () => {
	const restoreDom = installDomStubs();
	const clock = withFakeTime(20_000);
	const timers = withFakeTimers();

	try {
		const voiceModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const { VoiceEngine } = await import(voiceModuleUrl);
		const screenControllerModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/screen-capture-controller.js')).href;
		const { createScreenCaptureController } = await import(screenControllerModuleUrl);

		{
			const { voice, gemini } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = true;
			voice._active = true;
			voice.state = 'RESPONDING';

			voice._startAutonomousLoop();
			assert.strictEqual(timers.activeCount(), 1, 'autonomous mode should start with one scheduled timer');

			await timers.runNextTimer();

			assert.deepStrictEqual(gemini.sentTexts, [], 'busy autonomous tick should not send a follow-up prompt');
			assert.strictEqual(timers.activeCount(), 1, 'busy autonomous tick should re-arm the timer');

			voice._stopAutonomousLoop();
			assert.strictEqual(timers.activeCount(), 0, 'stopping the autonomous loop should clear the scheduled timer');
		}

		{
			const { voice, gemini, screen } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = true;
			voice._active = true;
			voice.state = 'LISTENING';
			voice._lastAutonomousPromptTime = 0;

			voice._startAutonomousLoop();
			assert.strictEqual(timers.activeCount(), 1, 'prompt-capable autonomous loop should schedule one timer');

			await timers.runNextTimer();

			assert.strictEqual(screen.captureCount, 1, 'prompt-capable tick should capture the screen once');
			assert.strictEqual(gemini.sentTexts.length, 1, 'prompt-capable tick should emit one follow-up prompt');
			assert.match(gemini.sentTexts[0], /\[AUTONOMOUS CODING PROMPT\]/, 'follow-up prompt should use the autonomous system message');
			assert.strictEqual(voice._consecutiveAutoTurns, 1, 'prompt-capable tick should increment the consecutive prompt counter');
			assert.strictEqual(timers.activeCount(), 1, 'prompt-capable tick should re-arm the timer');

			voice._stopAutonomousLoop();
			assert.strictEqual(timers.activeCount(), 0, 'stopping after a sent prompt should clear the re-armed timer');
		}

		{
			const sentRealtimeTexts = [];
			const sentTurnTexts = [];
			const sentImages = [];
			const originalCaptureScreen = window.electronAPI.captureScreen;
			window.electronAPI.captureScreen = async () => ({
				ok: true,
				data: 'screen-frame',
				context: {
					imageWidth: 1600,
					imageHeight: 900,
					displayWidth: 1440,
					displayHeight: 900,
					scaleFactor: 2,
					cursorX: 320,
					cursorY: 240,
				},
			});

			const screen = createScreenCaptureController({
				gemini: {
					sendRealtimeText(text) {
						sentRealtimeTexts.push(text);
					},
					sendText(text) {
						sentTurnTexts.push(text);
					},
					sendImage(data) {
						sentImages.push(data);
					},
				},
			});

			await screen.capture();
			await screen.capture();

			assert.strictEqual(sentRealtimeTexts.length, 1, 'active screen context should stream as realtime text once');
			assert.strictEqual(sentTurnTexts.length, 0, 'active screen context should not create a completed text turn');
			assert.deepStrictEqual(sentImages, ['screen-frame'], 'screen capture should still send the image frame');

			window.electronAPI.captureScreen = originalCaptureScreen;
		}

		console.log('Autonomous loop timer tests passed.');
	} finally {
		restoreDom();
		clock.restore();
		timers.restore();
	}
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
