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
	setVoiceName() {}
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
	setReferenceCallback(callback) {
		this.referenceCallback = callback;
	}

	setSpeechProfile(profile) {
		this.speechProfile = profile;
	}

	stop() {}
	getVolume() { return 0; }
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function installDomStubs() {
	const originalWindow = global.window;
	const originalDocument = global.document;
	const originalRAF = global.requestAnimationFrame;
	const originalRIC = global.requestIdleCallback;
	const originalGetComputedStyle = global.getComputedStyle;

	global.document = {
		hidden: false,
		body: { appendChild() {} },
		getElementById() { return null; },
	};
	global.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
	global.window = {
		document: global.document,
		getComputedStyle: global.getComputedStyle,
		electronAPI: {
			getVocabulary: async () => [],
			getHotVocabulary: async () => [],
			getVocabularyCore: async () => [],
			getVocabularyCorrections: async () => ({}),
			logToFile() {},
			saveConversationTurn() {},
			searchHide() {},
			endSession() {},
			stopUiTask: async () => {},
		},
	};
	global.requestAnimationFrame = () => 0;
	global.requestIdleCallback = (cb) => {
		cb({ didTimeout: false, timeRemaining: () => 50 });
		return 0;
	};

	return () => {
		global.window = originalWindow;
		global.document = originalDocument;
		global.requestAnimationFrame = originalRAF;
		global.requestIdleCallback = originalRIC;
		global.getComputedStyle = originalGetComputedStyle;
	};
}

async function main() {
	console.log('Running performance benchmarking tests...');
	const restoreDom = installDomStubs();

	try {
		const perfUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/performance-monitor.js')).href;
		const sceneUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/avatar/scene.js')).href;
		const voiceUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/voice-engine.js')).href;

		const { createPerformanceMonitor } = await import(perfUrl);
		const { createScenePerformanceProbe } = await import(sceneUrl);
		const { VoiceEngine } = await import(voiceUrl);

		const performanceMonitor = createPerformanceMonitor({
			getResourceMetrics: async () => ({
				processMemory: { private: 64 * 1024 * 1024 },
				nodeMemory: {
					rss: 96 * 1024 * 1024,
					heapUsed: 32 * 1024 * 1024,
					heapTotal: 48 * 1024 * 1024,
				},
				cpu: {
					cumulativeCPUUsage: 1000,
					timestampMicros: 1000000,
				},
				rendererPerformanceMemory: {
					usedJSHeapSize: 8 * 1024 * 1024,
					totalJSHeapSize: 16 * 1024 * 1024,
					jsHeapSizeLimit: 32 * 1024 * 1024,
				},
			}),
			pingIpc: async () => ({
				rendererRoundTripMs: 4.2,
				mainEventBusRoundTripMs: 0.7,
			}),
		});
		performanceMonitor.exposeGlobal(global.window);

		const probe = createScenePerformanceProbe({
			renderer: {
				domElement: {
					isConnected: true,
					getBoundingClientRect() {
						return { width: 320, height: 240 };
					},
				},
			},
			performanceMonitor,
		});
		for (let i = 0; i < 30; i++) {
			probe.recordFrame(1 / 60);
		}

		await performanceMonitor._sampleResources();
		await performanceMonitor._sampleResources();
		await performanceMonitor._sampleIpc();
		performanceMonitor.stopBackgroundSampling();

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
			isRunning: true,
			onCapture() { return () => {}; },
			setAutonomousMode() {},
			setLastUserSpeechTime() {},
			setIdleGateClosed() {},
			stop() {},
			start() {},
			capture() {},
		};

		const voice = new VoiceEngine({
			gemini,
			capture,
			playback,
			behavior,
			eventBus: null,
			screen,
			performanceMonitor,
		});

		voice._beginTurnLatency();
		assert.ok(voice._benchmarkTurn, 'voice benchmark turn should start when speech begins');
		const requestStart = performance.now();
		voice._benchmarkTurn.captureEndedAt = requestStart;
		voice._benchmarkTurn.requestStartedAt = requestStart;
		voice._noteFirstModelChunk('text');
		await delay(5);
		voice._notePlaybackStarted();

		const report = global.window.getIrisBenchmarks();
		assert.ok(report.rendering.current, 'rendering metrics should be present');
		assert.ok(report.rendering.current.avgFps > 50, 'rendering FPS should be computed');
		assert.ok(report.voice.current, 'voice latency metrics should be present');
		assert.strictEqual(report.voice.current.firstChunkType, 'text', 'voice benchmark should record the first model chunk type');
		assert.strictEqual(report.voice.status.idle, true, 'voice benchmark should return to idle after playback starts');
		assert.ok(report.resources.current.memory.privateMiB >= 64, 'resource memory metrics should be captured');
		assert.ok(report.ipc.current.rendererRoundTripMs > 0, 'IPC latency sample should be captured');

		for (let i = 0; i < 12; i++) {
			performanceMonitor.recordIpcSample({ rendererRoundTripMs: i + 1, mainEventBusRoundTripMs: i / 10 });
		}
		const bounded = global.window.getIrisBenchmarks();
		assert.strictEqual(bounded.ipc.history.length, 10, 'historical samples should be bounded to the last 10 entries');

		console.log('Performance benchmarking tests passed.');
	} finally {
		restoreDom();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
