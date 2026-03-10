// Screen Action Preview — mandatory explanation step before executing screen-interaction tools.
// Generates a human-readable explanation of what Iris is about to do, shows it visually,
// and logs it for debugging transparency.

import { showBubble } from '../ui/bubbles.js';
import { showToolPreview } from '../ui/tool-log.js';
import { info as logInfo } from '../logger.js';

// Tools that physically interact with the screen (mouse/keyboard/scroll).
// These MUST show a preview explanation before execution.
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

// Delay (ms) between showing the preview and executing the action,
// giving the user time to read the explanation.
const PREVIEW_DELAY_MS = 800;

/**
 * Returns true if the given tool name is a screen-interaction tool
 * that requires a preview explanation before execution.
 */
export function isScreenAction(name) {
	return SCREEN_ACTION_TOOLS.has(name);
}

/**
 * Generate a concise 1-3 sentence explanation of the screen action about to be taken.
 * Derived deterministically from the tool name and arguments.
 */
export function generateExplanation(name, args) {
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

/**
 * Show the preview explanation to the user and wait briefly before proceeding.
 * This is the main entry point called by the tool-call handler.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {object} [gemini] - Optional GeminiClient instance to send context
 * @returns {Promise<void>} Resolves after the preview delay
 */
export async function showScreenActionPreview(name, args, gemini) {
	const explanation = generateExplanation(name, args);

	// 1. Log for debugging
	logInfo('ScreenPreview', `[${name}] ${explanation}`);

	// 2. Show in speech bubble (visual feedback for the user)
	showBubble('context', `🖱️ ${explanation}`, { role: 'iris' });

	// 3. Show in tool log with distinct preview styling
	showToolPreview(name, explanation);

	// 4. Send to Gemini as context (non-blocking, no response expected)
	if (gemini?.sessionReady) {
		gemini.sendText(
			`[SCREEN ACTION PREVIEW — do not read aloud]\n` +
			`Executing: ${name}(${JSON.stringify(args || {})})\n` +
			`Explanation: ${explanation}`
		);
	}

	// 5. Brief pause so the user can see the preview before execution
	await new Promise(resolve => setTimeout(resolve, PREVIEW_DELAY_MS));
}
