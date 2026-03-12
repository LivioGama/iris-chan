const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

require('ts-node').register({ transpileOnly: true });

console.log('Running self_fix iris path tests...');

function formatHomeRelativePath(targetPath) {
	const homeDir = os.homedir();
	const relativePath = path.relative(homeDir, targetPath);
	if (!relativePath || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
		return relativePath ? `~/${relativePath.split(path.sep).join('/')}` : '~';
	}
	return targetPath;
}

async function main() {
	const repoRoot = process.cwd();
	const tasksPath = path.join(repoRoot, 'tasks.json');
	const hadTasksFile = fs.existsSync(tasksPath);
	const originalTasks = hadTasksFile ? fs.readFileSync(tasksPath, 'utf8') : null;
	const originalWindow = global.window;
	const expectedPromptPath = formatHomeRelativePath(repoRoot);

	try {
		if (hadTasksFile) fs.rmSync(tasksPath, { force: true });

		const { self_fix } = require('../src/main/tools/self-fix');

		let observedRun = null;
		const result = await self_fix({
			description: 'Fix the hard-coded self-fix path by resolving the Iris repository from the running source tree, writing tasks.json in that repo, and keeping the system prompt aligned with the same home-relative location.',
			_runSDK: (prompt, cwd, taskFile, taskId) => {
				observedRun = { prompt, cwd, taskFile, taskId };
			},
		});

		assert.strictEqual(result.ok, true, 'self_fix should start successfully for the Iris repo');
		assert.ok(observedRun, 'self_fix should invoke fix_project with the stubbed SDK runner');
		assert.strictEqual(observedRun.cwd, repoRoot, 'self_fix should target the running iris-chan repository');
		assert.strictEqual(observedRun.taskFile, tasksPath, 'self_fix should create tasks.json in the running repository');
		assert.ok(observedRun.prompt.includes(`Working directory: ${repoRoot}`), 'SDK prompt should use the running repository path');

		assert.ok(fs.existsSync(tasksPath), 'self_fix should create tasks.json at the resolved Iris repo path');
		const taskData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		assert.strictEqual(taskData.tasks.length, 1, 'self_fix should create exactly one task');
		assert.strictEqual(taskData.tasks[0].status, 'running', 'self_fix task should start running immediately');
		assert.strictEqual(taskData.tasks[0].origin, 'self_fix', 'self_fix task should be tagged with its origin');
		assert.strictEqual(taskData.tasks[0].launchMode, 'immediate', 'self_fix task should use the immediate launch mode');
		assert.strictEqual(taskData.tasks[0].resumable, true, 'self_fix task should be marked resumable');

		global.window = { irisPaths: { sourceDirDisplay: expectedPromptPath } };
		const systemPromptModuleUrl = pathToFileURL(path.join(repoRoot, 'src/renderer/gemini/system-prompt.js')).href;
		const { buildSystemInstruction } = await import(systemPromptModuleUrl);
		const systemPrompt = buildSystemInstruction();

		assert.ok(
			systemPrompt.includes(`Your own source code lives at ${expectedPromptPath}.`),
			'system prompt should describe the live Iris repo using a home-relative path'
		);
		assert.ok(
			!systemPrompt.includes('~/Documents/iris-chan'),
			'system prompt should no longer mention the old hard-coded Documents path'
		);
	} finally {
		if (hadTasksFile) {
			fs.writeFileSync(tasksPath, originalTasks, 'utf8');
		} else {
			fs.rmSync(tasksPath, { force: true });
		}

		if (originalWindow === undefined) {
			delete global.window;
		} else {
			global.window = originalWindow;
		}
	}

	console.log('self_fix iris path tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
