// Speech bubble show/hide/update

const hideTimers = {};

export function showBubble(who, text) {
	const bubbleId = who === 'user' ? 'bubble-user' : 'bubble-iris';
	const textId = who === 'user' ? 'dbg-user-text' : 'dbg-model-text';

	const textEl = document.getElementById(textId);
	if (textEl) textEl.textContent = text;

	const bubble = document.getElementById(bubbleId);
	if (bubble) {
		bubble.classList.add('visible');
		clearTimeout(hideTimers[who]);
		hideTimers[who] = setTimeout(() => bubble.classList.remove('visible'), 8000);
	}
}

export function hideBubbles() {
	document.getElementById('bubble-user')?.classList.remove('visible');
	document.getElementById('bubble-iris')?.classList.remove('visible');
}
