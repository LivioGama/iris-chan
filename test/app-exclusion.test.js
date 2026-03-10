const assert = require('node:assert');

// ── Test the app-exclusion module (pure-logic paths, no osascript needed) ────
console.log('Running app-exclusion tests...');

const {
	isAppExcluded,
	isInputTool,
	addExcludedApp,
	removeExcludedApp,
	getExcludedApps,
} = require('../src/main/app-exclusion');

// 1. SuperRun is excluded by default
assert.strictEqual(isAppExcluded('SuperRun'), true, 'SuperRun should be excluded by default');

// 2. Arbitrary apps are NOT excluded
assert.strictEqual(isAppExcluded('Finder'), false, 'Finder should not be excluded');
assert.strictEqual(isAppExcluded('Safari'), false, 'Safari should not be excluded');
assert.strictEqual(isAppExcluded(''), false, 'Empty string should not be excluded');

// 3. Input tools are classified correctly
const expectedInputTools = [
	'type_text', 'press_key', 'click_at', 'double_click',
	'mouse_move', 'drag', 'scroll', 'activate_app',
];
for (const tool of expectedInputTools) {
	assert.strictEqual(isInputTool(tool), true, `"${tool}" should be classified as an input tool`);
}

// 4. Non-input tools are NOT classified as input
const nonInputTools = [
	'open_app', 'get_frontmost_app', 'window_manage', 'clipboard_read',
	'web_search', 'run_terminal_command', 'set_workspace', 'add_task',
	'notify', 'set_volume',
];
for (const tool of nonInputTools) {
	assert.strictEqual(isInputTool(tool), false, `"${tool}" should NOT be classified as an input tool`);
}

// 5. addExcludedApp / removeExcludedApp
addExcludedApp('TestApp');
assert.strictEqual(isAppExcluded('TestApp'), true, 'TestApp should be excluded after addExcludedApp');
assert.ok(getExcludedApps().includes('TestApp'), 'getExcludedApps should contain TestApp');

removeExcludedApp('TestApp');
assert.strictEqual(isAppExcluded('TestApp'), false, 'TestApp should not be excluded after removeExcludedApp');

// 6. SuperRun remains excluded after adding/removing other apps
assert.strictEqual(isAppExcluded('SuperRun'), true, 'SuperRun should still be excluded');

// 7. getExcludedApps returns array
const list = getExcludedApps();
assert.ok(Array.isArray(list), 'getExcludedApps should return an array');
assert.ok(list.includes('SuperRun'), 'getExcludedApps should include SuperRun');

console.log('App-exclusion tests passed.');
