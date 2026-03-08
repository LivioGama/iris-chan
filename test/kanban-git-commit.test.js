const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

require('ts-node').register({ transpileOnly: true });

console.log('Running kanban git commit tests...');

const handlers = new Map();
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
	if (request === 'electron') {
		return {
			ipcMain: {
				handle(channel, handler) {
					handlers.set(channel, handler);
				},
			},
		};
	}
	if (request === '../windows/kanban-window') {
		return { get: () => null };
	}
	if (request === '../logger') {
		return { info() {}, warn() {}, error() {} };
	}
	if (request === '../convex-store') {
		return { saveTurn: async () => {} };
	}
	return originalLoad.apply(this, arguments);
};

const kanbanController = require('../src/main/controllers/kanbanController');
kanbanController.register();
Module._load = originalLoad;

const gitCommit = handlers.get('git-commit');
assert.ok(gitCommit, 'git-commit IPC handler should be registered');

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setupRepo() {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-kanban-git-'));
	git(repoDir, ['init', '-q']);
	git(repoDir, ['config', 'user.email', 'kanban@example.com']);
	git(repoDir, ['config', 'user.name', 'Kanban Test']);

	fs.writeFileSync(path.join(repoDir, 'README.md'), 'base\n');
	fs.writeFileSync(path.join(repoDir, 'spec.md'), 'base spec\n');
	git(repoDir, ['add', 'README.md', 'spec.md']);
	git(repoDir, ['commit', '-q', '-m', 'base']);

	return repoDir;
}

async function invokeGitCommit(repoDir, message) {
	const originalCwd = process.cwd();
	process.chdir(repoDir);
	try {
		return await gitCommit({}, message);
	} finally {
		process.chdir(originalCwd);
	}
}

function getHeadFiles(repoDir) {
	return git(repoDir, ['show', '--name-only', '--pretty=format:', 'HEAD'])
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.sort();
}

(async () => {
	const repoDir = setupRepo();
	const injectedPath = path.join(repoDir, 'SHOULD_NOT_EXIST');

	try {
		fs.writeFileSync(path.join(repoDir, 'spec.md'), 'updated spec\n');
		fs.writeFileSync(path.join(repoDir, 'tasks.json'), '{\n  "tasks": []\n}\n');
		fs.writeFileSync(path.join(repoDir, 'README.md'), 'unrelated change\n');

		const quotedMessage = 'bad "quote"; touch SHOULD_NOT_EXIST; echo "';
		const firstCommit = await invokeGitCommit(repoDir, quotedMessage);
		assert.deepStrictEqual(firstCommit, { ok: true, files: ['spec.md', 'tasks.json'] }, 'commit should succeed and report only kanban files');
		assert.strictEqual(git(repoDir, ['log', '-1', '--pretty=%B']), quotedMessage, 'commit message should be passed verbatim');
		assert.deepStrictEqual(getHeadFiles(repoDir), ['spec.md', 'tasks.json'], 'commit should exclude unrelated files');
		assert.strictEqual(fs.existsSync(injectedPath), false, 'commit message must not execute shell payloads');

		const firstStatus = git(repoDir, ['status', '--short']);
		assert.match(firstStatus, /README\.md/, 'unrelated worktree changes should remain after commit');
		assert.doesNotMatch(firstStatus, /spec\.md|tasks\.json/, 'kanban files should be clean after commit');

		fs.unlinkSync(path.join(repoDir, 'spec.md'));
		fs.appendFileSync(path.join(repoDir, 'README.md'), 'still unrelated\n');

		const secondCommit = await invokeGitCommit(repoDir, 'delete spec');
		assert.deepStrictEqual(secondCommit, { ok: true, files: ['spec.md'] }, 'tracked kanban file deletions should be staged without unrelated files');
		assert.strictEqual(git(repoDir, ['log', '-1', '--pretty=%B']), 'delete spec', 'deletion commit should keep the provided message');
		assert.deepStrictEqual(getHeadFiles(repoDir), ['spec.md'], 'deletion commit should contain only the deleted kanban file');

		const secondStatus = git(repoDir, ['status', '--short']);
		assert.match(secondStatus, /README\.md/, 'unrelated file should still be outside the second commit');
		assert.doesNotMatch(secondStatus, /spec\.md|tasks\.json/, 'kanban files should remain clean after deletion commit');
	} finally {
		fs.rmSync(repoDir, { recursive: true, force: true });
	}

	console.log('Kanban git commit tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
