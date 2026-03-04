const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SWIFT_SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'hover-detect.swift');
const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'Makefile', 'CLAUDE.md'];

function findProjectRoot(startPath) {
	let dir = startPath;
	// If startPath is a file, start from its directory
	try {
		if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
	} catch {}

	while (dir !== path.dirname(dir)) {
		for (const marker of PROJECT_MARKERS) {
			if (fs.existsSync(path.join(dir, marker))) return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

function detectHoveredPath() {
	return new Promise((resolve) => {
		execFile('swift', [SWIFT_SCRIPT], { timeout: 5000 }, (err, stdout, stderr) => {
			if (err) {
				return resolve({ ok: false, error: err.message });
			}

			const lines = stdout.split('\n');
			let detectedPath = null;
			let app = 'Unknown';

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('App:')) app = trimmed.slice(4).trim();
				if (trimmed.startsWith('Path:')) detectedPath = trimmed.slice(5).trim();
			}

			if (!detectedPath) {
				return resolve({ ok: false, error: 'No path detected from hover', app });
			}

			const projectPath = findProjectRoot(detectedPath);
			if (!projectPath) {
				return resolve({ ok: false, error: `No project root found from ${detectedPath}`, app });
			}

			resolve({ ok: true, projectPath, app });
		});
	});
}

module.exports = { detectHoveredPath, findProjectRoot };
