#!/usr/bin/env node
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
		this.sessionReady = true;
		this.autonomousMode = false;
	}

	sendAudio() {}
	sendToolResponse() {}
	sendVocabUpdate() {}
	sendRealtimeText() {}
	sendImage() {}

	setAutonomousMode(enabled) {
		this.autonomousMode = !!enabled;
	}

	sendText(text) {
		this.sentTexts.push(text);
	}
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

	for (const id of ['bubbles', 'auto-badge']) {
		const el = document.createElement('div');
		el.id = id;
		document.byId.set(id, el);
		document.body.appendChild(el);
	}

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
		capture() {
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
		hasActiveTasks() { return true; },
	};

	const voice = new VoiceEngine({
		gemini,
		capture,
		playback,
		behavior,
		screen,
		claudeCodeBatcher,
	});

	return { voice, gemini };
}

async function main() {
	const restoreDom = installDomStubs();
	try {
		const voiceModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const clientModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;
		const { VoiceEngine } = await import(voiceModuleUrl);
		const { GeminiClient } = await import(clientModuleUrl);

		{
			const client = new GeminiClient();
			client.sessionReady = true;
			client.setAutonomousMode(true);
			const sent = [];
			const prompts = [];
			client._send = (payload) => sent.push(payload);
			client.on('claudeCodeStatusPrompt', (payload) => prompts.push(payload));

			client.sendText('[CLAUDE CODE UPDATE — task-123]\nRecent activity:\nChanged one file');

			assert.strictEqual(prompts.length, 1, 'autonomous client should emit one status prompt event');
			assert.strictEqual(prompts[0].kind, 'update', 'update marker should classify correctly');
			assert.match(prompts[0].text, /^(\[CLAUDE CODE UPDATE — task-123\])/, 'status event should preserve the raw task update');
			assert.strictEqual(sent.length, 0, 'autonomous client should keep background task status out of the live speech channel');
		}

		{
			const { voice, gemini } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = true;
			voice.state = 'LISTENING';

			gemini.emit('claudeCodeStatusPrompt', {
				kind: 'update',
				taskId: 'task-123',
				text: '[CLAUDE CODE UPDATE — task-123]',
			});

			assert.strictEqual(voice._shouldAcceptModelOutput(), false, 'background status prompts should not reopen the speech gate');
			gemini.emit('outputTranscription', '[CLAUDE CODE CODE progress update: still running]');
			assert.strictEqual(voice._accum.model, '', 'internal bracketed progress text should be dropped');
		}

		{
			const { voice, gemini } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = false;

			gemini.emit('claudeCodeStatusPrompt', {
				kind: 'finished',
				taskId: 'task-456',
				text: '[CLAUDE CODE FINISHED — task-456]',
			});

			assert.strictEqual(voice._pendingClaudeCodeStatus, null, 'standard mode should not open autonomous status announcements');
		}

		console.log('Claude Code autonomous status tests passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
