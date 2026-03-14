const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadEsmExports(filePath, exportNames) {
	const src = fs.readFileSync(filePath, 'utf-8').replace(/\bexport\s+/g, '');
	const loader = new Function(`${src}\nreturn { ${exportNames.join(', ')} };`);
	return loader();
}

function createClassList() {
	const names = new Set();
	return {
		add(...tokens) {
			for (const token of tokens) names.add(token);
		},
		remove(...tokens) {
			for (const token of tokens) names.delete(token);
		},
		contains(token) {
			return names.has(token);
		},
		toggle(token, force) {
			if (force === undefined) {
				if (names.has(token)) {
					names.delete(token);
					return false;
				}
				names.add(token);
				return true;
			}
			if (force) names.add(token);
			else names.delete(token);
			return !!force;
		},
		toString() {
			return Array.from(names).join(' ');
		},
	};
}

function createElement(tagName, elementsById) {
	const el = {
		tagName: String(tagName || '').toUpperCase(),
		children: [],
		parentNode: null,
		className: '',
		classList: createClassList(),
		dataset: {},
		style: {},
		attributes: {},
		textContent: '',
		appendChild(child) {
			this.children.push(child);
			child.parentNode = this;
			return child;
		},
		removeChild(child) {
			this.children = this.children.filter((item) => item !== child);
			child.parentNode = null;
			if (child.id) {
				elementsById.delete(child.id);
			}
			return child;
		},
		setAttribute(name, value) {
			this.attributes[name] = String(value);
			if (name === 'id') {
				this.id = String(value);
				elementsById.set(this.id, this);
			}
		},
	};
	Object.defineProperty(el, 'id', {
		get() {
			return this.attributes.id || '';
		},
		set(value) {
			this.attributes.id = String(value);
			elementsById.set(this.attributes.id, this);
		},
	});
	return el;
}

function createDocumentStub() {
	const elementsById = new Map();
	const body = createElement('body', elementsById);
	const document = {
		body,
		createElement(tagName) {
			return createElement(tagName, elementsById);
		},
		getElementById(id) {
			return elementsById.get(id) || null;
		},
	};
	return { document, body, elementsById };
}

console.log('Running V2 UI behavior tests...');

{
	const filePath = path.join(process.cwd(), 'src/renderer/ui/bubbles.js');
	const { getBubbleDurationMs } = loadEsmExports(filePath, ['getBubbleDurationMs']);

	const shortChat = getBubbleDurationMs('ok', 'chat');
	const longChat = getBubbleDurationMs('x'.repeat(500), 'chat');
	const longThinking = getBubbleDurationMs('x'.repeat(500), 'thinking');

	assert.ok(shortChat >= 1500, 'bubble duration must respect min clamp');
	assert.ok(longChat <= 32000, 'chat bubble duration must respect max clamp');
	assert.ok(longThinking <= 24000, 'thinking bubble duration must respect tighter max clamp');
	assert.ok(longChat > shortChat, 'longer messages should stay longer');
}

{
	const filePath = path.join(process.cwd(), 'src/renderer/tasks/milestone-summarizer.js');
	const { summarizeMilestoneLine, shouldNarrateMilestone } = loadEsmExports(filePath, ['summarizeMilestoneLine', 'shouldNarrateMilestone']);

	assert.strictEqual(summarizeMilestoneLine('waiting'), null, 'noise should be filtered');
	const err = summarizeMilestoneLine('Exception: failed to patch file');
	assert.strictEqual(err.important, true, 'errors should be important');
	assert.strictEqual(shouldNarrateMilestone(err, { askedProgress: false }), true, 'important milestones should narrate');

	const info = summarizeMilestoneLine('[tool: Read]');
	assert.strictEqual(info.important, false, 'tool usage should be low-priority');
	assert.strictEqual(shouldNarrateMilestone(info, { askedProgress: false }), false, 'low-priority milestones should stay silent unless requested');
	assert.strictEqual(shouldNarrateMilestone(info, { askedProgress: true }), true, 'explicit progress request should narrate low-priority milestone');
}

{
	const prevDocument = global.document;
	const { document } = createDocumentStub();
	global.document = document;

	const filePath = path.join(process.cwd(), 'src/renderer/ui/presence-indicator.js');
	const {
		setPresence,
		clearPresence,
		getActivePresenceSnapshot,
		resetPresenceIndicatorForTests,
	} = loadEsmExports(filePath, [
		'setPresence',
		'clearPresence',
		'getActivePresenceSnapshot',
		'resetPresenceIndicatorForTests',
	]);

	try {
		setPresence('voice', 'thinking', { detail: 'Working out the next response' });
		const indicator = document.getElementById('presence-indicator');
		assert.strictEqual(indicator, null, 'presence indicator should remain removed from the overlay');
		assert.strictEqual(getActivePresenceSnapshot().phase, 'thinking', 'voice processing state should still be tracked internally');

		setPresence('recovery', 'recovering', { detail: 'Retrying your last request' });
		assert.strictEqual(getActivePresenceSnapshot().phase, 'recovering', 'recovery state should outrank standard thinking');

		setPresence('tool', 'tool', { detail: 'Step 1 of 1 · Searching the web' });
		assert.strictEqual(getActivePresenceSnapshot().phase, 'recovering', 'recovery should outrank tool activity');

		clearPresence('recovery');
		assert.strictEqual(getActivePresenceSnapshot().phase, 'tool', 'clearing recovery should reveal the next-highest state');

		setPresence('voice', 'disconnected', { detail: 'Reconnect to resume voice' });
		assert.strictEqual(getActivePresenceSnapshot().phase, 'disconnected', 'disconnected should outrank all other phases');

		clearPresence('tool');
		clearPresence('voice');
		assert.strictEqual(getActivePresenceSnapshot(), null, 'clearing all presence should leave no active snapshot');
		assert.strictEqual(document.getElementById('presence-indicator'), null, 'presence indicator should stay absent');
	} finally {
		resetPresenceIndicatorForTests();
		global.document = prevDocument;
	}
}

console.log('V2 UI behavior tests passed.');
