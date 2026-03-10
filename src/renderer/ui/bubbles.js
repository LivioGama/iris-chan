const hideTimers = new Map();
const streamingBubbles = new Map();

export function getBubbleDurationMs(text, lane) {
	const safeText = String(text || '').trim();
	const chars = safeText.length;
	const words = safeText ? safeText.split(/\s+/).length : 0;
	const punctuationWeight = (safeText.match(/[.,;:!?]/g) || []).length;

	const laneBase = lane === 'thinking' ? 1800 : lane === 'context' ? 2100 : 2600;
	const charWeight = chars * (lane === 'thinking' ? 28 : 34);
	const wordWeight = words * 85;
	const punctuationBoost = punctuationWeight * 90;
	const raw = laneBase + charWeight + wordWeight + punctuationBoost;

	const max = lane === 'chat' ? 32000 : 24000;
	return Math.min(max, Math.max(1500, raw));
}

export function showBubble(lane, text, { role } = {}) {
	const safeLane = ['chat', 'context', 'thinking'].includes(lane) ? lane : 'chat';
	const safeText = String(text || '').trim();
	if (!safeText) return;
	const root = document.getElementById('bubbles');
	if (!root) return;
	const bubble = document.createElement('div');
	const roleClass = role && ['user', 'iris'].includes(role) ? ` role-${role}` : '';
	bubble.className = `bubble lane-${safeLane}${roleClass}`;
	bubble.textContent = safeText;
	root.appendChild(bubble);
	requestAnimationFrame(() => bubble.classList.add('visible'));

	const timeout = setTimeout(() => {
		bubble.classList.remove('visible');
		setTimeout(() => bubble.remove(), 180);
	}, getBubbleDurationMs(safeText, safeLane));
	hideTimers.set(bubble, timeout);
}

<<<<<<< Updated upstream
/**
 * Show or update a streaming bubble. Reuses the same DOM element for a given
 * streamId so that incoming tokens update the text in-place instead of
 * creating a new bubble per token.
 */
export function showStreamingBubble(lane, text, streamId, { role } = {}) {
	const safeLane = ['chat', 'context', 'thinking'].includes(lane) ? lane : 'chat';
	const safeText = String(text || '').trim();
	if (!safeText) return;
	const root = document.getElementById('bubbles');
	if (!root) return;

	const existing = streamingBubbles.get(streamId);
	if (existing && existing.el.parentNode) {
		// Update the existing bubble text in-place
		existing.el.textContent = safeText;
		// Clear any pending hide timer so it stays visible while streaming
		if (hideTimers.has(existing.el)) {
			clearTimeout(hideTimers.get(existing.el));
			hideTimers.delete(existing.el);
		}
		return;
=======
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
>>>>>>> Stashed changes
	}

	// Create a new bubble for this stream
	const bubble = document.createElement('div');
	const roleClass = role && ['user', 'iris'].includes(role) ? ` role-${role}` : '';
	bubble.className = `bubble lane-${safeLane}${roleClass}`;
	bubble.textContent = safeText;
	root.appendChild(bubble);
	requestAnimationFrame(() => bubble.classList.add('visible'));

	streamingBubbles.set(streamId, { el: bubble, lane: safeLane });
}

/**
 * Finalize a streaming bubble — starts the auto-hide timer based on the
 * final text content. After this, the bubble behaves like a normal bubble.
 */
export function finalizeStreamingBubble(streamId) {
	const entry = streamingBubbles.get(streamId);
	if (!entry) return;
	streamingBubbles.delete(streamId);

	const { el, lane } = entry;
	if (!el.parentNode) return; // already removed

	// Clear any leftover timer (shouldn't exist, but be safe)
	if (hideTimers.has(el)) {
		clearTimeout(hideTimers.get(el));
	}

	const timeout = setTimeout(() => {
		el.classList.remove('visible');
		setTimeout(() => el.remove(), 180);
		hideTimers.delete(el);
	}, getBubbleDurationMs(el.textContent, lane));
	hideTimers.set(el, timeout);
}

export function clearBubbles() {
	const root = document.getElementById('bubbles');
	if (!root) return;
	for (const timer of hideTimers.values()) clearTimeout(timer);
	hideTimers.clear();
	streamingBubbles.clear();
	root.innerHTML = '';
}

export const hideBubbles = clearBubbles;
