// Tool handlers: self_fix, propose_reply, manage_vocabulary, get_mouse_position
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runHelper } = require('../native-helper');
const config = require('../../shared/config');

async function get_mouse_position() {
	return runHelper({ action: 'get_mouse_position' });
}

async function propose_reply(args) {
	return runHelper({ action: 'type_text', text: args.reply || '' });
}

async function manage_vocabulary(args) {
	const action = args.action || 'list';
	const vocabPath = path.join(config.paths.irisDir, 'vocabulary.json');
	let vocab;
	try {
		vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
	} catch {
		vocab = { terms: [] };
	}

	if (action === 'add' && args.term) {
		const term = args.term.trim();
		if (!vocab.terms.includes(term)) {
			vocab.terms.push(term);
			fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
			return { ok: true, result: `Added "${term}". Applied live.` };
		}
		return { ok: true, result: `"${term}" already in vocabulary.` };
	} else if (action === 'remove' && args.term) {
		const idx = vocab.terms.indexOf(args.term.trim());
		if (idx !== -1) {
			vocab.terms.splice(idx, 1);
			fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
			return { ok: true, result: `Removed "${args.term}". Applied live.` };
		}
		return { ok: true, result: `"${args.term}" not found in vocabulary.` };
	} else if (action === 'stats') {
		const statsPath = path.join(config.paths.irisDir, 'vocabulary-stats.json');
		let stats;
		try { stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')); } catch { stats = {}; }
		const entries = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
		if (entries.length === 0) return { ok: true, result: 'No vocabulary usage recorded yet.' };
		const top = entries.slice(0, 30).map(([term, s]) => `${term}: ${s.count}x (last: ${s.lastUsed?.slice(0, 10) || '?'})`).join('\n');
		return { ok: true, result: `Vocabulary usage (${entries.length} terms used):\n${top}` };
	} else {
		return { ok: true, result: `Vocabulary (${vocab.terms.length} terms): ${vocab.terms.join(', ') || '(empty)'}` };
	}
}

async function self_fix(args) {
	const desc = args.description || '';
	const files = args.files_to_touch || '';
	if (!desc) return { ok: false, result: 'No description provided' };

	const projectRoot = path.join(__dirname, '..', '..', '..');
	const fileList = [
		'src/main/index.js', 'src/renderer/index.html', 'src/renderer/voice/pipeline.js',
		'src/renderer/gemini/client.js', 'src/renderer/voice/capture.js',
		'src/renderer/voice/playback.js', 'src/main/tools/index.js',
		'src/main/screen-capture.js', 'helpers/iris-helper.swift',
	];

	const fileInfo = fileList.map(f => {
		try {
			const stat = fs.statSync(path.join(projectRoot, f));
			return `  - ${f} (${stat.size} bytes)`;
		} catch { return `  - ${f} (not found)`; }
	}).join('\n');

	const prompt = [
		`[IRIS SELF-FIX REQUEST]`,
		``,
		`Iris (the AI assistant whose code is in this directory) is asking you to modify her own source code.`,
		``,
		`## What to do`,
		desc,
		``,
		files ? `## Files likely involved\n${files}\n` : '',
		`## Project files`,
		fileInfo,
		``,
		`## Rules`,
		`- Edit files in place, don't recreate them`,
		`- Don't touch audio playback scheduling unless explicitly asked`,
		`- Tool module changes (src/main/tools/) hot-reload automatically — no restart needed`,
		`- For other file changes, restart the app: pkill -f "Electron"; sleep 1; npx electron . &`,
		`- Keep changes minimal and focused`,
	].filter(Boolean).join('\n');

	await new Promise((resolve) => {
		exec(`osascript -e 'tell application "Warp" to activate'`, { timeout: 3000 }, resolve);
	});
	await new Promise(r => setTimeout(r, 500));

	await runHelper({ action: 'type_text', text: prompt });
	await new Promise(r => setTimeout(r, 300));
	await runHelper({ action: 'press_key', key: 'return' });

	return { ok: true, result: 'Self-fix prompt submitted to Claude Code' };
}

module.exports = { self_fix, propose_reply, manage_vocabulary, get_mouse_position };
