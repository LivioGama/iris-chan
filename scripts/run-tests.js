#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, 'test');
const TEST_FILE_PATTERN = /\.test\.(?:js|cjs|mjs)$/;

function collectTestFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTestFiles(fullPath));
			continue;
		}

		if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
			files.push(fullPath);
		}
	}

	return files;
}

if (!fs.existsSync(TEST_DIR)) {
	console.error('Test directory not found:', TEST_DIR);
	process.exit(1);
}

const testFiles = collectTestFiles(TEST_DIR).sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
	console.error('No test files found under test/.');
	process.exit(1);
}

console.log(`Discovered ${testFiles.length} test files.`);

for (const file of testFiles) {
	const relativeFile = path.relative(ROOT_DIR, file);
	console.log(`\n>>> ${relativeFile}`);

	const result = spawnSync(process.execPath, [file], {
		cwd: ROOT_DIR,
		stdio: 'inherit',
	});

	if (result.error) {
		console.error(`Failed to execute ${relativeFile}:`, result.error.message);
		process.exit(1);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}

	if (result.signal) {
		console.error(`${relativeFile} terminated with signal ${result.signal}`);
		process.exit(1);
	}
}
