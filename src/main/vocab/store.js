// Vocabulary CRUD: load, save, add, remove, promote, stats
const fs = require('fs');
const path = require('path');
const config = require('../../shared/config').default;
const log = require('../logger');

const vocabPath = path.join(config.paths.irisDir, 'vocabulary.json');
const hotVocabPath = path.join(config.paths.irisDir, 'vocabulary-hot.json');
const vocabStatsPath = path.join(config.paths.irisDir, 'vocabulary-stats.json');

// Ensure ~/.iris/ exists
try { fs.mkdirSync(config.paths.irisDir, { recursive: true }); } catch { }

// Sync corrections & core from source vocabulary into ~/.iris/vocabulary.json
function syncFromSource() {
	try {
		const src = JSON.parse(fs.readFileSync(config.paths.srcVocab, 'utf-8'));
		let dest;
		try { dest = JSON.parse(fs.readFileSync(vocabPath, 'utf-8')); } catch { dest = { terms: [] }; }
		let changed = false;
		if (src.corrections && !dest.corrections) { dest.corrections = src.corrections; changed = true; }
		if (src.core && !dest.core) { dest.core = src.core; changed = true; }
		if (changed) fs.writeFileSync(vocabPath, JSON.stringify(dest, null, '\t') + '\n', 'utf-8');
	} catch { }
}

function loadTerms() {
	try {
		return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).terms || [];
	} catch { return []; }
}

function loadCore() {
	try {
		return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).core || [];
	} catch { return []; }
}

function loadCorrections() {
	try {
		return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).corrections || {};
	} catch { return {}; }
}

function loadHot() {
	try { return JSON.parse(fs.readFileSync(hotVocabPath, 'utf-8')); } catch { return {}; }
}

function saveHot(hot) {
	try { fs.writeFileSync(hotVocabPath, JSON.stringify(hot, null, '\t') + '\n', 'utf-8'); } catch { }
}

function loadStats() {
	try { return JSON.parse(fs.readFileSync(vocabStatsPath, 'utf-8')); } catch { return {}; }
}

function trackTerms(terms) {
	let stats = loadStats();
	const now = new Date().toISOString();
	for (const term of terms) {
		if (!stats[term]) stats[term] = { count: 0, lastUsed: null };
		stats[term].count++;
		stats[term].lastUsed = now;
	}
	try { fs.writeFileSync(vocabStatsPath, JSON.stringify(stats, null, '\t') + '\n', 'utf-8'); } catch { }
}

function addCorrection(wrong, right) {
	try {
		const vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
		if (!vocab.corrections) vocab.corrections = {};
		if (!vocab.corrections[wrong]) {
			vocab.corrections[wrong] = right;
			fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
			log.info('Vocab', `Saved correction: "${wrong}" → "${right}"`);
		}
	} catch (err) {
		log.error('Vocab', 'Failed to save correction:', err.message);
	}
}

function addHotTerm(term) {
	const allTerms = loadTerms();
	if (allTerms.some(t => t.toLowerCase() === term.toLowerCase())) return false;

	const hot = loadHot();
	const now = new Date().toISOString();
	if (hot[term]) {
		hot[term].count++;
		hot[term].lastSeen = now;
	} else {
		hot[term] = { count: 1, firstSeen: now, lastSeen: now };
		log.info('VocabHot', 'New hot term:', term);
	}
	saveHot(hot);
	return true;
}

function promoteAndCleanHot() {
	const hot = loadHot();
	const now = Date.now();
	let vocab;
	try { vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8')); } catch { vocab = { terms: [] }; }
	let changed = false;
	let vocabChanged = false;

	for (const [term, data] of Object.entries(hot)) {
		const lastSeen = new Date(data.lastSeen).getTime();
		const age = now - lastSeen;

		if (data.count >= config.vocab.hotPromoteCount) {
			if (!vocab.terms.includes(term)) {
				vocab.terms.push(term);
				vocabChanged = true;
				log.info('VocabHot', `Promoted to permanent: ${term} (${data.count}x)`);
			}
			delete hot[term];
			changed = true;
		} else if (age > config.vocab.hotExpireMs) {
			log.info('VocabHot', 'Expired:', term);
			delete hot[term];
			changed = true;
		}
	}

	if (changed) saveHot(hot);
	if (vocabChanged) fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
}

module.exports = {
	syncFromSource,
	loadTerms,
	loadCore,
	loadCorrections,
	loadHot,
	loadStats,
	trackTerms,
	addCorrection,
	addHotTerm,
	promoteAndCleanHot,
};
