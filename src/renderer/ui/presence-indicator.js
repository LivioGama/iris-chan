const PRESENCE_PRIORITY = {
	responding: 10,
	thinking: 20,
	tool: 30,
};

const PRESENCE_COPY = {
	responding: {
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
};

const activePresence = new Map();

function removeIndicatorNode() {
	const node = document.getElementById('presence-indicator');
	if (node?.parentNode) node.parentNode.removeChild(node);
}

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
	removeIndicatorNode();
}

export function clearPresence(source) {
	if (!source) return;
	activePresence.delete(source);
	removeIndicatorNode();
}

export function clearAllPresence() {
	activePresence.clear();
	removeIndicatorNode();
}

export function getActivePresenceSnapshot() {
	const current = getTopPresence();
	return current ? { ...current } : null;
}

export function resetPresenceIndicatorForTests() {
	activePresence.clear();
	removeIndicatorNode();
}
