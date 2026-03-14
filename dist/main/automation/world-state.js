"use strict";
const { runHelper } = require('../native-helper');
const screenCapture = require('../screen-capture');
function parseFrontmostApp(resultText = '') {
    const match = String(resultText || '').match(/^App:\s*([^,]+),\s*Windows:\s*(.*)$/s);
    if (!match) {
        return { name: '', windows: [] };
    }
    return {
        name: match[1].trim(),
        windows: String(match[2] || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
    };
}
function parseJsonResult(resultText = '', fallback = {}) {
    try {
        return JSON.parse(resultText);
    }
    catch {
        return fallback;
    }
}
class WorldState {
    constructor() {
        this._frontmostCache = null;
        this._axCache = null;
    }
    invalidate() {
        this._frontmostCache = null;
        this._axCache = null;
    }
    async getFrontmostApp({ force = false } = {}) {
        if (!force && this._frontmostCache)
            return this._frontmostCache;
        const result = await runHelper({ action: 'get_frontmost_app' });
        if (result.ok === false) {
            return { ok: false, error: result.result || 'Could not read frontmost app' };
        }
        const parsed = parseFrontmostApp(result.result);
        this._frontmostCache = {
            ok: true,
            name: parsed.name,
            windows: parsed.windows,
        };
        return this._frontmostCache;
    }
    async snapshotAccessibility({ force = false, limit = 160 } = {}) {
        if (!force && this._axCache)
            return this._axCache;
        const result = await runHelper({ action: 'ax_snapshot', limit });
        if (result.ok === false) {
            return { ok: false, error: result.result || 'Could not read accessibility snapshot' };
        }
        const parsed = parseJsonResult(result.result, { appName: '', windowTitle: '', elements: [] });
        this._axCache = {
            ok: true,
            appName: parsed.appName || '',
            windowTitle: parsed.windowTitle || '',
            focused: parsed.focused || null,
            elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        };
        return this._axCache;
    }
    async findAccessibilityMatches(query, options = {}) {
        const result = await runHelper({
            action: 'ax_find',
            query,
            role: options.role || '',
            limit: options.limit || 8,
            exact: options.exact === true,
        });
        if (result.ok === false) {
            return { ok: false, error: result.result || `Could not search AX tree for "${query}"` };
        }
        const parsed = parseJsonResult(result.result, { count: 0, matches: [] });
        return {
            ok: true,
            count: parsed.count || 0,
            matches: Array.isArray(parsed.matches) ? parsed.matches : [],
        };
    }
    async captureVisual() {
        return screenCapture.capture();
    }
}
module.exports = {
    WorldState,
    parseFrontmostApp,
};
