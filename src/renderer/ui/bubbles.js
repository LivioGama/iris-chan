const hideTimers = new Map();

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

export function showBubble(lane, text) {
	const safeLane = ['chat', 'context', 'thinking'].includes(lane) ? lane : 'chat';
	const safeText = String(text || '').trim();
	if (!safeText) return;
	const root = document.getElementById('bubbles');
	if (!root) return;
	const bubble = document.createElement('div');
	bubble.className = `bubble lane-${safeLane}`;
	bubble.textContent = safeText;
	root.appendChild(bubble);
	requestAnimationFrame(() => bubble.classList.add('visible'));

	const timeout = setTimeout(() => {
		bubble.classList.remove('visible');
		setTimeout(() => bubble.remove(), 180);
	}, getBubbleDurationMs(safeText, safeLane));
	hideTimers.set(bubble, timeout);
}

export function clearBubbles() {
	const root = document.getElementById('bubbles');
	if (!root) return;
	for (const timer of hideTimers.values()) clearTimeout(timer);
	hideTimers.clear();
	root.innerHTML = '';
}

export { clearBubbles as hideBubbles };
