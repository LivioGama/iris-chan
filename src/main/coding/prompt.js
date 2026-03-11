const fs = require('node:fs');
const path = require('node:path');

function buildCodingPrompt({ description, cwd, target = null } = {}) {
	let context = '';
	const claudeMdPath = path.join(cwd, 'CLAUDE.md');
	if (fs.existsSync(claudeMdPath)) {
		try {
			context += `Project instructions (CLAUDE.md):\n${fs.readFileSync(claudeMdPath, 'utf8').substring(0, 3000)}\n\n`;
		} catch {}
	}

	const pkgPath = path.join(cwd, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			context += `Project: ${pkg.name || 'unknown'} — ${pkg.description || ''}\n\n`;
		} catch {}
	}

	return [
		`Working directory: ${cwd}`,
		target ? `Target: ${target}` : '',
		context.trimEnd(),
		'Task:',
		String(description || '').trim(),
		'',
		'Instructions: Work autonomously. Edit files directly. Run lint/typecheck after changes. Do not ask questions — make reasonable decisions and proceed.',
	].filter(Boolean).join('\n');
}

module.exports = { buildCodingPrompt };
