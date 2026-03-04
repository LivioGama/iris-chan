const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadEsmExports(filePath, exportNames) {
	const src = fs.readFileSync(filePath, 'utf-8').replace(/\bexport\s+/g, '');
	const loader = new Function(`${src}\nreturn { ${exportNames.join(', ')} };`);
	return loader();
}

console.log('Running V2 UI behavior tests...');

{
	const filePath = path.join(process.cwd(), 'src/renderer/ui/bubbles.js');
	const { getBubbleDurationMs } = loadEsmExports(filePath, ['getBubbleDurationMs']);

	const shortChat = getBubbleDurationMs('ok', 'chat');
	const longChat = getBubbleDurationMs('x'.repeat(500), 'chat');
	const longThinking = getBubbleDurationMs('x'.repeat(500), 'thinking');

	assert.ok(shortChat >= 1500, 'bubble duration must respect min clamp');
	assert.ok(longChat <= 32000, 'chat bubble duration must respect max clamp');
	assert.ok(longThinking <= 24000, 'thinking bubble duration must respect tighter max clamp');
	assert.ok(longChat > shortChat, 'longer messages should stay longer');
}

{
	const filePath = path.join(process.cwd(), 'src/renderer/tasks/milestone-summarizer.js');
	const { summarizeMilestoneLine, shouldNarrateMilestone } = loadEsmExports(filePath, ['summarizeMilestoneLine', 'shouldNarrateMilestone']);

	assert.strictEqual(summarizeMilestoneLine('waiting'), null, 'noise should be filtered');
	const err = summarizeMilestoneLine('Exception: failed to patch file');
	assert.strictEqual(err.important, true, 'errors should be important');
	assert.strictEqual(shouldNarrateMilestone(err, { askedProgress: false }), true, 'important milestones should narrate');

	const info = summarizeMilestoneLine('[tool: Read]');
	assert.strictEqual(info.important, false, 'tool usage should be low-priority');
	assert.strictEqual(shouldNarrateMilestone(info, { askedProgress: false }), false, 'low-priority milestones should stay silent unless requested');
	assert.strictEqual(shouldNarrateMilestone(info, { askedProgress: true }), true, 'explicit progress request should narrate low-priority milestone');
}

console.log('V2 UI behavior tests passed.');
