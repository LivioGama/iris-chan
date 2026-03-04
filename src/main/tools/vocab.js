const path = require('node:path');
const fs = require('node:fs');
const config = require('../../shared/config').default;

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

module.exports = { manage_vocabulary };
