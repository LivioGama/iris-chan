const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadEsmExports(filePath, exportNames, args = {}) {
	const src = fs.readFileSync(filePath, 'utf-8')
		.replace(/^import .*$/gm, '')
		.replace(/\bexport\s+/g, '');
	const argNames = Object.keys(args);
	const argValues = Object.values(args);
	const loader = new Function(...argNames, `${src}\nreturn { ${exportNames.join(', ')} };`);
	return loader(...argValues);
}

class FakeClassList {
	constructor() {
		this._values = new Set();
	}

	add(...values) {
		for (const value of values) this._values.add(value);
	}

	remove(...values) {
		for (const value of values) this._values.delete(value);
	}

	contains(value) {
		return this._values.has(value);
	}

	toString() {
		return [...this._values].join(' ');
	}
}

class FakeElement {
	constructor(tagName, ownerDocument) {
		this.tagName = String(tagName || 'div').toUpperCase();
		this.ownerDocument = ownerDocument;
		this.children = [];
		this.parentNode = null;
		this.classList = new FakeClassList();
		this.dataset = {};
		this.attributes = {};
		this._textContent = '';
		this.id = '';
	}

	set className(value) {
		this.classList = new FakeClassList();
		for (const item of String(value || '').split(/\s+/).filter(Boolean)) {
			this.classList.add(item);
		}
	}

	get className() {
		return this.classList.toString();
	}

	set textContent(value) {
		this._textContent = String(value || '');
		this.children = [];
	}

	get textContent() {
		if (this.children.length === 0) return this._textContent;
		return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
	}

	appendChild(child) {
		child.parentNode = this;
		this.children.push(child);
		if (child.id) this.ownerDocument._elementsById.set(child.id, child);
		return child;
	}

	prepend(child) {
		child.parentNode = this;
		this.children.unshift(child);
		if (child.id) this.ownerDocument._elementsById.set(child.id, child);
		return child;
	}

	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index >= 0) {
			this.children.splice(index, 1);
			child.parentNode = null;
		}
		return child;
	}

	querySelector(selector) {
		if (/^\[data-call-id=".*"\]$/.test(selector)) {
			const expected = selector.match(/^\[data-call-id="(.*)"\]$/)?.[1] || '';
			return this._find((node) => node.dataset?.callId === expected);
		}
		if (selector.startsWith('.')) {
			const className = selector.slice(1);
			return this._find((node) => node.classList?.contains(className));
		}
		return null;
	}

	_find(predicate) {
		for (const child of this.children) {
			if (predicate(child)) return child;
			const nested = child._find?.(predicate);
			if (nested) return nested;
		}
		return null;
	}

	set innerHTML(value) {
		const markup = String(value || '');
		this.children = [];
		this._textContent = '';
		if (!markup) return;
		const tokenPattern = /<span class="([^"]+)">([^<]*)<\/span>/g;
		let match;
		while ((match = tokenPattern.exec(markup))) {
			const [, classes, text] = match;
			const child = this.ownerDocument.createElement('span');
			child.className = classes;
			child.textContent = text;
			this.appendChild(child);
		}
	}
}

class FakeDocument {
	constructor() {
		this.body = new FakeElement('body', this);
		this._elementsById = new Map();
	}

	createElement(tagName) {
		return new FakeElement(tagName, this);
	}

	getElementById(id) {
		return this._elementsById.get(id) || null;
	}

	registerElement(id, element) {
		element.id = id;
		this._elementsById.set(id, element);
		return element;
	}
}

console.log('Running result presentation tests...');

const milestoneFile = path.join(process.cwd(), 'src/renderer/tasks/milestone-summarizer.js');
const { summarizeMilestoneLine } = loadEsmExports(milestoneFile, ['summarizeMilestoneLine']);

assert.deepStrictEqual(
	summarizeMilestoneLine('Error: screen capture timed out'),
	{ important: true, phase: 'issue', summary: 'That step stalled, so I need a different route.' },
	'failure milestones should use contextual retry wording'
);

