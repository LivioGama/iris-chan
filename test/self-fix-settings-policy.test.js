const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

console.log('Running self-fix settings policy tests...');

async function main() {
	const originalWindow = global.window;

	try {
		global.window = { irisPaths: { sourceDirDisplay: '~/proj/sensei/iris-chan' } };
		const systemPromptModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/system-prompt.js')).href;
		const toolDeclarationsModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/tool-declarations.js')).href;
		const { buildSystemInstruction } = await import(systemPromptModuleUrl);
		const { toolDeclarations } = await import(toolDeclarationsModuleUrl);

		const systemPrompt = buildSystemInstruction();
		assert.ok(
			systemPrompt.includes('~/.iris/settings.json'),
			'system prompt should instruct self-fix flows to use the unified runtime settings contract',
		);
		assert.ok(
			systemPrompt.includes('update_settings'),
			'system prompt should prefer update_settings when a stable setting already exists',
		);
		assert.ok(
			systemPrompt.includes('query_settings'),
			'system prompt should expose query_settings for read-only settings questions',
		);

		const querySettingsTool = toolDeclarations.find((tool) => tool.name === 'query_settings');
		assert.ok(querySettingsTool, 'tool declarations should expose query_settings');
		const updateSettingsTool = toolDeclarations.find((tool) => tool.name === 'update_settings');
		assert.ok(updateSettingsTool, 'tool declarations should expose update_settings');
		assert.match(
			updateSettingsTool.description,
			/\.iris\/settings\.json/,
			'update_settings tool description should point at the unified settings file',
		);
		assert.match(
			querySettingsTool.description,
			/read-only|voice presets|current voice/i,
			'query_settings tool description should advertise settings queries',
		);
		assert.match(
			updateSettingsTool.description,
			/pitch|compression/i,
			'update_settings tool description should advertise settings mutations',
		);
		assert.doesNotMatch(
			updateSettingsTool.description,
			/read-only settings query|what voice presets do you have/i,
			'update_settings should no longer advertise read-only query examples',
		);

		const selfFixTool = toolDeclarations.find((tool) => tool.name === 'self_fix');
		assert.match(
			selfFixTool.description,
			/Prefer update_settings/,
			'self_fix tool description should defer to update_settings for existing tunable behaviors',
		);
		assert.match(
			systemPrompt,
			/query_settings\/update_settings/i,
			'system prompt should explicitly direct voice preset reads/writes through the settings tools',
		);
	} finally {
		if (originalWindow === undefined) {
			delete global.window;
		} else {
			global.window = originalWindow;
		}
	}

	console.log('Self-fix settings policy tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
