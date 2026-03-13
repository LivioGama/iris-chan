const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

console.log('Running Gemini client voice config tests...');

(async () => {
	const originalWindow = globalThis.window;

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

		assert.ok(sentSetup?.setup, 'expected setup payload to be sent');
		assert.ok(
			!('speechConfig' in sentSetup.setup.generationConfig),
			'expected Gemini setup to omit a custom voice so the system default voice is used',
		);

		client.setVoiceName('Kore');
		client._sendSetup();

		assert.strictEqual(
			sentSetup.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
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
		assert.ok(
			!('speechConfig' in sentSetup.setup.generationConfig),
			'expected first invalid-argument fallback to drop custom voice config',
		);

		client._applyInvalidArgumentFallback('Request contains an invalid argument.');
		client._sendSetup();
		assert.strictEqual(
			sentSetup.setup.tools[0].functionDeclarations.length,
			toolDeclarations.length,
			'expected second invalid-argument fallback to keep only core tool declarations',
		);

		client._applyInvalidArgumentFallback('Request contains an invalid argument.');
		client._sendSetup();
		assert.ok(
			sentSetup.setup.systemInstruction.parts[0].text.length <= 14010,
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

		console.log('Gemini client voice config tests passed.');
	} finally {
		if (originalWindow === undefined) {
			delete globalThis.window;
		} else {
			Object.defineProperty(globalThis, 'window', {
				value: originalWindow,
				configurable: true,
				writable: true,
			});
		}
	}
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
