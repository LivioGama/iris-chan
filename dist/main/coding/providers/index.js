"use strict";
const { createClaudeCodingAdapter } = require('./claude');
const { createCodexCodingAdapter } = require('./codex');
function resolveCodingProviderName(env = process.env) {
    const raw = String(env.CODING_PROVIDER || '').trim().toLowerCase();
    return raw === 'codex' ? 'codex' : 'claude';
}
function createCodingAdapter(options = {}) {
    const env = options.env || process.env;
    const providerName = resolveCodingProviderName(env);
    if (providerName === 'codex')
        return createCodexCodingAdapter();
    return createClaudeCodingAdapter();
}
module.exports = { createCodingAdapter, resolveCodingProviderName };
