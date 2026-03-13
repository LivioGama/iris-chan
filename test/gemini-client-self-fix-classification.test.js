const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

console.log('Running Gemini self-fix classification tests...');

(async () => {
	const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/gemini/client.js')).href;
	const { classifySelfFixRequest } = await import(moduleUrl);

	assert.strictEqual(
		classifySelfFixRequest('Go ahead', { awaitingDetails: true }).kind,
		'intent_preamble',
		'brief assent during a self-fix handoff should remain a preamble'
	);

	assert.strictEqual(
		classifySelfFixRequest("I'm going to change your idle behavior").kind,
		'intent_preamble',
		'announcing intent to change Iris should not count as the concrete request'
	);

	assert.strictEqual(
		classifySelfFixRequest(
			'Change your idle behavior so that after calling self_fix you say only "On it." and remain silent until I speak again.'
		).kind,
		'specific_change',
		'detailed self-fix instructions should be classified as actionable'
	);

	assert.strictEqual(
		classifySelfFixRequest('What time is it?').kind,
		'none',
		'unrelated user text should not be classified as self-fix'
	);

	console.log('Gemini self-fix classification tests passed.');
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
