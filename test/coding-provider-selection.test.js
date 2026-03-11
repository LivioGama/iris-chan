const assert = require('node:assert');

console.log('Running coding provider selection tests...');

const { resolveCodingProviderName, createCodingAdapter } = require('../src/main/coding/providers');

assert.strictEqual(resolveCodingProviderName({}), 'claude', 'missing env should default to claude');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'claude' }), 'claude', 'claude env should resolve to claude');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'codex' }), 'codex', 'codex env should resolve to codex');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'CoDeX' }), 'codex', 'provider lookup should be case-insensitive');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'invalid' }), 'claude', 'invalid env should fall back to claude');

assert.strictEqual(createCodingAdapter({ env: { CODING_PROVIDER: 'claude' } }).name, 'claude', 'adapter factory should build claude adapter');
assert.strictEqual(createCodingAdapter({ env: { CODING_PROVIDER: 'codex' } }).name, 'codex', 'adapter factory should build codex adapter');

console.log('Coding provider selection tests passed.');
