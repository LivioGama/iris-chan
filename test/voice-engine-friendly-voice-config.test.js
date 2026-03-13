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
}

class FakeGemini extends MockEmitter {
	constructor() {
		super();
		this.voiceName = null;
	}

	setVoiceName(voiceName) {
		this.voiceName = voiceName;
	}

	sendAudio() {}
	sendToolResponse() {}
	sendVocabUpdate() {}
	sendText() {}
	sendRealtimeText() {}
	sendImage() {}
	sendRecentSeenUpdate() {}
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
	constructor() {
		super();
		this.speechProfile = null;
	}

	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	setSpeechProfile(profile) {
		this.speechProfile = profile;
	}

	stop() {}
	getVolume() { return 0; }
}

function installDomStubs() {
	const originalWindow = global.window;
	const originalDocument = global.document;
	const originalRAF = global.requestAnimationFrame;

	global.document = {
		getElementById() { return null; },
	};
	global.window = {
		electronAPI: {
			getVocabulary: async () => [],
			getHotVocabulary: async () => [],
			getVocabularyCore: async () => [],
			getVocabularyCorrections: async () => ({}),
			logToFile() {},
			saveConversationTurn() {},
			searchHide() {},
			endSession() {},
		},
	};
	global.requestAnimationFrame = () => 0;

	return () => {
		global.window = originalWindow;
		global.document = originalDocument;
		global.requestAnimationFrame = originalRAF;
	};
}

async function main() {
	console.log('Running voice engine friendly voice config tests...');
	const restoreDom = installDomStubs();

	try {
		const voiceUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const { VoiceEngine } = await import(voiceUrl);

		const gemini = new FakeGemini();
		const playback = new FakePlayback();
		const capture = new FakeCapture();
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
			onCapture() { return () => {}; },
			setAutonomousMode() {},
			stop() {},
		};

		new VoiceEngine({
			gemini,
			capture,
			playback,
			behavior,
			eventBus: null,
			screen,
			voiceConfig: {
				modelVoiceName: 'Charon',
				speechProfile: {
					playbackRate: 0.94,
					pitchSemitones: -2,
					presenceFrequencyHz: 3000,
					highShelfFrequencyHz: 6200,
					warmthGainDb: 2.5,
				},
			},
		});

		assert.strictEqual(gemini.voiceName, 'Charon', 'voice engine should forward the selected Gemini voice');
		assert.ok(playback.speechProfile, 'voice engine should apply a speech profile to playback');
		assert.strictEqual(playback.speechProfile.playbackRate, 0.94);
		assert.strictEqual(playback.speechProfile.pitchSemitones, -2);
		assert.strictEqual(playback.speechProfile.lowShelfFrequencyHz, 170);
		assert.strictEqual(playback.speechProfile.warmthGainDb, 2.5);
		assert.strictEqual(playback.speechProfile.presenceFrequencyHz, 3000);
		assert.strictEqual(playback.speechProfile.highShelfFrequencyHz, 6200);

		console.log('Voice engine friendly voice config tests passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
