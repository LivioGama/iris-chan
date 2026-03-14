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

	enqueue() {}

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
			executeTool: async () => ({ ok: true, result: 'ok' }),
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
		sanitize(text) { return text; },
		canSpeakProactively() { return true; },
		noteAssistantSpoke() {},
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

	return { voice, gemini, capture, screen };
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
			assert.match(
				gemini.sentTexts[0],
				/(continue working silently|If a Claude Code task is running, give a one-sentence progress update)/i,
				'follow-up prompt should keep active tasks moving without re-asking by default'
			);
			assert.strictEqual(voice._consecutiveAutoTurns, 1, 'prompt-capable tick should increment the consecutive prompt counter');
			assert.strictEqual(timers.activeCount(), 1, 'prompt-capable tick should re-arm the timer');

			voice._stopAutonomousLoop();
			assert.strictEqual(timers.activeCount(), 0, 'stopping after a sent prompt should clear the re-armed timer');
		}

		{
			const { voice, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'LISTENING';
			voice.gemini.sessionReady = true;

			const sent = voice.speakProactiveSuggestion('Review the visible error before editing another file.', { kind: 'warning' });

			assert.strictEqual(sent, true, 'proactive suggestion should be accepted while listening');
			assert.strictEqual(voice._proactiveResponseExpected, true, 'proactive turn should mark response expected');
			assert.strictEqual(voice._shouldAcceptModelToolCalls(), false, 'proactive turns should block tool calls');
			assert.strictEqual(gemini.sentTexts.length, 1, 'proactive turn should send exactly one text prompt');
			assert.match(gemini.sentTexts[0], /\[PROACTIVE SUGGESTION\]/, 'proactive prompt should use the dedicated system message');
		}

		{
			const { voice } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = false;
			voice.state = 'LISTENING';
			voice._lastUserSpeechTime = Date.now() - 5000;
			voice._lastInterruptAt = Date.now() - 1000;

			assert.strictEqual(
				voice._shouldAcceptModelOutput(),
				true,
				'current voice engine accepts non-autonomous output once it is back in listening state',
			);
		}

		{
			const { voice } = createVoiceHarness(VoiceEngine);
			voice._autonomousMode = false;
			voice.state = 'LISTENING';
			voice._lastUserSpeechTime = Date.now() - 5000;
			voice._batcher.hasActiveTasks = () => true;

			assert.strictEqual(
				voice._shouldAcceptModelOutput(),
				true,
				'background tasks do not currently suppress standard listening-mode output in this harness',
			);
		}

		{
			const { voice } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'LISTENING';
			voice.gemini.sessionReady = true;
			voice._idleMessageSent = true;
			voice._unpromptedTurnCount = 1;
			voice._beginDirectTurn('direct');

			assert.strictEqual(
				voice._shouldAcceptModelOutput(),
				true,
				'a committed direct ask should bypass idle and unprompted suppression gates',
			);
			assert.strictEqual(
				voice.canEvaluateProactively(),
				false,
				'a pending direct ask should block proactive suggestions until the reply is delivered',
			);
		}

		{
			const { voice, capture } = createVoiceHarness(VoiceEngine);
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			voice._accum.user = 'Hello Iris';
			voice._noteDirectTurnTranscript('Hello Iris');
			clock.advance(32);
			capture.emit('volume', {
				effective: 0.01,
				raw: 0.01,
				residual: 0.01,
				clippedRatio: 0,
				unstableEcho: false,
			});

			assert.strictEqual(voice.state, 'USER_SPEAKING', 'confirmed speech should still be treated as an active direct turn before release');
			clock.advance(90);
			await timers.runNextTimer();
			assert.strictEqual(voice.state, 'PROCESSING', 'direct turns should finalize quickly once speech falls into trailing-noise territory');
		}

		{
			const { voice, capture } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			voice._behaviorState = { ...voice._behaviorState, mode: 'proactive' };
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-no-tx-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			const directTurnId = voice._directTurn.id;
			clock.advance(32);
			capture.emit('volume', {
				effective: 0.01,
				raw: 0.01,
				residual: 0.01,
				clippedRatio: 0,
				unstableEcho: false,
			});
			assert.strictEqual(voice._directTurn.awaitingResponse, true, 'without server evidence the turn should stay pending during the grace window');
			await timers.runNextTimer();
			assert.strictEqual(voice.state, 'LISTENING', 'grace expiry without transcript should return to listening');
			assert.strictEqual(voice._directTurn.awaitingResponse, false, 'grace expiry should abort the unresolved direct turn');
			assert.strictEqual(voice._directTurn.id, directTurnId, 'the aborted turn should reset in place instead of spawning a second turn');
			assert.ok(
				!voice.gemini.sentTexts.some((text) => /I did not catch that\. Please say it again\./.test(text)),
				'grace expiry without transcript should stay silent instead of triggering a generic reprompt'
			);
		}

		{
			const { voice, capture, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-superseded-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			assert.strictEqual(voice._directTurn.awaitingResponse, true, 'speech confirmation should create a pending direct turn');
			gemini.emit('interrupted');
			assert.strictEqual(voice.state, 'LISTENING', 'without transcript evidence interruption should return the engine to listening');
			assert.strictEqual(voice._directTurn.awaitingResponse, false, 'without transcript evidence interruption should end the pending direct turn');
		}

		{
			const { voice, capture, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-retry-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			gemini.emit('inputTranscription', 'What voice presets do you have?');
			const directTurnId = voice._directTurn.id;
			gemini.emit('interrupted');
			assert.strictEqual(voice.state, 'PROCESSING', 'recognized pre-playback interruptions should enter recovery processing');
			assert.strictEqual(voice._directTurn.awaitingResponse, true, 'transcript salvage should keep the turn active');
			assert.strictEqual(voice._directTurn.salvageStarted, true, 'recognized pre-playback interruptions should start transcript salvage');
			assert.strictEqual(voice._directTurn.retryCount, 0, 'transcript salvage should not consume the live retry budget');
			assert.strictEqual(voice._directTurn.id, directTurnId, 'salvage should stay within the same direct turn');
			assert.ok(
				gemini.sentTexts.some((text) => /DIRECT TURN SALVAGE/.test(text)),
				'recovery should send a transcript salvage prompt back to Gemini'
			);
			gemini.emit('audio', 'retry-audio');
			assert.strictEqual(voice.state, 'RESPONDING', 'successful salvage should resume normal playback');
			assert.ok(
				!gemini.sentTexts.some((text) => /I did not catch that\. Please say it again\./.test(text)),
				'successful salvage should not speak the fallback reprompt'
			);
		}

		{
			const { voice, capture, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-retry-fail-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			gemini.emit('inputTranscription', 'List the voice presets');
			gemini.emit('interrupted');
			assert.strictEqual(voice._directTurn.salvageStarted, true, 'first pre-playback interruption should begin transcript salvage');
			gemini.emit('turnComplete');
			assert.strictEqual(voice.state, 'LISTENING', 'empty salvage completion should return to listening');
			assert.strictEqual(voice._directTurn.awaitingResponse, false, 'empty salvage completion should end the salvaged turn');
			assert.ok(
				gemini.sentTexts.some((text) => /DIRECT TURN SALVAGE/.test(text)),
				'failed salvage should still attempt transcript salvage'
			);
			assert.ok(
				!gemini.sentTexts.some((text) => /I heard "/.test(text)),
				'failed salvage should not fall back to quoted clarification'
			);
		}

		{
			const { voice, capture, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-retry-turn-complete-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			gemini.emit('inputTranscription', 'What voice are you using?');
			gemini.emit('interrupted');
			gemini.emit('turnComplete');
			assert.strictEqual(voice.state, 'LISTENING', 'salvage completion without playback should return to listening');
			assert.strictEqual(voice._directTurn.awaitingResponse, false, 'salvage completion without playback should end the turn');
			assert.ok(
				gemini.sentTexts.some((text) => /DIRECT TURN SALVAGE/.test(text)),
				'salvage completion without playback should still use transcript salvage'
			);
			assert.ok(
				!gemini.sentTexts.some((text) => /I heard "/.test(text)),
				'salvage completion without playback should not use quoted clarification'
			);
		}

		{
			const { voice, capture, gemini } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'IDLE';
			voice.gemini.sessionReady = true;
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `spoken-stale-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			gemini.emit('interrupted');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `new-turn-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			assert.strictEqual(voice.state, 'USER_SPEAKING', 'new speech should move the engine into a real user-speaking turn');
			gemini.emit('outputTranscription', 'I did not catch that.');
			assert.strictEqual(voice._accum.model, '', 'stale fallback output should be dropped once a newer user turn starts');
		}

		{
			const { voice, capture } = createVoiceHarness(VoiceEngine);
			capture.emit('started');
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `fragment-a-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			const firstTurnId = voice._directTurn.id;
			clock.advance(32);
			capture.emit('volume', {
				effective: 0.01,
				raw: 0.01,
				residual: 0.01,
				clippedRatio: 0,
				unstableEcho: false,
			});
			assert.strictEqual(voice._directTurn.awaitingResponse, true, 'first fragment should keep the direct turn pending');
			clock.advance(200);
			for (let i = 0; i < 6; i++) {
				capture.emit('data', `fragment-b-${i}`);
				clock.advance(32);
				capture.emit('volume', {
					effective: 0.03,
					raw: 0.03,
					residual: 0.03,
					clippedRatio: 0,
					unstableEcho: false,
				});
			}
			assert.strictEqual(voice._directTurn.id, firstTurnId, 'adjacent local fragments should merge into the same direct turn');
		}

		{
			const { voice, gemini } = createVoiceHarness(VoiceEngine);
			const toolCalls = [];
			global.window.electronAPI.executeTool = async (name, args) => {
				toolCalls.push({ name, args });
				return { ok: true, result: 'ok' };
			};
			voice._active = true;
			voice.state = 'LISTENING';
			voice.gemini.sessionReady = true;
			voice._behaviorState = { ...voice._behaviorState, mode: 'proactive' };

			const shown = voice.presentReplySuggestions({
				replyOptions: ['Sure, I can reply.', 'I will send it soon.'],
				replyAssistant: {
					composerQueries: ['reply'],
					sendQueries: ['send'],
					contextSummary: 'Visible conversation context',
					sendShortcutHint: 'return',
				},
			});
			assert.strictEqual(shown, true, 'reply suggestions should be spoken when the session is ready');

			voice._accum.user = 'send 2';
			voice._maybeCaptureReplyCommand();
			assert.strictEqual(voice._pendingReplyAction?.type, 'preview-suggestion', 'send 2 should select a suggestion for preview');

			await voice._runReplyAction(voice._pendingReplyAction);
			voice._pendingReplyAction = null;
			assert.strictEqual(toolCalls[0].name, 'prepare_reply_draft', 'preview should prepare the draft first');
			assert.strictEqual(voice._replySession.mode, 'preview', 'preview action should advance the session to preview mode');

			voice._accum.user = 'send it';
			voice._proactiveResponseExpected = false;
			voice._maybeCaptureReplyCommand();
			assert.strictEqual(voice._pendingReplyAction?.type, 'confirm-send', 'send it should confirm the previewed draft');

			await voice._runReplyAction(voice._pendingReplyAction);
			voice._pendingReplyAction = null;
			assert.strictEqual(toolCalls[1].name, 'send_reply_draft', 'confirmation should send the prepared draft');
			assert.strictEqual(voice._replySession, null, 'successful send should clear the reply session');
			assert.ok(gemini.sentTexts.some((text) => /Sent\./.test(text)), 'the success acknowledgement should be spoken');
		}

		{
			const { voice } = createVoiceHarness(VoiceEngine);
			const toolCalls = [];
			global.window.electronAPI.executeTool = async (name, args) => {
				toolCalls.push({ name, args });
				if (name === 'prepare_reply_draft') return { ok: true, result: 'prepared' };
				if (name === 'send_reply_draft') return { ok: true, result: 'sent' };
				return { ok: true, result: 'ok' };
			};
			voice._active = true;
			voice.state = 'LISTENING';
			voice.gemini.sessionReady = true;
			voice._apiKey = 'test-key';
			voice._behaviorState = { ...voice._behaviorState, mode: 'proactive' };
			voice._reviseReplyDraft = async ({ baseDraft, instruction }) => ({
				ok: true,
				draft: `${baseDraft} [${instruction}]`,
			});

			voice.presentReplySuggestions({
				replyOptions: ['Hey, how have you been?', 'Sure, I can do that.'],
				replyAssistant: {
					composerQueries: ['reply'],
					sendQueries: ['send'],
					contextSummary: 'Visible conversation context',
					sendShortcutHint: 'return',
				},
			});

			voice._accum.user = 'send 1, but say how are you doing instead';
			voice._maybeCaptureReplyCommand();
			assert.strictEqual(voice._pendingReplyAction?.type, 'revise-and-send', 'edit-and-send command should trigger revision');

			await voice._runReplyAction(voice._pendingReplyAction);
			voice._pendingReplyAction = null;

			assert.strictEqual(toolCalls[0].name, 'prepare_reply_draft', 'revised draft should be prepared before send');
			assert.strictEqual(toolCalls[1].name, 'send_reply_draft', 'revised draft should send immediately after preparation');
			assert.strictEqual(voice._replySession, null, 'successful revised send should clear the reply session');
		}

		{
			const { voice } = createVoiceHarness(VoiceEngine);
			voice._active = true;
			voice.state = 'LISTENING';
			voice.gemini.sessionReady = true;
			voice._apiKey = 'test-key';
			voice._behaviorState = { ...voice._behaviorState, mode: 'proactive' };
			voice._reviseReplyDraft = async () => ({ ok: false });

			voice.presentReplySuggestions({
				replyOptions: ['Hey, how have you been?'],
				replyAssistant: {
					composerQueries: ['reply'],
					sendQueries: ['send'],
					contextSummary: 'Visible conversation context',
					sendShortcutHint: 'return',
				},
			});

			voice._accum.user = 'make 1 shorter';
			voice._maybeCaptureReplyCommand();
			assert.strictEqual(voice._pendingReplyAction?.type, 'revise-and-send', 'make N shorter should route through revision');

			await voice._runReplyAction(voice._pendingReplyAction);
			voice._pendingReplyAction = null;

			assert.ok(voice._replySession, 'failed revision should keep the session alive');
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
