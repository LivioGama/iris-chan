"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootRenderer = bootRenderer;
exports.onRuntimeEvent = onRuntimeEvent;
const activity_timeline_js_1 = require("./ui/activity-timeline.js");
const bubbles_js_1 = require("./ui/bubbles.js");
const milestone_summarizer_js_1 = require("./tasks/milestone-summarizer.js");
let lastDbBubbleState = null;
function bootRenderer() {
    (0, bubbles_js_1.showBubble)('thinking', 'Iris ready.');
}
function onRuntimeEvent(evt, { askedProgress = false } = {}) {
    if (!evt?.type)
        return;
    if (evt.source === 'benchmark' || evt.type === '__IRIS_BENCHMARK_PING__')
        return;
    const isUiTaskEvent = evt.payload?.taskKind === 'ui' && (evt.type === 'TASK_MILESTONE' ||
        evt.type === 'TASK_DONE' ||
        evt.type === 'INTERRUPT');
    if (isUiTaskEvent)
        return;
    (0, activity_timeline_js_1.pushTimelineEvent)(evt);
    if (evt.type === 'THINKING') {
        (0, bubbles_js_1.showBubble)('thinking', evt.payload?.message || 'Thinking...');
        return;
    }
    if (evt.type === 'DB_HEALTH') {
        const ok = evt.payload?.ok ? 'ok' : 'degraded';
        if (ok !== lastDbBubbleState) {
            (0, bubbles_js_1.showBubble)('context', `DB ${ok} (${evt.payload?.latencyMs ?? -1} ms)`);
            lastDbBubbleState = ok;
        }
        return;
    }
    if (evt.type === 'TOOL_START') {
        const toolName = evt.payload?.toolName || evt.payload?.name || null;
        (0, bubbles_js_1.showBubble)('context', toolName ? `Using ${toolName}...` : 'Running tool...');
        return;
    }
    if (evt.type === 'TOOL_END') {
        return;
    }
    if (evt.type === 'ACTION_VERIFY_FAIL') {
        (0, bubbles_js_1.showBubble)('context', 'Action not verified yet, checking again.');
        return;
    }
    if (evt.type === 'ACTION_VERIFY_OK') {
        (0, bubbles_js_1.showBubble)('context', 'Action verified.');
        return;
    }
    if (evt.type === 'PROACTIVE_SUGGESTION') {
        if (Array.isArray(evt.payload?.replyOptions) && evt.payload.replyOptions.length) {
            const title = evt.payload?.replyPrompt ? 'Want a suggested reply here?' : 'Reply suggestions:';
            const lines = evt.payload.replyOptions.map((option, index) => `${index + 1}. ${option}`);
            (0, bubbles_js_1.showBubble)('context', `${title}\n${lines.join('\n')}`);
            return;
        }
        const kind = evt.payload?.kind ? `${evt.payload.kind}: ` : '';
        (0, bubbles_js_1.showBubble)('context', `${kind}${evt.payload?.suggestion || 'Suggested next step.'}`);
        return;
    }
    if (evt.type === 'TASK_MILESTONE' || evt.type === 'TASK_DONE') {
        const summarized = (0, milestone_summarizer_js_1.summarizeMilestoneLine)(evt.payload?.message || '');
        if (summarized && (0, milestone_summarizer_js_1.shouldNarrateMilestone)(summarized, { askedProgress })) {
            (0, bubbles_js_1.showBubble)('chat', summarized.summary, { role: 'iris' });
        }
    }
}
