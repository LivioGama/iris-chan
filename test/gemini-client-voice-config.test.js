const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

console.log('Running Gemini client voice config tests...');

(async () => {
	const originalWindow = globalThis.window;
	const originalWebSocket = globalThis.WebSocket;
	const originalPayloadLimit = process.env.IRIS_GEMINI_SETUP_MAX_PAYLOAD_CHARS;
	const originalInboundBatchSize = process.env.IRIS_GEMINI_INBOUND_BATCH_SIZE;

	process.env.IRIS_GEMINI_SETUP_MAX_PAYLOAD_CHARS = '45000';
	process.env.IRIS_GEMINI_INBOUND_BATCH_SIZE = '2';

	Object.defineProperty(globalThis, 'window', {
		value: {
			electronAPI: {
				getSkillDeclarations: async () => [],
				getSkillPrompts: async () => [],
				getSkillCatalog: async () => [],
				logToFile() {},
			},
		},
		configurable: true,
		writable: true,
	});
	Object.defineProperty(globalThis, 'WebSocket', {
		value: { OPEN: 1 },
		configurable: true,
		writable: true,
	});

	try {
		const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;
		const declarationsUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/tool-declarations.js')).href;
		const { GeminiClient } = await import(moduleUrl);
		const { toolDeclarations } = await import(declarationsUrl);

		const client = new GeminiClient();

		let sentSetup = null;
		client._send = (payload) => {
			sentSetup = payload;
		};

		client._sendSetup();
		let parsedSetup = JSON.parse(sentSetup);

		assert.strictEqual(typeof sentSetup, 'string', 'expected setup payload to be serialized once before sending');
		assert.ok(parsedSetup?.setup, 'expected setup payload to be sent');
		assert.ok(
			!('speechConfig' in parsedSetup.setup.generationConfig),
			'expected Gemini setup to omit a custom voice so the system default voice is used',
		);
		assert.strictEqual(
			client._getSerializedSetupPayload(),
			client._getSerializedSetupPayload(),
			'expected serialized setup payload to be cached between sends',
		);

		client.setVoiceName('Kore');
		client._sendSetup();
		parsedSetup = JSON.parse(sentSetup);

		assert.strictEqual(
			parsedSetup.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
			'Kore',
			'expected Gemini setup to forward an explicit named voice when requested',
		);

		assert.strictEqual(client._getSetupFallbackProfile().label, 'full');
		assert.strictEqual(
			client._applyInvalidArgumentFallback('Request contains an invalid argument.'),
			true,
			'expected invalid-argument fallback to advance to the next setup profile',
		);
		client._sendSetup();
		parsedSetup = JSON.parse(sentSetup);
		assert.ok(
			!('speechConfig' in parsedSetup.setup.generationConfig),
			'expected first invalid-argument fallback to drop custom voice config',
		);

		client._applyInvalidArgumentFallback('Request contains an invalid argument.');
		client._sendSetup();
		parsedSetup = JSON.parse(sentSetup);
		assert.strictEqual(
			parsedSetup.setup.tools[0].functionDeclarations.length,
			toolDeclarations.length,
			'expected second invalid-argument fallback to keep only core tool declarations',
		);

		client._applyInvalidArgumentFallback('Request contains an invalid argument.');
		client._sendSetup();
		parsedSetup = JSON.parse(sentSetup);
		assert.ok(
			parsedSetup.setup.systemInstruction.parts[0].text.length <= 14010,
			'expected compact invalid-argument fallback to trim the system instruction',
		);

		client._skillPrompts = ['Prompt A'.repeat(500)];
		client._skillCatalog = Array.from({ length: 80 }, (_, index) => ({
			name: `skill-${index}`,
			description: `description-${index}`.repeat(100),
		}));
		const skillSection = client._buildSkillSection();
		assert.ok(
			skillSection.length <= 12000,
			'expected skill section to stay within the setup payload budget',
		);
		assert.match(
			skillSection,
			/INSTALLED SKILLS CATALOG/,
			'expected skill section to keep catalog guidance even when trimmed',
		);

		const lowBudgetClient = new GeminiClient();
		const originalBuildSetupPayload = lowBudgetClient._buildSetupPayload.bind(lowBudgetClient);
		lowBudgetClient._buildSetupPayload = (profile) => {
			const payload = originalBuildSetupPayload(profile);
			payload.setup.systemInstruction.parts[0].text = 'X'.repeat(profile?.label === 'compact-system-instruction' ? 1000 : 50000);
			return payload;
		};
		lowBudgetClient.setVoiceName('Kore');
		const lowBudgetSetup = JSON.parse(lowBudgetClient._getSerializedSetupPayload());
		assert.notStrictEqual(
			lowBudgetClient._getSetupFallbackProfile().label,
			'full',
			'expected an oversized setup payload budget to proactively degrade before connect',
		);
		assert.ok(
			lowBudgetSetup.setup.systemInstruction.parts[0].text.length <= 14010,
			'expected proactive payload fallback to end on a compact system instruction when needed',
		);

		const sendClient = new GeminiClient();
		sendClient.sessionReady = true;
		const outbound = [];
		sendClient.ws = {
			readyState: 1,
			send(payload) {
				outbound.push(payload);
			},
		};
		sendClient.sendAudio('QUJDRA==');
		sendClient.sendRealtimeText('hello');
		sendClient.sendToolResponse('call-1', 'noop', { ok: true });
		assert.deepStrictEqual(
			outbound.map((payload) => typeof payload),
			['string', 'string', 'string'],
			'expected latency-sensitive Gemini sends to use pre-serialized strings',
		);

		const queueClient = new GeminiClient();
		const received = [];
		queueClient._handleMessage = (message) => {
			received.push(message.seq);
		};
		queueClient._enqueueInboundMessage('{"seq":1}');
		queueClient._enqueueInboundMessage('{"seq":2}');
		queueClient._enqueueInboundMessage('{"seq":3}');
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.deepStrictEqual(
			received,
			[1, 2, 3],
			'expected queued inbound Gemini messages to drain in order across batches',
		);

		console.log('Gemini client voice config tests passed.');
	} finally {
		if (originalPayloadLimit === undefined) {
			delete process.env.IRIS_GEMINI_SETUP_MAX_PAYLOAD_CHARS;
		} else {
			process.env.IRIS_GEMINI_SETUP_MAX_PAYLOAD_CHARS = originalPayloadLimit;
		}
		if (originalInboundBatchSize === undefined) {
			delete process.env.IRIS_GEMINI_INBOUND_BATCH_SIZE;
		} else {
			process.env.IRIS_GEMINI_INBOUND_BATCH_SIZE = originalInboundBatchSize;
		}
		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			Object.defineProperty(globalThis, 'window', {
				value: originalWindow,
				configurable: true,
				writable: true,
			});
		}
		if (originalWebSocket === undefined) {
			delete globalThis.WebSocket;
		} else {
			Object.defineProperty(globalThis, 'WebSocket', {
				value: originalWebSocket,
				configurable: true,
				writable: true,
			});
		}
	}
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
