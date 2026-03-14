const INDICATOR_NAMES = ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool', 'srch', 'auto', '2fa'];
const indicators = new Map();

export function initIndicators(containerEl) {
	if (!containerEl) return;
	for (const name of INDICATOR_NAMES) {
		const dot = document.createElement('span');
		dot.className = 'status-dot';
		dot.dataset.indicator = name;
		dot.title = name;
		containerEl.appendChild(dot);
		indicators.set(name, dot);
	}
}

export function updateIndicator(name, active) {
	const dot = indicators.get(name);
	if (dot) {
		dot.classList.toggle('active', !!active);
	}
}

export function setIndicatorLabel(name, label) {
	const dot = indicators.get(name);
	if (dot && typeof label === 'string' && label.trim()) {
		dot.title = label.trim();
	}
}
