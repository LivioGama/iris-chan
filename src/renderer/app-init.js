import { pushTimelineEvent } from './ui/activity-timeline.js';
import { showBubble } from './ui/bubbles.js';
import { summarizeMilestoneLine, shouldNarrateMilestone } from './tasks/milestone-summarizer.js';

let lastDbBubbleState = null;

export function bootRenderer() {
	showBubble('thinking', 'Iris ready.');
}

export function onRuntimeEvent(evt, { askedProgress = false } = {}) {
	if (!evt?.type) return;
	if (evt.source === 'benchmark' || evt.type === '__IRIS_BENCHMARK_PING__') return;
	const isUiTaskEvent = evt.payload?.taskKind === 'ui' && (
		evt.type === 'TASK_MILESTONE' ||
		evt.type === 'TASK_DONE' ||
		evt.type === 'INTERRUPT'
	);
	if (isUiTaskEvent) return;
	if (evt.type === 'THINKING') {
		pushTimelineEvent(evt);
		showBubble('thinking', evt.payload?.message || 'Thinking...');
		return;
	}

	if (evt.type === 'DB_HEALTH') {
		const ok = evt.payload?.ok ? 'ok' : 'degraded';
		if (ok !== lastDbBubbleState) {
			showBubble('context', `DB ${ok} (${evt.payload?.latencyMs ?? -1} ms)`);
			lastDbBubbleState = ok;
		}
		return;
	}

	if (evt.type === 'TOOL_START') {
		pushTimelineEvent(evt);
		const toolName = evt.payload?.toolName || evt.payload?.name || null;
		showBubble('context', toolName ? `Using ${toolName}...` : 'Running tool...');
		return;
	}

	if (evt.type === 'TOOL_END') {
		pushTimelineEvent(evt);
		return;
	}

	if (evt.type === 'ACTION_VERIFY_FAIL') {
		pushTimelineEvent(evt);
		showBubble('context', 'Action not verified yet, checking again.');
		return;
	}

	if (evt.type === 'ACTION_VERIFY_OK') {
		pushTimelineEvent(evt);
		showBubble('context', 'Action verified.');
		return;
	}

	if (evt.type === 'PROACTIVE_SUGGESTION') {
		pushTimelineEvent(evt);
		if (Array.isArray(evt.payload?.replyOptions) && evt.payload.replyOptions.length) {
			const title = evt.payload?.replyPrompt ? 'Want a suggested reply here?' : 'Reply suggestions:';
			const lines = evt.payload.replyOptions.map((option, index) => `${index + 1}. ${option}`);
			showBubble('context', `${title}\n${lines.join('\n')}`);
			return;
		}
		const kind = evt.payload?.kind ? `${evt.payload.kind}: ` : '';
		showBubble('context', `${kind}${evt.payload?.suggestion || 'Suggested next step.'}`);
		return;
	}

	if (evt.type === 'INTENT_PREDICTION') {
		pushTimelineEvent(evt);
		return;
	}

	if (evt.type === 'TASK_MILESTONE' || evt.type === 'TASK_DONE') {
		pushTimelineEvent(evt);
		const summarized = summarizeMilestoneLine(evt.payload?.message || '');
		if (summarized && shouldNarrateMilestone(summarized, { askedProgress })) {
			showBubble('chat', summarized.summary, { role: 'iris' });
		}
		return;
	}

	pushTimelineEvent(evt);
}
