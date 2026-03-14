"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initIndicators = initIndicators;
exports.updateIndicator = updateIndicator;
exports.setIndicatorLabel = setIndicatorLabel;
const INDICATOR_NAMES = ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool', 'srch', 'auto'];
const indicators = new Map();
function initIndicators(containerEl) {
    if (!containerEl)
        return;
    for (const name of INDICATOR_NAMES) {
        const dot = document.createElement('span');
        dot.className = 'status-dot';
        dot.dataset.indicator = name;
        dot.title = name;
        containerEl.appendChild(dot);
        indicators.set(name, dot);
    }
}
function updateIndicator(name, active) {
    const dot = indicators.get(name);
    if (dot) {
        dot.classList.toggle('active', !!active);
    }
}
function setIndicatorLabel(name, label) {
    const dot = indicators.get(name);
    if (dot && typeof label === 'string' && label.trim()) {
        dot.title = label.trim();
    }
}
