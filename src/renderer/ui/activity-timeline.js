const MAX_EVENTS = 30;

export function pushTimelineEvent(evt) {
	if (!evt?.type) return;
	if (evt.type === 'INTENT_PREDICTION') return;
	const root = document.getElementById('activity-timeline');
	if (!root) return;

	const card = buildCard(evt);
	if (evt.type === 'DB_HEALTH') {
		const existing = root.querySelector('[data-event-type="DB_HEALTH"]');
		if (existing) {
			root.replaceChild(card, existing);
		} else {
			root.prepend(card);
		}
	} else {
		root.prepend(card);
	}

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
	card.dataset.eventType = evt.type;

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
	if (type === 'INTENT_PREDICTION') return 'thinking';
	if (type?.startsWith('TWO_FA_')) return '2fa';
	return 'task';
}

function titleFromType(type) {
	switch (type) {
		case 'THINKING': return 'Thinking';
		case 'TOOL_START': return 'Tool Started';
		case 'TOOL_END': return 'Tool Finished';
		case 'ACTION_VERIFY_OK': return 'Check Landed';
		case 'ACTION_VERIFY_FAIL': return 'Checking Again';
		case 'TASK_MILESTONE': return 'Task Milestone';
		case 'TASK_DONE': return 'Task Done';
		case 'INTERRUPT': return 'Paused';
		case 'DB_HEALTH': return 'Database Health';
		case 'PROACTIVE_SUGGESTION': return 'Proactive Suggestion';
		case 'INTENT_PREDICTION': return 'Intent Predicted';
		case 'TWO_FA_FIELD_DETECTED': return '2FA Detected';
		case 'TWO_FA_FILL_START': return '2FA Filling';
		case 'TWO_FA_FILL_SUCCESS': return '2FA Filled';
		case 'TWO_FA_FILL_FAILED': return '2FA Failed';
		case 'TWO_FA_NO_CODE': return '2FA No Code';
		case 'TWO_FA_LOW_CONFIDENCE': return '2FA Low Confidence';
		default: return String(type || 'Event');
	}
}

function formatMessage(evt) {
	if (evt.payload?.message) return evt.payload.message;
	if (evt.type === 'DB_HEALTH') {
		const ok = evt.payload?.ok ? 'ok' : 'degraded';
		return `DB ${ok} (${evt.payload?.latencyMs ?? -1} ms)`;
	}
	if (evt.type === 'INTERRUPT') return evt.payload?.reason || 'Work paused by the user.';
	if (evt.type === 'PROACTIVE_SUGGESTION') {
		const kind = evt.payload?.kind ? `[${evt.payload.kind}] ` : '';
		const app = evt.payload?.context?.app ? ` (${evt.payload.context.app})` : '';
		return `${kind}${evt.payload?.suggestion || 'High-confidence suggestion'}${app}`;
	}
	if (evt.type === 'INTENT_PREDICTION') {
		const intents = evt.payload?.intents || [];
		if (!intents.length) return 'No confident predictions.';
		return intents.map((i) => `${i.type}@${(i.confidence || 0).toFixed(2)}: ${i.suggestedAction || i.description || ''}`).join(' | ');
	}
	if (evt.type === 'TWO_FA_FIELD_DETECTED') {
		return `Detected verification field in ${evt.payload?.appName || 'app'}`;
	}
	if (evt.type === 'TWO_FA_FILL_START') {
		return `Filling ${evt.payload?.codeLength || 6}-digit code from ${evt.payload?.source || 'source'}`;
	}
	if (evt.type === 'TWO_FA_FILL_SUCCESS') {
		const method = evt.payload?.method ? ` via ${evt.payload.method}` : '';
		return `Code filled successfully${method}`;
	}
	if (evt.type === 'TWO_FA_FILL_FAILED') {
		return `Fill failed: ${evt.payload?.error || 'unknown error'}`;
	}
	if (evt.type === 'TWO_FA_NO_CODE') {
		return `No code found for ${evt.payload?.appName || 'app'}`;
	}
	if (evt.type === 'TWO_FA_LOW_CONFIDENCE') {
		const conf = evt.payload?.confidence?.toFixed(2) || '?';
		return `Confidence ${conf} below threshold ${evt.payload?.threshold || 0.85}`;
	}
	if (evt.type === 'ACTION_VERIFY_FAIL') return 'Visual check needs another pass.';
	if (evt.type === 'ACTION_VERIFY_OK') return 'Visual check passed.';
	return JSON.stringify(evt.payload || {});
}
