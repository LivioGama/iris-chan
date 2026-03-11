const MAX_EVENTS = 30;

export function pushTimelineEvent(evt) {
	if (!evt?.type) return;
	const root = document.getElementById('activity-timeline');
	if (!root) return;

	const card = buildCard(evt);
	root.prepend(card);

	while (root.children.length > MAX_EVENTS) {
		root.removeChild(root.lastChild);
	}
}

export function clearTimeline() {
	const root = document.getElementById('activity-timeline');
	if (!root) return;
	root.innerHTML = '';
}

function buildCard(evt) {
	const ts = new Date(evt.timestamp || Date.now()).toLocaleTimeString();
	const phase = phaseFromType(evt.type);
	const title = titleFromType(evt.type);
	const msg = formatMessage(evt);

	const card = document.createElement('div');
	card.className = `tl-card phase-${phase}`;

	const head = document.createElement('div');
	head.className = 'tl-head';
	head.textContent = title;
	const span = document.createElement('span');
	span.textContent = ts;
	head.appendChild(span);

	const body = document.createElement('div');
	body.className = 'tl-msg';
	body.textContent = msg;

	card.appendChild(head);
	card.appendChild(body);
	return card;
}

function phaseFromType(type) {
	if (type === 'THINKING') return 'thinking';
	if (type === 'TOOL_START' || type === 'TOOL_END') return 'tool';
	if (type === 'ACTION_VERIFY_OK' || type === 'ACTION_VERIFY_FAIL') return 'verify';
	if (type === 'DB_HEALTH') return 'db';
	if (type === 'INTERRUPT') return 'interrupt';
	if (type === 'TASK_DONE') return 'done';
	return 'task';
}

function titleFromType(type) {
	switch (type) {
		case 'THINKING': return 'Thinking';
		case 'TOOL_START': return 'Tool Started';
		case 'TOOL_END': return 'Tool Finished';
		case 'ACTION_VERIFY_OK': return 'Verify OK';
		case 'ACTION_VERIFY_FAIL': return 'Verify Failed';
		case 'TASK_MILESTONE': return 'Task Milestone';
		case 'TASK_DONE': return 'Task Done';
		case 'INTERRUPT': return 'Interrupted';
		case 'DB_HEALTH': return 'Database Health';
		case 'PROACTIVE_SUGGESTION': return 'Proactive Suggestion';
		default: return String(type || 'Event');
	}
}

function formatMessage(evt) {
	if (evt.payload?.message) return evt.payload.message;
	if (evt.type === 'DB_HEALTH') {
		const ok = evt.payload?.ok ? 'ok' : 'degraded';
		return `DB ${ok} (${evt.payload?.latencyMs ?? -1} ms)`;
	}
	if (evt.type === 'INTERRUPT') return evt.payload?.reason || 'User interruption';
	if (evt.type === 'PROACTIVE_SUGGESTION') {
		const kind = evt.payload?.kind ? `[${evt.payload.kind}] ` : '';
		const app = evt.payload?.context?.app ? ` (${evt.payload.context.app})` : '';
		return `${kind}${evt.payload?.suggestion || 'High-confidence suggestion'}${app}`;
	}
	if (evt.type === 'ACTION_VERIFY_FAIL') return 'Visual check failed, retrying.';
	if (evt.type === 'ACTION_VERIFY_OK') return 'Visual check passed.';
	return JSON.stringify(evt.payload || {});
}
