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
			getSkillDeclarations: async () => [],
			getSkillPrompts: async () => [],
			getSkillCatalog: async () => [],
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
	console.log('Running default system voice selection integration test...');
	const restoreDom = installDomStubs();

	try {
		const voiceUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const geminiUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;
		const { VoiceEngine } = await import(voiceUrl);
		const { GeminiClient } = await import(geminiUrl);

		const gemini = new GeminiClient();
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
					pitchSemitones: -3,
				},
			},
		});

		let sentSetup = null;
		gemini._send = (payload) => {
			sentSetup = payload;
		};
		gemini._sendSetup();

		assert.strictEqual(
			sentSetup?.setup?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
			'Charon',
			'voice engine should propagate the configured Gemini voice into the setup payload',
		);
		assert.strictEqual(playback.speechProfile.playbackRate, 0.94, 'voice engine should preserve configured playback shaping');
		assert.strictEqual(playback.speechProfile.pitchSemitones, -3, 'voice engine should preserve configured pitch shaping');

		console.log('Configured system voice selection integration test passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
