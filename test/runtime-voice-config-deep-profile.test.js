const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

require('ts-node/register/transpile-only');

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
	console.log('Running runtime voice config deep profile integration test...');
	const restoreDom = installDomStubs();

	try {
		const config = require(path.join(process.cwd(), 'src/shared/config.ts')).default;
		const voiceUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const geminiUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;
		const { VoiceEngine } = await import(voiceUrl);
		const { GeminiClient } = await import(geminiUrl);

		assert.strictEqual(config.voice.modelVoiceName, 'Charon');
		assert.strictEqual(config.voice.speechProfile.playbackRate, 0.93);
		assert.strictEqual(config.voice.speechProfile.pitchSemitones, -2.6);
		assert.strictEqual(config.voice.speechProfile.lowShelfGainDb, 3.4);
		assert.strictEqual(config.voice.speechProfile.warmthGainDb, 2.6);
		assert.strictEqual(config.voice.speechProfile.presenceGainDb, 0.9);

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
			voiceConfig: config.voice,
		});

		let sentSetup = null;
		gemini._send = (payload) => {
			sentSetup = payload;
		};
		gemini._sendSetup();

		assert.strictEqual(gemini._voiceName, 'Charon');
		assert.strictEqual(
			sentSetup?.setup?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName,
			'Charon',
		);
		assert.strictEqual(playback.speechProfile.playbackRate, config.voice.speechProfile.playbackRate);
		assert.strictEqual(playback.speechProfile.pitchSemitones, config.voice.speechProfile.pitchSemitones);
		assert.strictEqual(playback.speechProfile.lowShelfGainDb, config.voice.speechProfile.lowShelfGainDb);
		assert.strictEqual(playback.speechProfile.warmthGainDb, config.voice.speechProfile.warmthGainDb);

		console.log('Runtime voice config deep profile integration test passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
