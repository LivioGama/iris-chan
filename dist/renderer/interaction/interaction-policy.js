"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeInteractionState = normalizeInteractionState;
exports.describeInteractionState = describeInteractionState;
exports.getInteractionBadgeState = getInteractionBadgeState;
exports.buildInteractionPromptPolicy = buildInteractionPromptPolicy;
exports.buildReplyPresentation = buildReplyPresentation;
exports.shouldAutoEscalateFromToolFailure = shouldAutoEscalateFromToolFailure;
const DEFAULT_INTERACTION_STATE = Object.freeze({
    mode: 'silent',
    directMode: false,
    feedbackEnabled: false,
    introversionEnabled: false,
});
const VALID_MODES = new Set(['silent', 'passive', 'proactive']);
const NAVIGATIONAL_UI_INTENT_PATTERN = /\b(click|open|go to|goto|select|search|find|navigate|visit|follow|choose)\b/i;
const DESTRUCTIVE_UI_INTENT_PATTERN = /\b(delete|remove|trash|discard|send|submit|purchase|buy|pay|confirm|replace|overwrite)\b/i;
const AUTO_ESCALATE_SOURCE_TOOLS = new Set(['click_at', 'double_click', 'press_key', 'type_text']);
function normalizeMode(rawMode = '') {
    const mode = String(rawMode || '').trim().toLowerCase();
    if (VALID_MODES.has(mode))
        return mode;
    if (mode === 'attentive')
        return 'passive';
    if (mode === 'autonomous')
        return 'proactive';
    return DEFAULT_INTERACTION_STATE.mode;
}
function sanitizeText(value = '') {
    return String(value || '').trim().replace(/\s+/g, ' ');
}
function normalizeInteractionState(input = {}) {
    return {
        mode: normalizeMode(input?.mode),
        directMode: !!input?.directMode,
        feedbackEnabled: !!input?.feedbackEnabled,
        introversionEnabled: !!input?.introversionEnabled,
    };
}
function describeInteractionState(input = {}) {
    const state = normalizeInteractionState(input);
    const overlays = [];
    if (state.feedbackEnabled)
        overlays.push('feedback');
    if (state.introversionEnabled)
        overlays.push('introversion');
    return overlays.length ? `${state.mode} + ${overlays.join(' + ')}` : state.mode;
}
function getInteractionBadgeState(input = {}) {
    const state = normalizeInteractionState(input);
    return {
        visible: state.mode !== 'silent' || state.feedbackEnabled || state.introversionEnabled,
        text: state.mode === 'proactive'
            ? 'PROACTIVE'
            : state.mode === 'passive'
                ? 'PASSIVE'
                : state.feedbackEnabled
                    ? 'FEEDBACK'
                    : state.introversionEnabled
                        ? 'INTROVERT'
                        : 'AUTO',
        title: `Interaction mode: ${describeInteractionState(state)}`,
        indicatorActive: state.mode === 'proactive' || state.feedbackEnabled || state.introversionEnabled,
        indicatorLabel: `interaction: ${describeInteractionState(state)}`,
    };
}
function buildInteractionPromptPolicy(input = {}) {
    const state = normalizeInteractionState(input);
    const proactivePosture = state.mode === 'proactive'
        ? 'suggestion-friendly assistance'
        : state.mode === 'passive'
            ? 'low-noise assistance'
            : 'no unsolicited help';
    const replyPolicy = state.introversionEnabled || state.mode === 'passive'
        ? 'When a reply opportunity appears, ask briefly before reading options aloud.'
        : 'When a reply opportunity is obvious, you may read short draft options aloud.';
    const feedbackPolicy = state.feedbackEnabled
        ? 'Feedback mode is active: present drafts and suggestions as revisable, welcome corrections, and keep edit paths explicit.'
        : 'Feedback mode is inactive: keep answers decisive and avoid extra revision prompts unless the user asks to adjust.';
    const introversionPolicy = state.introversionEnabled
        ? 'Introversion mode is active: prefer the shortest complete response, suppress optional follow-up chatter, and downgrade noisy suggestions into brief prompts.'
        : 'Introversion mode is inactive: normal concise guidance is allowed.';
    return [
        '- Plain asks always deserve a direct answer or direct action. Silent mode only suppresses unsolicited help; it does not suppress direct replies.',
        `- Primary mode posture: ${proactivePosture}.`,
        `- ${replyPolicy}`,
        `- ${feedbackPolicy}`,
        `- ${introversionPolicy}`,
        '- Escalation policy: after one failed low-level UI action on a clear non-destructive navigational request, escalate once to run_ui_task using the original natural-language intent.',
    ].join('\n');
}
function buildReplyPresentation(payload = {}, input = {}) {
    const state = normalizeInteractionState(input);
    const options = Array.isArray(payload.replyOptions)
        ? payload.replyOptions.map((item) => sanitizeText(item)).filter(Boolean)
        : [];
    if (!options.length) {
        return { allowed: false, reason: 'no-options' };
    }
    if (state.mode === 'silent') {
        return { allowed: false, reason: 'silent' };
    }
    const promptOnly = !!payload.replyPrompt || state.mode === 'passive' || state.introversionEnabled;
    if (promptOnly) {
        const spoken = state.feedbackEnabled
            ? 'Want a suggested reply here? You can say yes, or tell me how to tweak it.'
            : 'Want a suggested reply here?';
        return {
            allowed: true,
            sessionMode: 'prompt',
            spoken,
            kind: 'reply-prompt',
            options,
        };
    }
    const optionText = options.map((option, index) => `Option ${index + 1}: ${option}.`).join(' ');
    const revisionHint = state.feedbackEnabled
        ? ' Say send 1, send 2, send 3, or send 4. Or say make 1 warmer, shorter, or clearer.'
        : ' Say send 1, send 2, send 3, or send 4.';
    return {
        allowed: true,
        sessionMode: 'suggestions',
        spoken: `Possible replies. ${optionText}${revisionHint}`.trim(),
        kind: 'reply',
        options,
    };
}
function shouldAutoEscalateFromToolFailure({ toolName = '', result = null, intentText = '' } = {}) {
    if (toolName === 'run_ui_task')
        return false;
    if (!AUTO_ESCALATE_SOURCE_TOOLS.has(toolName))
        return false;
    if (!result || result.ok !== false)
        return false;
    const intent = sanitizeText(intentText);
    if (!intent)
        return false;
    if (DESTRUCTIVE_UI_INTENT_PATTERN.test(intent))
        return false;
    return NAVIGATIONAL_UI_INTENT_PATTERN.test(intent);
}
