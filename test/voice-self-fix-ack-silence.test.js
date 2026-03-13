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
	sendAudio() {}
	sendToolResponse() {}
	sendVocabUpdate() {}
	sendRecentSeenUpdate() {}
	setVoiceName() {}
}

class FakeCapture extends MockEmitter {
	setEchoSuppression() {}
	setSuppressionGain() {}
	sendReferenceSignal() {}
	notifyPlaybackStop() {}
	stop() {}
}

class FakePlayback extends MockEmitter {
	constructor() {
		super();
		this.enqueued = [];
		this.stopCount = 0;
	}

	setReferenceCallback() {}
	setSpeechProfile() {}
	getVolume() {
		return 0;
	}
	enqueue(data) {
		this.enqueued.push(data);
	}
	stop() {
		this.stopCount += 1;
	}
}

function installDomStubs() {
	const originalWindow = global.window;
	const originalDocument = global.document;
	const originalRAF = global.requestAnimationFrame;
	const originalFetch = global.fetch;

	const document = {
		byId: new Map(),
		body: null,
		createElement() {
			return {
				id: '',
				className: '',
				dataset: {},
				children: [],
				classList: { add() {}, remove() {}, toggle() {} },
				appendChild() {},
				remove() {},
				setAttribute() {},
				textContent: '',
				innerHTML: '',
			};
		},
		getElementById(id) {
			return this.byId.get(id) || null;
		},
	};
	document.body = document.createElement('body');
	document.byId.set('bubbles', document.createElement('div'));
	document.byId.set('auto-badge', document.createElement('div'));

	global.document = document;
	global.window = {
		electronAPI: {
			logToFile() {},
			trackVocabulary() {},
			addCorrection() {},
			saveConversationTurn() {},
			saveToolExecution() {},
			stopUiTask: async () => {},
			newConvexSession() {},
		},
	};
	global.requestAnimationFrame = (fn) => {
		if (typeof fn === 'function') fn();
		return 0;
	};
	global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"terms":[]}' }] } }] }) });

	return () => {
		global.window = originalWindow;
		global.document = originalDocument;
		global.requestAnimationFrame = originalRAF;
		global.fetch = originalFetch;
	};
}

console.log('Running voice self-fix ack silence tests...');

(async () => {
	const restoreDom = installDomStubs();
	try {
		const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const { VoiceEngine } = await import(moduleUrl);

		let selfFixTriggered = 0;
		let selfFixAckMarked = 0;
		const behavior = {
			noteUserActivity() {},
			noteIdleResponseSent() {},
			resetIdleGate() {},
			setMode() {},
			sanitize(text) { return text; },
			canSpeakProactively() { return true; },
			noteAssistantSpoke() {},
			isAwaitingSelfFixDetails() { return false; },
			noteSelfFixTriggered() { selfFixTriggered += 1; },
			noteSelfFixIntent() {},
			markSelfFixAckSent() { selfFixAckMarked += 1; },
		};
		const screen = {
			isRunning: true,
			stopCount: 0,
			idleGateClosed: false,
			stop() {
				this.stopCount += 1;
				this.isRunning = false;
			},
			start() { this.isRunning = true; },
			setIdleGateClosed(value) {
				this.idleGateClosed = value;
			},
			setLastUserSpeechTime() {},
			setAutonomousMode() {},
			onCapture() { return () => {}; },
		};
		const voice = new VoiceEngine({
			gemini: new FakeGemini(),
			capture: new FakeCapture(),
			playback: new FakePlayback(),
			behavior,
			screen,
			claudeCodeBatcher: { start() {}, stop() {}, addLine() {}, handleDone() {}, hasActiveTasks() { return false; } },
		});

		voice._beginSelfFixAckWindow();
		assert.strictEqual(selfFixTriggered, 1, 'successful self_fix dispatch should mark the request as triggered');

		voice.gemini.emit('outputTranscription', 'On it.');
		assert.strictEqual(voice._accum.model, 'On it.', 'the first self-fix acknowledgment should be preserved');

		voice.gemini.emit('turnComplete');
		assert.strictEqual(voice._selfFixAckState, 'silenced', 'voice engine should enter silence after the self-fix ack turn');
		assert.strictEqual(selfFixAckMarked, 1, 'self-fix ack should be recorded exactly once');
		assert.strictEqual(screen.idleGateClosed, true, 'idle gate should close after the self-fix ack');

		voice.gemini.emit('outputTranscription', '.');
		assert.strictEqual(voice._accum.model, '', 'no follow-up model text should be accepted after the self-fix ack');

		console.log('Voice self-fix ack silence tests passed.');
	} finally {
		restoreDom();
	}
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
