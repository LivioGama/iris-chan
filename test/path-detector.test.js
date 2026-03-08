const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectHoveredPath, findProjectRoot } = require('../src/main/task-queue/path-detector');

console.log('Running task queue path detector tests...');

function writeExecutable(filePath, content) {
	fs.writeFileSync(filePath, content, { mode: 0o755 });
}

async function main() {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-path-detector-'));
	const binDir = path.join(tempRoot, 'bin');
	const projectDir = path.join(tempRoot, 'demo-project');
	const nestedDir = path.join(projectDir, 'src');
	const nestedFile = path.join(nestedDir, 'index.ts');
	const fakeSwift = path.join(binDir, 'swift');
	const hoverScriptPath = path.join(__dirname, '..', 'scripts', 'hover-detect.swift');
	const originalPath = process.env.PATH || '';

	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(nestedDir, { recursive: true });
	fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"demo-project"}\n');
	fs.writeFileSync(nestedFile, 'export const ok = true;\n');

	try {
		assert.strictEqual(findProjectRoot(nestedFile), projectDir, 'findProjectRoot should walk up from files');

		writeExecutable(fakeSwift, `#!/bin/sh
if [ "$1" != "${hoverScriptPath}" ]; then
  echo "Error: unexpected script path $1"
  exit 1
fi
printf 'App: Finder\nPath: ${nestedFile}\n'
`);
		process.env.PATH = `${binDir}:${originalPath}`;

		const success = await detectHoveredPath();
		assert.deepStrictEqual(success, {
			ok: true,
			projectPath: projectDir,
			app: 'Finder',
		}, 'detectHoveredPath should parse script output and resolve the project root');

		writeExecutable(fakeSwift, `#!/bin/sh
printf 'App: Cursor\nError: Accessibility permission not granted for hover detection\n'
`);

		const failure = await detectHoveredPath();
		assert.strictEqual(failure.ok, false, 'script errors should surface as failed detections');
		assert.strictEqual(failure.app, 'Cursor', 'app name should still be parsed on script errors');
		assert.match(failure.error, /Accessibility permission not granted/, 'script error should be preserved');
	} finally {
		process.env.PATH = originalPath;
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}

	console.log('Task queue path detector tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
