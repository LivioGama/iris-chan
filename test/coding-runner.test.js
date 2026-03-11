const assert = require('node:assert');
const Module = require('node:module');

console.log('Running coding runner tests...');

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../logger') {
		return { info() {}, error() {} };
	}
	if (request === '../windows/avatar-window') {
		return { get: () => null };
	}
	if (request === '../windows/kanban-window') {
		return { get: () => null };
	}
	return originalLoad.apply(this, arguments);
};

const { startCodingTask } = require('../src/main/coding/runner');
Module._load = originalLoad;

(async () => {
	const streamedLogs = [];
	const successHandle = startCodingTask({
		taskId: 'task-success',
		prompt: 'Implement thing',
		cwd: '/tmp/project',
		env: { CODING_PROVIDER: 'codex' },
		onLog: (line) => streamedLogs.push(line),
		adapterFactory: () => ({
			name: 'codex',
			async run({ prompt, cwd, onLog }) {
				assert.strictEqual(prompt, 'Implement thing');
				assert.strictEqual(cwd, '/tmp/project');
				onLog('first line');
				onLog('[tool: Bash] npm test');
				return { status: 'COMPLETED', summary: 'All done' };
			},
		}),
	});

	const successResult = await successHandle.completion;
	assert.strictEqual(successResult.ok, true, 'successful run should resolve ok');
	assert.strictEqual(successResult.provider, 'codex', 'provider should come from env');
	assert.strictEqual(successResult.status, 'COMPLETED');
	assert.strictEqual(successResult.summary, 'All done');
	assert.deepStrictEqual(
		streamedLogs,
		['first line', '[tool: Bash] npm test', '✅ COMPLETED: All done'],
		'runner should preserve log lines and append a normalized completion line'
	);

	const failureHandle = startCodingTask({
		taskId: 'task-failure',
		prompt: 'Break thing',
		cwd: '/tmp/project',
		onLog: () => {},
		adapterFactory: () => ({
			name: 'claude',
			async run() {
				throw new Error('boom');
			},
		}),
	});

	const failureResult = await failureHandle.completion;
	assert.strictEqual(failureResult.ok, false, 'failed run should resolve as failed');
	assert.strictEqual(failureResult.status, 'FAILED');
	assert.strictEqual(failureResult.summary, 'Error: boom');

	console.log('Coding runner tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
