import { pushTimelineEvent } from './ui/activity-timeline.js';
import { renderToolsSkillsPanel, anchorPanelToAvatar, setActiveItem } from './ui/tools-skills-panel.js';
import { showBubble } from './ui/bubbles.js';
import { summarizeMilestoneLine, shouldNarrateMilestone } from './tasks/milestone-summarizer.js';

let lastDbBubbleState = null;

export function bootRenderer({ avatarBounds, tools = [], skills = [] } = {}) {
	renderToolsSkillsPanel({ tools, skills });
	if (avatarBounds) anchorPanelToAvatar(avatarBounds);
	showBubble('thinking', 'Iris ready.');
}

export function onRuntimeEvent(evt, { askedProgress = false } = {}) {
	if (!evt?.type) return;
	pushTimelineEvent(evt);
	if (evt.type === 'THINKING') {
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
		const toolName = evt.payload?.toolName || evt.payload?.name || null;
		if (toolName) setActiveItem(toolName);
		showBubble('context', toolName ? `Using ${toolName}...` : 'Running tool...');
		return;
	}

	if (evt.type === 'TOOL_END') {
		setActiveItem(null);
		return;
	}

	if (evt.type === 'ACTION_VERIFY_FAIL') {
		showBubble('context', 'Action not verified, retrying.');
		return;
	}

	if (evt.type === 'ACTION_VERIFY_OK') {
		showBubble('context', 'Action verified.');
		return;
	}

	if (evt.type === 'TASK_MILESTONE' || evt.type === 'TASK_DONE') {
		const summarized = summarizeMilestoneLine(evt.payload?.message || '');
		if (summarized && shouldNarrateMilestone(summarized, { askedProgress })) {
			showBubble('chat', summarized.summary, { role: 'iris' });
		}
	}
}
