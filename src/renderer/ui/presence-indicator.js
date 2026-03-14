const PRESENCE_PRIORITY = {
	disconnected: 100,
	recovering: 90,
	replying: 40,
	tool: 30,
	thinking: 20,
	listening: 10,
};

const PRESENCE_COPY = {
	listening: {
		eyebrow: 'Iris',
		title: 'Listening',
		detail: 'Ready for the next request',
	},
	responding: {
		eyebrow: 'Iris',
		title: 'Replying',
		detail: 'Turning the answer into speech',
	},
	replying: {
		eyebrow: 'Iris',
		title: 'Replying',
		detail: 'Turning the answer into speech',
	},
	thinking: {
		eyebrow: 'Iris',
		title: 'Thinking',
		detail: 'Working out the next response',
	},
	tool: {
		eyebrow: 'Iris',
		title: 'Working',
		detail: 'Using tools to make progress',
	},
	recovering: {
		eyebrow: 'Iris',
		title: 'Recovering',
		detail: 'Retrying the last request',
	},
	disconnected: {
		eyebrow: 'Iris',
		title: 'Disconnected',
		detail: 'Reconnect to resume voice',
	},
};

const activePresence = new Map();

function getTopPresence() {
	let winner = null;
	for (const entry of activePresence.values()) {
		if (!winner) {
			winner = entry;
			continue;
		}
		if (entry.priority > winner.priority || (entry.priority === winner.priority && entry.updatedAt > winner.updatedAt)) {
			winner = entry;
		}
	}
	return winner;
}

function removeIndicatorNode() {
	const node = document.getElementById('presence-indicator');
	if (node?.parentNode && typeof node.parentNode.removeChild === 'function') {
		node.parentNode.removeChild(node);
		return;
	}
	if (typeof node?.remove === 'function') node.remove();
}

function renderIndicator() {
	removeIndicatorNode();
}

export function setPresence(source, phase, overrides = {}) {
	if (!source || !phase) return;
	const base = PRESENCE_COPY[phase] || PRESENCE_COPY.thinking;
	activePresence.set(source, {
		source,
		phase,
		priority: PRESENCE_PRIORITY[phase] || 0,
		updatedAt: Date.now(),
		...base,
		...overrides,
	});
	renderIndicator();
}

export function clearPresence(source) {
	if (!source) return;
	activePresence.delete(source);
	renderIndicator();
}

export function clearAllPresence() {
	activePresence.clear();
	renderIndicator();
}

export function getActivePresenceSnapshot() {
	const current = getTopPresence();
	return current ? { ...current } : null;
}

export function resetPresenceIndicatorForTests() {
	activePresence.clear();
	removeIndicatorNode();
}
