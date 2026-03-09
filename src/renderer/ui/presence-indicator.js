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
let refs = null;

function ensureIndicator() {
	if (refs?.root) return refs;
	let root = document.getElementById('presence-indicator');
	if (!root) {
		root = document.createElement('div');
		root.id = 'presence-indicator';
		root.setAttribute('aria-live', 'polite');
		root.setAttribute('aria-atomic', 'true');
		document.body.appendChild(root);
	}

	if (root.dataset.ready !== 'true') {
		const shell = document.createElement('div');
		shell.className = 'presence-shell';

		const orbs = document.createElement('div');
		orbs.className = 'presence-orbs';
		for (let i = 0; i < 3; i++) {
			orbs.appendChild(document.createElement('span'));
		}

		const copy = document.createElement('div');
		copy.className = 'presence-copy';

		const eyebrow = document.createElement('div');
		eyebrow.className = 'presence-eyebrow';

		const title = document.createElement('div');
		title.className = 'presence-title';

		const detail = document.createElement('div');
		detail.className = 'presence-detail';

		copy.appendChild(eyebrow);
		copy.appendChild(title);
		copy.appendChild(detail);
		shell.appendChild(orbs);
		shell.appendChild(copy);
		root.appendChild(shell);
		root.dataset.ready = 'true';

		refs = { root, eyebrow, title, detail };
		return refs;
	}

	refs = {
		root,
		eyebrow: root.children[0]?.children[1]?.children[0] || null,
		title: root.children[0]?.children[1]?.children[1] || null,
		detail: root.children[0]?.children[1]?.children[2] || null,
	};
	return refs;
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

function renderPresence() {
	const { root, eyebrow, title, detail } = ensureIndicator();
	const current = getTopPresence();

	if (!current) {
		root.classList.remove('visible');
		root.dataset.phase = 'idle';
		if (eyebrow) eyebrow.textContent = '';
		if (title) title.textContent = '';
		if (detail) detail.textContent = '';
		return;
	}

	root.dataset.phase = current.phase;
	if (eyebrow) eyebrow.textContent = current.eyebrow;
	if (title) title.textContent = current.title;
	if (detail) detail.textContent = current.detail;
	root.classList.add('visible');
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
	renderPresence();
}

export function clearPresence(source) {
	if (!source) return;
	activePresence.delete(source);
	renderPresence();
}

export function clearAllPresence() {
	activePresence.clear();
	renderPresence();
}

export function getActivePresenceSnapshot() {
	const current = getTopPresence();
	return current ? { ...current } : null;
}

export function resetPresenceIndicatorForTests() {
	activePresence.clear();
	refs = null;
}