const timelineFile = path.join(process.cwd(), 'src/renderer/ui/activity-timeline.js');
const { titleFromType, formatMessage } = loadEsmExports(timelineFile, ['titleFromType', 'formatMessage']);

assert.strictEqual(
	titleFromType('ACTION_VERIFY_FAIL'),
	'Checking Again',
	'verify retry cards should avoid explicit failure labels'
);

assert.strictEqual(
	formatMessage({ type: 'ACTION_VERIFY_FAIL', payload: {} }),
	'Visual check needs another pass.',
	'verify retry cards should explain the retry neutrally'
);

const appInit = fs.readFileSync(path.join(process.cwd(), 'src/renderer/app-init.js'), 'utf8');
assert.ok(
	appInit.includes('Action not verified yet, checking again.'),
	'app init should show softer retry copy in context bubbles'
);
assert.ok(
	appInit.includes("showBubble('context', `DB ${ok} (${evt.payload?.latencyMs ?? -1} ms)`);"),
	'app init should keep the DB health bubble copy for top-of-screen status changes'
);

const fakeDocument = new FakeDocument();
global.document = fakeDocument;
global.setTimeout = () => 1;
global.clearTimeout = () => {};

const toolLogRoot = fakeDocument.registerElement('tool-log', fakeDocument.createElement('div'));
fakeDocument.body.appendChild(toolLogRoot);

const toolLogFile = path.join(process.cwd(), 'src/renderer/ui/tool-log.js');
const { showToolStart, showToolDone } = loadEsmExports(toolLogFile, ['showToolStart', 'showToolDone']);

showToolStart('run_ui_task', { goal: 'Open result area' }, 0, 1);
showToolDone('run_ui_task', 0, false);

const toolEntry = toolLogRoot.querySelector('[data-call-id="run_ui_task-0"]');
assert.ok(toolEntry, 'tool log should render an entry for the finished tool call');
assert.strictEqual(
	toolEntry.classList.contains('attention'),
	true,
	'failed tool entries should use the neutral attention state instead of an error state'
);
assert.strictEqual(
	toolEntry.querySelector('.tool-status')?.textContent,
	'Needs another step',
	'failed tool entries should show neutral retry wording'
);

const timelineRoot = fakeDocument.registerElement('activity-timeline', fakeDocument.createElement('div'));
fakeDocument.body.appendChild(timelineRoot);
const { pushTimelineEvent } = loadEsmExports(timelineFile, ['pushTimelineEvent']);

pushTimelineEvent({ type: 'DB_HEALTH', timestamp: Date.now(), payload: { ok: true, latencyMs: 8 } });
assert.strictEqual(
	timelineRoot.children.length,
	1,
	'timeline helper still renders DB health cards when called directly; filtering belongs in app init'
);
timelineRoot.innerHTML = '';

pushTimelineEvent({ type: 'ACTION_VERIFY_FAIL', timestamp: Date.now(), payload: {} });
const timelineCard = timelineRoot.children[0];
assert.ok(timelineCard, 'timeline should render a card for verify retry events');
assert.strictEqual(
	timelineCard.querySelector('.tl-head')?.textContent.includes('Checking Again'),
	true,
	'timeline heading should use the softened retry title'
);
assert.strictEqual(
	timelineCard.querySelector('.tl-msg')?.textContent,
	'Visual check needs another pass.',
	'timeline body should use neutral retry wording'
);

const appInitModule = loadEsmExports(
	path.join(process.cwd(), 'src/renderer/app-init.js'),
	['onRuntimeEvent'],
	{
		pushTimelineEvent,
		showBubble() {},
		summarizeMilestoneLine,
		shouldNarrateMilestone: () => false,
	}
);

appInitModule.onRuntimeEvent({ type: 'DB_HEALTH', timestamp: Date.now(), payload: { ok: true, latencyMs: 8 } });
assert.strictEqual(
	timelineRoot.children.length,
	1,
	'app init should not send DB health events into the bottom activity timeline'
);

console.log('Result presentation tests passed.');
