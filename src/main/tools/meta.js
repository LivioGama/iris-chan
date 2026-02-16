// Tool handlers: self_fix, propose_reply, manage_vocabulary, get_mouse_position
const { exec } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
	const description = args.description || '';
	if (!description) return { ok: false, result: 'No description provided' };

	try {
		const fs = require('node:fs');
		// Use process.cwd() to match where kanban expects tasks.json
		const tasksPath = path.join(process.cwd(), 'tasks.json');
		
		// Load or create tasks.json
		let data = { version: 1, updatedAt: new Date().toISOString(), tasks: [] };
		if (fs.existsSync(tasksPath)) {
			data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		}

		// Get next task ID
		let maxId = 0;
		for (const task of data.tasks || []) {
			if (task.id?.startsWith('task-')) {
				const num = Number.parseInt(task.id.split('-')[1]);
				if (!Number.isNaN(num)) maxId = Math.max(maxId, num);
			}
		}
		const nextId = maxId + 1;
		const taskId = `task-${nextId}`;

		// Create task
		const newTask = {
			id: taskId,
			title: description.split('\n')[0].substring(0, 80),
			description: description,
			status: 'PENDING',
			order: (data.tasks?.length || 0) + 1,
			files: [],
			action: '',
			verify: '',
			done: '',
			dependsOn: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		data.tasks = data.tasks || [];
		data.tasks.push(newTask);
		data.updatedAt = new Date().toISOString();

		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf8');

		return { 
			ok: true, 
			result: `✓ Created ${taskId}: ${newTask.title}\n\nView in kanban: Ctrl+K` 
		};
	} catch (err) {
		return { ok: false, result: `Self-fix error: ${err.message}` };
	}
}

module.exports = { self_fix, propose_reply, manage_vocabulary, get_mouse_position };
