const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const { shouldRecompileHelper, parseHelperExecResult } = require('../src/main/native-helper');

console.log('Running native helper recompilation tests...');

const helperSource = fs.readFileSync(path.join(process.cwd(), 'helpers', 'iris-helper.swift'), 'utf8');
assert.ok(helperSource.includes('AXIsProcessTrustedWithOptions'), 'helper should prompt for Accessibility permission before interaction');
assert.ok(helperSource.includes('requireCursor(at:'), 'helper should verify cursor movement for mouse actions');
assert.ok(!helperSource.includes('tell application "System Events" to key code'), 'press_key should no longer rely on AppleScript key events');
assert.ok(helperSource.includes('--monitor-input'), 'helper should support persistent user-input monitoring mode');
assert.ok(helperSource.includes('ax_snapshot'), 'helper should expose accessibility snapshots');
assert.ok(helperSource.includes('ax_press'), 'helper should expose semantic accessibility presses');
assert.ok(helperSource.includes('eventSourceUserData'), 'helper should tag synthetic events so the input monitor can ignore them');

assert.deepStrictEqual(
	parseHelperExecResult(
		new Error('Command failed'),
		'{"ok":false,"result":"Accessibility permission is required"}\n',
		''
	),
	{ ok: false, result: 'Accessibility permission is required' },
	'nonzero helper exits should preserve structured stdout failures'
);

assert.deepStrictEqual(
	parseHelperExecResult(
		null,
		'{"ok":true,"result":"Pressed return"}\n',
		''
	),
	{ ok: true, result: 'Pressed return' },
	'successful JSON stdout should still parse normally'
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-native-helper-'));
const helperSrc = path.join(tmpRoot, 'iris-helper.swift');
const helperBin = path.join(tmpRoot, 'iris-helper');

try {
	fs.writeFileSync(helperSrc, '// helper source\n');

	assert.strictEqual(
		shouldRecompileHelper({ helperSrc, helperBin }),
		true,
		'missing binaries should trigger compilation'
	);

	fs.writeFileSync(helperBin, 'binary');
	fs.utimesSync(helperSrc, new Date('2026-03-10T10:00:00Z'), new Date('2026-03-10T10:00:00Z'));
	fs.utimesSync(helperBin, new Date('2026-03-10T09:00:00Z'), new Date('2026-03-10T09:00:00Z'));

	assert.strictEqual(
		shouldRecompileHelper({ helperSrc, helperBin }),
		true,
		'older binaries should be recompiled'
	);

	fs.utimesSync(helperBin, new Date('2026-03-10T11:00:00Z'), new Date('2026-03-10T11:00:00Z'));

	assert.strictEqual(
		shouldRecompileHelper({ helperSrc, helperBin }),
		false,
		'up-to-date binaries should be reused'
	);
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('Native helper recompilation tests passed.');
