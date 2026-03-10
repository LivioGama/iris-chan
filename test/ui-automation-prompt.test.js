const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running UI automation prompt tests...');

const toolDeclarations = fs.readFileSync(path.join(process.cwd(), 'src/renderer/gemini/tool-declarations.js'), 'utf8');
const systemPrompt = fs.readFileSync(path.join(process.cwd(), 'src/renderer/gemini/system-prompt.js'), 'utf8');

assert.ok(
	toolDeclarations.includes("name: 'run_ui_task'"),
	'tool declarations should expose run_ui_task to Gemini'
);

assert.ok(
	systemPrompt.includes('Prefer \\`run_ui_task\\` for direct computer-control requests.'),
	'system prompt should route direct UI work through run_ui_task'
);

assert.ok(
	systemPrompt.includes('Follow-up UI requests inherit the current app/page context unless the user says otherwise.'),
	'system prompt should preserve current app/page context for follow-up commands'
);

assert.ok(
	!systemPrompt.includes('`cmd+l` to focus the address bar'),
	'system prompt should not steer browser navigation through cmd+l anymore'
);

console.log('UI automation prompt tests passed.');
