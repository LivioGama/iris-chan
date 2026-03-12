const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

console.log('Running fix-project resume tests...');

const originalLoad = Module._load;
const observedRuns = [];

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../workspace') {
		return { get: () => '/tmp/workspace' };
	}
	if (request === '../coding/prompt') {
		return { buildCodingPrompt: ({ description, cwd }) => `PROMPT:${cwd}:${description}` };
	}
	if (request === '../coding/runner') {
		return {
			startCodingTask(args) {
				observedRuns.push(args);
				return { completion: Promise.resolve({ ok: true, status: 'COMPLETED', summary: 'done' }) };
			},
		};
	}
	return originalLoad.apply(this, arguments);
};

const { resumeImmediateTasks } = require('../src/main/tools/fix-project');
Module._load = originalLoad;

(async () => {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-resume-'));
	const tasksPath = path.join(repoDir, 'tasks.json');

	try {
		fs.writeFileSync(tasksPath, JSON.stringify({
			version: 1,
			tasks: [
				{
					id: 'task-1',
					title: 'Resume me',
					description: 'Continue the interrupted task',
					status: 'running',
					launchMode: 'immediate',
					resumable: true,
					logs: 'Existing log',
					prompt: 'PROMPT:/tmp/project:Continue the interrupted task',
				},
				{
					id: 'task-2',
					title: 'Leave me queued',
					description: 'Queued task',
					status: 'queued',
					launchMode: 'queued',
					resumable: true,
				},
			],
		}, null, 2));

		const result = resumeImmediateTasks({ cwd: repoDir });
		assert.deepStrictEqual(result, { ok: true, resumed: 1 }, 'resume should relaunch only interrupted immediate tasks');
		assert.strictEqual(observedRuns.length, 1, 'resume should restart one coding task');
		assert.strictEqual(observedRuns[0].taskId, 'task-1');

		const updated = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		assert.strictEqual(updated.tasks[0].status, 'resuming', 'interrupted task should move to resuming');
		assert.strictEqual(updated.tasks[0].resumeCount, 1, 'resume count should increment');
		assert.match(updated.tasks[0].logs, /Resuming after app restart/, 'resume marker should be appended to logs');
		assert.strictEqual(updated.tasks[1].status, 'queued', 'queued tasks should not be touched by immediate-task recovery');
	} finally {
		fs.rmSync(repoDir, { recursive: true, force: true });
	}

	console.log('Fix-project resume tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
