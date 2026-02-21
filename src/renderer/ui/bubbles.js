// Speech bubble show/hide/update

const hideTimers = {};

// Calculate display duration based on text length, complexity, and content type
function calcDuration(text) {
	if (!text) return 4000;
	const words = text.split(/\s+/).length;
	// Base reading time at ~180 WPM (slightly slower for comprehension)
	const readTime = (words / 180) * 60 * 1000;

	// Complexity bonuses
	let bonus = 0;
	// Code/technical content needs more time
	if (/[{}\[\]=>()]|function|const |import |export /.test(text)) bonus += 3000;
	// Lists or multi-line content
	if ((text.match(/\n/g) || []).length > 2) bonus += 2000;
	// URLs or paths
	if (/https?:\/\/|\/[a-z]+\//i.test(text)) bonus += 1500;
	// Tool execution results (longer persistence)
	if (/^[✓✗⚙️🔍]/.test(text) || /queued|executed|result/i.test(text)) bonus += 3000;
	// Error messages need attention
	if (/error|failed|exception/i.test(text)) bonus += 4000;

	return Math.max(4000, Math.min(readTime + 2500 + bonus, 45000));
}

export function showBubble(who, text) {
	const bubbleId = who === 'user' ? 'bubble-user' : 'bubble-iris';
	const textId = who === 'user' ? 'dbg-user-text' : 'dbg-model-text';

	const textEl = document.getElementById(textId);
	if (textEl) textEl.textContent = text;

	const bubble = document.getElementById(bubbleId);
	if (bubble) {
		// Detect context/thinking messages and apply distinct styling
		const isContext = who === 'model' && text && (
			text.startsWith('[SCREEN CONTEXT]') ||
			text.startsWith('[CONTEXT]') ||
			text.startsWith('[SYSTEM]') ||
			text.startsWith('[THINKING]')
		);
		bubble.classList.toggle('bubble-context', isContext);

		// Truncate context messages to 2 visible lines
		const textEl = document.getElementById(textId);
		if (isContext && textEl) {
			const maxLen = 120;
			textEl.textContent = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
		}

		bubble.classList.add('visible');
		clearTimeout(hideTimers[who]);
		const duration = isContext ? 3000 : calcDuration(text);
		hideTimers[who] = setTimeout(() => bubble.classList.remove('visible'), duration);
	}
}

export function hideBubbles() {
	document.getElementById('bubble-user')?.classList.remove('visible');
	document.getElementById('bubble-iris')?.classList.remove('visible');
}
