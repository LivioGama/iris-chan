const assert = require('node:assert');

// Integration test: verify that the tool executor blocks input tools when
// an excluded app is in the foreground.
//
// We monkey-patch the app-exclusion module's cache to simulate SuperRun
// being focused (avoids needing a real osascript call).

console.log('Running tool-exclusion integration tests...');

// ── Patch the frontmost-app cache to simulate SuperRun being focused ────────
const appExclusion = require('../src/main/app-exclusion');

// Save originals
const _originalGetFrontmostAppName = appExclusion.getFrontmostAppName;
const _originalIsFrontmostExcluded = appExclusion.isFrontmostExcluded;

let mockFrontmostApp = 'Finder';

appExclusion.getFrontmostAppName = () => mockFrontmostApp;
appExclusion.isFrontmostExcluded = () => appExclusion.isAppExcluded(mockFrontmostApp);

async function main() {
	// Require tool executor AFTER patching (it reads the module at require time)
	// Clear the module cache to pick up the patched version
	const toolIndexPath = require.resolve('../src/main/tools/index');
	delete require.cache[toolIndexPath];

	// We need a minimal mock for the tool modules since they depend on
	// native-helper / screen-capture which aren't available outside Electron.
	// Instead, we'll test via the execute() flow which checks exclusion
	// BEFORE calling any tool handler.

	// Re-require tools/index to get the patched exclusion check.
	// Note: tools/index loads sub-modules that may fail outside Electron,
	// but the exclusion guard runs BEFORE handler lookup, so we can still
	// test the blocking logic. We handle the case where the tool executor
	// may not have the specific handler loaded (returns "Unknown tool").
	let toolExecutor;
	try {
		toolExecutor = require('../src/main/tools/index');
	} catch (err) {
		// If tools/index can't load (missing Electron deps), we test the
		// exclusion logic directly via the module functions.
		console.log('  (tools/index requires Electron — testing exclusion logic directly)');

		// Test: when SuperRun is focused, isFrontmostExcluded returns true
		mockFrontmostApp = 'SuperRun';
		assert.strictEqual(appExclusion.isFrontmostExcluded(), true,
			'isFrontmostExcluded should return true when SuperRun is focused');
		assert.strictEqual(appExclusion.isInputTool('click_at'), true,
			'click_at should be an input tool');

		// Test: when Finder is focused, isFrontmostExcluded returns false
		mockFrontmostApp = 'Finder';
		assert.strictEqual(appExclusion.isFrontmostExcluded(), false,
			'isFrontmostExcluded should return false when Finder is focused');

		console.log('Tool-exclusion integration tests passed (exclusion-logic only).');
		return;
	}

	// Test 1: With Finder focused, input tools should NOT be blocked
	mockFrontmostApp = 'Finder';
	const finderResult = await toolExecutor.execute('click_at', { x: 100, y: 100 });
	// The tool may fail for other reasons (no screen mapping, no native helper)
	// but the error should NOT be about exclusion
	if (!finderResult.ok) {
		assert.ok(
			!finderResult.result.includes('exclusion list'),
			'click_at should NOT be blocked when Finder is focused'
		);
	}

	// Test 2: With SuperRun focused, input tools SHOULD be blocked
	mockFrontmostApp = 'SuperRun';

	const inputTools = ['type_text', 'press_key', 'click_at', 'double_click', 'mouse_move', 'drag', 'scroll'];
	for (const tool of inputTools) {
		const result = await toolExecutor.execute(tool, { x: 100, y: 100, text: 'test', key: 'a' });
		assert.strictEqual(result.ok, false, `${tool} should be blocked when SuperRun is focused`);
		assert.ok(
			result.result.includes('exclusion list'),
			`${tool} blocking message should mention exclusion list`
		);
	}

	// Test 3: Non-input tools should NOT be blocked even with SuperRun focused
	mockFrontmostApp = 'SuperRun';
	const wsResult = await toolExecutor.execute('get_workspace', {});
	assert.strictEqual(wsResult.ok, true, 'get_workspace should work even when SuperRun is focused');

	// Test 4: After switching away from SuperRun, input tools work again
	mockFrontmostApp = 'Terminal';
	const termResult = await toolExecutor.execute('click_at', { x: 100, y: 100 });
	if (!termResult.ok) {
		assert.ok(
			!termResult.result.includes('exclusion list'),
			'click_at should NOT be blocked when Terminal is focused'
		);
	}

	console.log('Tool-exclusion integration tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
}).finally(() => {
	// Restore originals
	appExclusion.getFrontmostAppName = _originalGetFrontmostAppName;
	appExclusion.isFrontmostExcluded = _originalIsFrontmostExcluded;
});
