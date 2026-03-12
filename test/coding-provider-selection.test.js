const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running coding provider selection tests...');

const { resolveCodingProviderName, createCodingAdapter } = require('../src/main/coding/providers');
const { resolveCodexBinaryPath, loadCodexSdk } = require('../src/main/coding/providers/codex');

assert.strictEqual(resolveCodingProviderName({}), 'claude', 'missing env should default to claude');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'claude' }), 'claude', 'claude env should resolve to claude');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'codex' }), 'codex', 'codex env should resolve to codex');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'CoDeX' }), 'codex', 'provider lookup should be case-insensitive');
assert.strictEqual(resolveCodingProviderName({ CODING_PROVIDER: 'invalid' }), 'claude', 'invalid env should fall back to claude');

assert.strictEqual(createCodingAdapter({ env: { CODING_PROVIDER: 'claude' } }).name, 'claude', 'adapter factory should build claude adapter');
assert.strictEqual(createCodingAdapter({ env: { CODING_PROVIDER: 'codex' } }).name, 'codex', 'adapter factory should build codex adapter');

const resolvedBinaryPath = resolveCodexBinaryPath();
assert.strictEqual(typeof resolvedBinaryPath, 'string', 'codex binary should resolve when optional package is installed');
assert.ok(fs.existsSync(resolvedBinaryPath), 'resolved codex binary path should exist on disk');
assert.strictEqual(path.basename(resolvedBinaryPath), process.platform === 'win32' ? 'codex.exe' : 'codex');

(async () => {
	const sdkModule = await loadCodexSdk();
	assert.strictEqual(typeof sdkModule.Codex, 'function', 'Codex SDK should load through native ESM import');
	console.log('Coding provider selection tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
