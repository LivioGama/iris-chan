"use strict";
const { runHelper } = require('../native-helper');
const { analyzeReplyOpportunity, buildGenericComposerQueries, buildGenericSendQueries, parseFrontmostApp, parseJsonResult, } = require('../automation/reply-assistant');
function parseAxResult(result) {
    return parseJsonResult(result?.result, null);
}
async function detect_reply_opportunity() {
    const frontmostResult = await runHelper({ action: 'get_frontmost_app' });
    if (!frontmostResult?.ok) {
        return { ok: false, result: frontmostResult?.result || 'Could not read frontmost app' };
    }
    const snapshotResult = await runHelper({ action: 'ax_snapshot', limit: 220 });
    if (!snapshotResult?.ok) {
        return { ok: false, result: snapshotResult?.result || 'Could not capture accessibility snapshot' };
    }
    const analysis = analyzeReplyOpportunity({
        frontmostApp: parseFrontmostApp(frontmostResult.result),
        axSnapshot: parseJsonResult(snapshotResult.result, { appName: '', windowTitle: '', elements: [] }),
    });
    return {
        ok: true,
        result: JSON.stringify(analysis),
        analysis,
    };
}
async function prepare_reply_draft(args = {}) {
    const text = String(args.text || '').trim();
    if (!text)
        return { ok: false, result: 'No reply text provided' };
    const composerQueries = buildGenericComposerQueries(Array.isArray(args.composer_queries) ? args.composer_queries : []);
    for (const query of composerQueries) {
        const focused = await runHelper({ action: 'ax_focus', query, role: 'text field', exact: false });
        if (focused?.ok) {
            const setFocused = await runHelper({ action: 'ax_set_value', value: text });
            if (setFocused?.ok) {
                return {
                    ok: true,
                    result: `Prepared reply draft using accessibility focus "${query}"`,
                    method: 'ax_focus+ax_set_value',
                    query,
                };
            }
        }
        const directSet = await runHelper({ action: 'ax_set_value', query, role: 'text field', exact: false, value: text });
        if (directSet?.ok) {
            return {
                ok: true,
                result: `Prepared reply draft using accessibility set on "${query}"`,
                method: 'ax_set_value',
                query,
            };
        }
    }
    const focusedFallback = await runHelper({ action: 'ax_set_value', value: text });
    if (focusedFallback?.ok) {
        return {
            ok: true,
            result: 'Prepared reply draft using the currently focused field',
            method: 'ax_set_value_focused',
        };
    }
    const typed = await runHelper({ action: 'type_text', text });
    if (typed?.ok) {
        return {
            ok: true,
            result: 'Prepared reply draft using keyboard typing fallback',
            method: 'type_text',
        };
    }
    return { ok: false, result: typed?.result || focusedFallback?.result || 'Could not prepare reply draft' };
}
async function send_reply_draft(args = {}) {
    const sendQueries = buildGenericSendQueries(Array.isArray(args.send_queries) ? args.send_queries : []);
    for (const query of sendQueries) {
        const pressed = await runHelper({ action: 'ax_press', query, exact: false });
        const parsed = parseAxResult(pressed);
        if (pressed?.ok && !parsed?.ambiguous) {
            return {
                ok: true,
                result: `Sent reply using accessibility action "${query}"`,
                method: 'ax_press',
                query,
            };
        }
    }
    const contextText = String(args.context_text || '').trim();
    const hintedShortcut = String(args.shortcut_hint || '').trim().toLowerCase();
    const shortcut = hintedShortcut
        || (/\bcmd\+enter\b|\bcommand\+enter\b/i.test(contextText) ? 'cmd+enter' : '')
        || (/\bctrl\+enter\b/i.test(contextText) ? 'ctrl+enter' : '')
        || (/\benter to send\b|\breturn to send\b/i.test(contextText) ? 'return' : '')
        || 'return';
    const pressed = await runHelper({ action: 'press_key', key: shortcut });
    if (pressed?.ok) {
        return {
            ok: true,
            result: `Sent reply using ${shortcut}`,
            method: 'press_key',
            key: shortcut,
        };
    }
    return { ok: false, result: pressed?.result || 'Could not send reply' };
}
module.exports = {
    detect_reply_opportunity,
    prepare_reply_draft,
    send_reply_draft,
};
