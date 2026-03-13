const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

console.log('Running fix-project scientific metadata tests...');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
	if (request === '../workspace') {
		return { get: () => '/tmp/workspace' };
	}
	if (request === '../coding/runner') {
		return {
			startCodingTask() {
				return { completion: Promise.resolve({ ok: true, status: 'COMPLETED', summary: 'done' }) };
			},
		};
	}
	return originalLoad.apply(this, arguments);
};

const { fix_project } = require('../src/main/tools/fix-project');
Module._load = originalLoad;

(async () => {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-fix-project-meta-'));
	const tasksPath = path.join(repoDir, 'tasks.json');
	let observed = null;

	try {
		const result = await fix_project({
			description: 'Implement an autonomous scientific workflow in the coding loop and verify it with concrete test output.',
			target: 'workspace',
			_cwd: repoDir,
			_runSDK: (prompt, cwd, taskFile, taskId, scientificMetadata) => {
				observed = { prompt, cwd, taskFile, taskId, scientificMetadata };
			},
		});

		assert.strictEqual(result.ok, true, 'fix_project should start successfully');
		assert.ok(observed, 'fix_project should invoke the SDK runner');
		assert.strictEqual(observed.cwd, repoDir);
		assert.strictEqual(observed.taskFile, tasksPath);
		assert.ok(observed.scientificMetadata, 'fix_project should pass scientific metadata to the runner');
		assert.strictEqual(observed.scientificMetadata.workflow, 'ai_scientist_v1');

		const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		assert.strictEqual(data.tasks.length, 1);
		assert.strictEqual(data.tasks[0].workflow, 'ai_scientist_v1');
		assert.strictEqual(data.tasks[0].workflowStage, 'running');
		assert.strictEqual(data.tasks[0].autoVerify, true);
		assert.strictEqual(data.tasks[0].selfReview, true);
		assert.ok(data.tasks[0].objective, 'task should store a derived objective');
		assert.ok(data.tasks[0].scientificMetadata?.reproducibility?.considerVersionControl, 'task should persist reproducibility metadata');
		assert.match(result.result, /Workflow: hypothesis -> experiment -> verify -> self-review\./);
	} finally {
		fs.rmSync(repoDir, { recursive: true, force: true });
	}

	console.log('Fix-project scientific metadata tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
