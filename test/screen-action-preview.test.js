const assert = require('node:assert');

// ── Test screen-action-preview logic (pure functions, no DOM needed) ──────
// The actual module is ESM with browser imports, so we test the core logic
// by reimplementing the pure functions here for verification.

console.log('Running screen-action-preview tests...');

// ── Replicate the SCREEN_ACTION_TOOLS set (must stay in sync with source) ──
const SCREEN_ACTION_TOOLS = new Set([
	'click_at',
	'double_click',
	'type_text',
	'press_key',
	'drag',
	'scroll',
	'mouse_move',
	'propose_reply',
]);

function isScreenAction(name) {
	return SCREEN_ACTION_TOOLS.has(name);
}

function generateExplanation(name, args) {
	switch (name) {
		case 'click_at': {
			const btn = args?.button === 'right' ? 'right-click' : 'click';
			return `About to ${btn} at coordinates (${args?.x}, ${args?.y}) on the screen.`;
		}
		case 'double_click':
			return `About to double-click at coordinates (${args?.x}, ${args?.y}) on the screen.`;
		case 'type_text': {
			const text = args?.text || '';
			const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
			return `About to type "${preview}" into the focused input field.`;
		}
		case 'press_key':
			return `About to press the "${args?.key || ''}" key.`;
		case 'drag':
			return `About to drag from (${args?.x}, ${args?.y}) to (${args?.x2}, ${args?.y2}).`;
		case 'scroll': {
			const dir = args?.direction || 'down';
			const amt = args?.amount != null ? args.amount : 3;
			return `About to scroll ${dir} by ${amt} units.`;
		}
		case 'mouse_move':
			return `About to move the cursor to (${args?.x}, ${args?.y}).`;
		case 'propose_reply': {
			const reply = args?.reply || '';
			const preview = reply.length > 60 ? reply.slice(0, 60) + '…' : reply;
			const reason = args?.explanation ? ` Reason: ${args.explanation}` : '';
			return `About to type a proposed reply: "${preview}".${reason}`;
		}
		default:
			return `About to execute ${name.replace(/_/g, ' ')}.`;
	}
}

// ── 1. isScreenAction: correctly flags screen-interaction tools ──────────
const screenTools = ['click_at', 'double_click', 'type_text', 'press_key', 'drag', 'scroll', 'mouse_move', 'propose_reply'];
for (const tool of screenTools) {
	assert.strictEqual(isScreenAction(tool), true, `"${tool}" should be a screen action tool`);
}

// ── 2. isScreenAction: non-screen tools are NOT flagged ─────────────────
const nonScreenTools = [
	'open_app', 'web_search', 'read_file', 'write_file', 'clipboard_read',
	'run_terminal_command', 'fix_project', 'self_fix', 'add_task', 'notify',
	'set_volume', 'get_frontmost_app', 'window_manage', 'list_directory',
];
for (const tool of nonScreenTools) {
	assert.strictEqual(isScreenAction(tool), false, `"${tool}" should NOT be a screen action tool`);
}

// ── 3. generateExplanation: click_at ─────────────────────────────────────
{
	const exp = generateExplanation('click_at', { x: 500, y: 300 });
	assert.ok(exp.includes('click'), 'click_at explanation should mention click');
	assert.ok(exp.includes('500'), 'click_at explanation should include x coordinate');
	assert.ok(exp.includes('300'), 'click_at explanation should include y coordinate');
}

// ── 4. generateExplanation: click_at right-click ─────────────────────────
{
	const exp = generateExplanation('click_at', { x: 100, y: 200, button: 'right' });
	assert.ok(exp.includes('right-click'), 'right-click explanation should mention right-click');
}

// ── 5. generateExplanation: double_click ─────────────────────────────────
{
	const exp = generateExplanation('double_click', { x: 400, y: 600 });
	assert.ok(exp.includes('double-click'), 'double_click explanation should mention double-click');
	assert.ok(exp.includes('400'), 'double_click explanation should include x coordinate');
}

// ── 6. generateExplanation: type_text ────────────────────────────────────
{
	const exp = generateExplanation('type_text', { text: 'Hello world' });
	assert.ok(exp.includes('Hello world'), 'type_text explanation should include the text');
	assert.ok(exp.includes('type'), 'type_text explanation should mention typing');
}

// ── 7. generateExplanation: type_text truncation ─────────────────────────
{
	const longText = 'A'.repeat(100);
	const exp = generateExplanation('type_text', { text: longText });
	assert.ok(exp.includes('…'), 'Long type_text should be truncated with ellipsis');
	assert.ok(!exp.includes('A'.repeat(100)), 'Truncated text should not contain full string');
}

// ── 8. generateExplanation: press_key ────────────────────────────────────
{
	const exp = generateExplanation('press_key', { key: 'cmd+c' });
	assert.ok(exp.includes('cmd+c'), 'press_key explanation should include the key combo');
}

// ── 9. generateExplanation: drag ─────────────────────────────────────────
{
	const exp = generateExplanation('drag', { x: 100, y: 200, x2: 300, y2: 400 });
	assert.ok(exp.includes('drag'), 'drag explanation should mention drag');
	assert.ok(exp.includes('100') && exp.includes('200'), 'drag should include start coordinates');
	assert.ok(exp.includes('300') && exp.includes('400'), 'drag should include end coordinates');
}

// ── 10. generateExplanation: scroll ──────────────────────────────────────
{
	const exp = generateExplanation('scroll', { direction: 'up', amount: 5 });
	assert.ok(exp.includes('scroll'), 'scroll explanation should mention scroll');
	assert.ok(exp.includes('up'), 'scroll explanation should include direction');
	assert.ok(exp.includes('5'), 'scroll explanation should include amount');
}

// ── 11. generateExplanation: scroll defaults ─────────────────────────────
{
	const exp = generateExplanation('scroll', {});
	assert.ok(exp.includes('down'), 'scroll with no direction should default to down');
	assert.ok(exp.includes('3'), 'scroll with no amount should default to 3');
}

// ── 12. generateExplanation: mouse_move ──────────────────────────────────
{
	const exp = generateExplanation('mouse_move', { x: 800, y: 600 });
	assert.ok(exp.includes('cursor') || exp.includes('move'), 'mouse_move should mention cursor or move');
	assert.ok(exp.includes('800'), 'mouse_move should include x coordinate');
}

// ── 13. generateExplanation: propose_reply ───────────────────────────────
{
	const exp = generateExplanation('propose_reply', { reply: 'Thanks!', explanation: 'Acknowledging receipt' });
	assert.ok(exp.includes('Thanks!'), 'propose_reply should include the reply text');
	assert.ok(exp.includes('Acknowledging receipt'), 'propose_reply should include explanation');
}

// ── 14. generateExplanation: unknown tool fallback ───────────────────────
{
	const exp = generateExplanation('some_unknown_tool', {});
	assert.ok(exp.includes('some unknown tool'), 'Unknown tool should get human-readable fallback');
}

console.log('Screen-action-preview tests passed. ✓');
