const assert = require('node:assert');

const { getResolverCatalog, RESOLVER_IDS, resolverIdForStep } = require('../src/main/automation/native-resolver-registry');
const { inferDomain } = require('../src/main/automation/skill-policy');

console.log('Running native resolver registry tests...');

const catalog = getResolverCatalog();
const ids = new Set(catalog.map((item) => item.id));

assert.strictEqual(ids.has(RESOLVER_IDS.BROWSER_OPEN_URL), true, 'resolver catalog should expose browser URL resolver');
assert.strictEqual(ids.has(RESOLVER_IDS.BROWSER_MEDIA), true, 'resolver catalog should expose browser media resolver');
assert.strictEqual(ids.has(RESOLVER_IDS.FINDER_SELECTION), true, 'resolver catalog should expose finder selection resolver');
assert.strictEqual(ids.has(RESOLVER_IDS.EDITOR_ACTIVATE), true, 'resolver catalog should expose editor activation resolver');
assert.strictEqual(ids.has(RESOLVER_IDS.EDITOR_COMMAND), true, 'resolver catalog should expose editor command resolver');

assert.strictEqual(
	resolverIdForStep({ type: 'openApp', appName: 'Visual Studio Code' }),
	'editor.activate',
	'openApp should resolve editor activation to the editor resolver'
);

assert.strictEqual(
	resolverIdForStep({ type: 'editorCommand', action: 'save', key: 'cmd+s' }, 'Visual Studio Code'),
	'editor.command',
	'editor command steps should resolve to the editor command resolver'
);

assert.strictEqual(
	inferDomain('Open Visual Studio Code and type hello'),
	'editor',
	'editor-like intents should be labeled as editor domain'
);

assert.strictEqual(
	inferDomain('Open Activity Monitor'),
	'system',
	'system utility intents should be labeled as system domain'
);

console.log('Native resolver registry tests passed.');
