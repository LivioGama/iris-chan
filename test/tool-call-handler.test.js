const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadEsmExports(filePath, exportNames) {
	const src = fs.readFileSync(filePath, 'utf-8')
		.replace(/^import .*$/gm, '')
		.replace(/\bexport\s+/g, '');
	const loader = new Function(`${src}\nreturn { ${exportNames.join(', ')} };`);
	return loader();
}

console.log('Running tool call handler tests...');

const filePath = path.join(process.cwd(), 'src/renderer/voice/tool-call-handler.js');
const { formatToolResponseText, shouldRefreshScreenAfterTool } = loadEsmExports(filePath, [
	'formatToolResponseText',
	'shouldRefreshScreenAfterTool',
]);

assert.strictEqual(
	formatToolResponseText({ ok: true, result: 'Clicked at (10,10)' }),
	'Clicked at (10,10)',
	'successful results should pass through unchanged'
);

assert.strictEqual(
	formatToolResponseText({ ok: false, result: 'Accessibility permission is required' }),
	'Error: Accessibility permission is required',
	'failed results should be clearly marked as errors for Gemini'
);

assert.strictEqual(
	formatToolResponseText({ ok: true }),
	'done',
	'missing success text should fall back to done'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('click_at'),
	true,
	'physical action tools should force a fresh screenshot'
);

assert.strictEqual(
	shouldRefreshScreenAfterTool('web_search'),
	false,
	'non-visual tools should not force a screenshot refresh'
);

console.log('Tool call handler tests passed.');
