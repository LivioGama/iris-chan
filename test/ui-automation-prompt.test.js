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
	systemPrompt.includes('FAST EXECUTION POLICY:'),
	'system prompt should include the fast execution policy block'
);

assert.ok(
	systemPrompt.includes('prefer semantic/native execution first'),
	'system prompt should bias semantic/native UI execution for speed and reliability'
);

assert.ok(
	systemPrompt.includes('prefer fast search primitives such as rg/rg --files'),
	'system prompt should prefer fast workspace search primitives for code analysis'
);

assert.ok(
	systemPrompt.includes('Follow-up UI requests inherit the current app/page context unless the user says otherwise.'),
	'system prompt should preserve current app/page context for follow-up commands'
);

assert.ok(
	systemPrompt.includes('If the user asks whether you can see their screen, answer yes.'),
	'system prompt should explicitly reassure the user that Iris can see periodic screen captures'
);

assert.ok(
	systemPrompt.includes('If the user asks whether you can see terminal output, runtime logs, or console lines that are visible on screen'),
	'system prompt should answer terminal runtime-log visibility questions from the visible terminal context'
);

assert.ok(
	systemPrompt.includes('If the user greets you, says "Iris" to get your attention, or asks where you are, answer briefly that you are here and listening.'),
	'system prompt should reassure casual presence checks instead of re-asking for task context'
);

assert.ok(
	systemPrompt.includes('If the user makes a short casual creative request such as "tell me a poem"'),
	'system prompt should fulfill short casual creative asks directly instead of asking for clarification'
);

assert.ok(
	systemPrompt.includes('Treat brief transliterated variants of simple creative asks'),
	'system prompt should treat transliterated creative asks as ordinary requests when intent is clear'
);

assert.ok(
	systemPrompt.includes('If the user says "click there", "open that", "that one", "here", or asks whether you can see the screen'),
	'system prompt should treat deictic screen references as actionable screen-context requests'
);

assert.ok(
	systemPrompt.includes('battery icon in the status bar'),
	'system prompt should treat named status-bar icons as actionable visible controls'
);

assert.ok(
	systemPrompt.includes('If the user asks whether you can see a visible status/menu bar icon such as the battery indicator'),
	'system prompt should answer status-bar icon visibility questions from screen context instead of re-asking the user'
);

assert.ok(
	systemPrompt.includes('Do not ask whether you can see the user\'s screen when a fresh [SCREEN CONTEXT] is available.'),
	'system prompt should explicitly ban unnecessary screen-visibility questions'
);

assert.ok(
	systemPrompt.includes('If the user names a visible control in the current UI, such as "focus toggle", "mute button", "share switch", or "battery icon in the status bar"'),
	'system prompt should treat named visible controls as actionable screen-context targets'
);

assert.ok(
	systemPrompt.includes('If a click depends on prior setup, do that setup first.'),
	'system prompt should require preparatory setup before pointer clicks'
);

assert.ok(
	systemPrompt.includes('Structure coding work as hypothesis -> experiment -> implementation -> verification -> self-review.'),
	'system prompt should require scientific workflow structure for coding work'
);

assert.ok(
	systemPrompt.includes('optimize for turnaround: inspect only the files most likely to matter'),
	'system prompt should keep repository analysis scoped and fast'
);

assert.ok(
	systemPrompt.includes("Treat the user's request as evidence of the surrounding workflow"),
	'system prompt should require anticipatory intent interpretation for skills'
);

assert.ok(
	systemPrompt.includes('Default to a FULL DOMAIN BUNDLE when learning or packaging a skill.'),
	'system prompt should require full-domain capability bundling for learned skills'
);

assert.ok(
	systemPrompt.includes('Never ask a multi-question interview for skill discovery.'),
	'system prompt should explicitly ban multi-question discovery interviews'
);

assert.ok(
	!systemPrompt.includes('`cmd+l` to focus the address bar'),
	'system prompt should not steer browser navigation through cmd+l anymore'
);

console.log('UI automation prompt tests passed.');
