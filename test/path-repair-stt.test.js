const assert = require('node:assert');

console.log('Running STT path repair tests...');

// Import the ESM module via dynamic import
async function run() {
	const { repairMangledPaths } = await import('../src/renderer/voice/transcription-policy.js');

	// Basic /tmp path reconstruction
	assert.strictEqual(
		repairMangledPaths('Create a file at temp iris test output dot txt with the content hello'),
		'Create a file at /tmp/iris-test-output.txt with the content hello',
	);

	// "slash temp" variant
	assert.strictEqual(
		repairMangledPaths('write to slash temp iris test output dot txt'),
		'write to /tmp/iris-test-output.txt',
	);

	// Desktop path
	assert.strictEqual(
		repairMangledPaths('save it to desktop my notes dot md'),
		'save it to ~/Desktop/my-notes.md',
	);

	// Downloads with JSON extension
	assert.strictEqual(
		repairMangledPaths('read from downloads data export dot JSON'),
		'read from ~/Downloads/data-export.json',
	);

	// With "dash" in filename
	assert.strictEqual(
		repairMangledPaths('write to temp weather dash summary dot txt'),
		'write to /tmp/weather-summary.txt',
	);

	// With "underscore" in filename
	assert.strictEqual(
		repairMangledPaths('save temp my underscore file dot log'),
		'save /tmp/my_file.log',
	);

	// No path — should pass through unchanged
	assert.strictEqual(
		repairMangledPaths('tell me a joke'),
		'tell me a joke',
	);

	// Actual path already present — should not be corrupted
	assert.strictEqual(
		repairMangledPaths('write to /tmp/test.txt'),
		'write to /tmp/test.txt',
	);

	// Multiple extensions
	assert.strictEqual(
		repairMangledPaths('read temp config dot json and write temp output dot csv'),
		'read /tmp/config.json and write /tmp/output.csv',
	);

	// T24 case: weather summary
	assert.strictEqual(
		repairMangledPaths('write a summary to temp weather summary dot txt'),
		'write a summary to /tmp/weather-summary.txt',
	);

	console.log('All STT path repair tests passed!');
}

run().catch(err => {
	console.error('FAIL:', err.message);
	process.exit(1);
});
