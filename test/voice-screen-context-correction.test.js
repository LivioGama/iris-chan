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
		this.recentSeenUpdates = 0;
	}

	sendAudio() {}
	sendToolResponse() {}
	sendVocabUpdate() {}
	sendText() {}
	sendRealtimeText() {}
	sendImage() {}
	sendRecentSeenUpdate() {
		this.recentSeenUpdates++;
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

function installDomStubs() {
	const originalWindow = global.window;
	const originalDocument = global.document;
	const originalRAF = global.requestAnimationFrame;

	global.document = {
		getElementById() { return null; },
	};
	global.window = {
		electronAPI: {
			getVocabulary: async () => ['Claude Code'],
			getHotVocabulary: async () => [],
			getVocabularyCore: async () => [],
			getVocabularyCorrections: async () => ({ 'cloud code': 'Claude Code' }),
			logToFile() {},
			addCorrection(wrong, right) {
				global.__savedCorrections.push([wrong, right]);
			},
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
		delete global.__savedCorrections;
	};
}

async function main() {
	console.log('Running voice screen-context correction tests...');
	const restoreDom = installDomStubs();
	global.__savedCorrections = [];

	try {
		const voiceUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;
		const recentUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/vocab/recent-seen-store.js')).href;
		const { VoiceEngine } = await import(voiceUrl);
		const recentStore = await import(recentUrl);

		recentStore.clearRecentSeenTerms();
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

		const voice = new VoiceEngine({
			gemini,
			capture,
			playback,
			behavior,
			eventBus: null,
			screen,
			voiceConfig: {
				recentSeen: {
					ttlMs: 30000,
					maxTerms: 24,
					minConfidence: 0.6,
					rewriteDistance: 3,
					persistEnabled: true,
				},
			},
		});

		await voice.loadVocabulary();

		recentStore.addRecentSeenTerms([{ term: 'Discord', confidence: 0.95 }], { now: Date.now() });
		let corrected = voice._correctTranscript('discord');
		assert.strictEqual(corrected, 'Discord', 'recent screen term should rewrite the user transcript');
		assert.deepStrictEqual(global.__savedCorrections, [['discord', 'Discord']], 'rewrite should persist as a saved correction');
		assert.strictEqual(gemini.recentSeenUpdates, 1, 'persisting a recent seen rewrite should notify Gemini');

		recentStore.clearRecentSeenTerms();
		recentStore.addRecentSeenTerms([{ term: 'Cloudflare', confidence: 0.99 }], { now: Date.now() });
		corrected = voice._correctTranscript('cloud code');
		assert.strictEqual(corrected, 'Claude Code', 'existing vocabulary corrections should take precedence over recent seen terms');

		corrected = voice._correctTranscript('डू यू सी माय स्क्रीन');
		assert.strictEqual(corrected, 'do you see my screen', 'screen visibility transliteration should normalize to the intended English phrase');

		corrected = voice._correctTranscript('एनसी में एक रेंट स्क्रीन');
		assert.strictEqual(corrected, 'can you see my current screen', 'noisy multilingual screen-reference phrase should normalize to the intended screen guidance');

		corrected = voice._correctTranscript('चेंज योर वॉइस टू ब्लूम बट वार्म');
		assert.strictEqual(
			corrected,
			'switch to bloom voice preset and make it warmer',
			'transliterated bloom/warm voice requests should normalize to the deterministic settings phrasing'
		);

		corrected = voice._correctTranscript('change your voice to bloom but warm');
		assert.strictEqual(
			corrected,
			'switch to bloom voice preset and make it warmer',
			'hybrid bloom/warm voice requests should normalize to the deterministic settings phrasing'
		);

		console.log('Voice screen-context correction tests passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
