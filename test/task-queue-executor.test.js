const assert = require('node:assert');
const Module = require('node:module');

console.log('Running task queue executor tests...');

const originalLoad = Module._load;
let capturedArgs = null;

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../logger') {
		return { info() {}, error() {} };
	}
	if (request === '../coding/runner') {
		return {
			startCodingTask(args) {
				capturedArgs = args;
				if (typeof args.onLog === 'function') args.onLog('queued line');
				return {
					completion: Promise.resolve({
						ok: true,
						status: 'COMPLETED',
						summary: 'Task done',
					}),
				};
			},
		};
	}
	return originalLoad.apply(this, arguments);
};

const { executeTask } = require('../src/main/task-queue/executor');
Module._load = originalLoad;

(async () => {
	const observedLogs = [];
	const result = await executeTask('queue-1', 'Refactor code', '/tmp/project', (line) => observedLogs.push(line));

	assert.deepStrictEqual(result, { ok: true, status: 'COMPLETED', summary: 'Task done' }, 'executor should return the shared runner result');
	assert.ok(capturedArgs, 'executor should delegate to the shared runner');
	assert.strictEqual(capturedArgs.taskId, 'queue-1');
	assert.strictEqual(capturedArgs.prompt, 'Refactor code');
	assert.strictEqual(capturedArgs.cwd, '/tmp/project');
	assert.deepStrictEqual(observedLogs, ['queued line'], 'executor should forward log callbacks');

	console.log('Task queue executor tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
