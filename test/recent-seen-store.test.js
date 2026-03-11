const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
	const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/vocab/recent-seen-store.js')).href;
	const store = await import(moduleUrl);

	console.log('Running recent seen store tests...');

	store.clearRecentSeenTerms();
	store.configureRecentSeenStore({
		ttlMs: 30000,
		maxTerms: 24,
		minConfidence: 0.6,
		rewriteDistance: 3,
		persistEnabled: true,
	});
	store.setRecentSeenKnownTerms({
		vocabTerms: ['Claude Code'],
		hotTerms: [],
		coreTerms: [],
		corrections: { 'cloud code': 'Claude Code' },
	});

	store.addRecentSeenTerms([{ term: 'Discord', confidence: 0.91 }], { now: 1000 });
	let rewrite = store.findRecentSeenRewrite('discord', 1500);
	assert(rewrite, 'expected recent seen rewrite for Discord');
	assert.strictEqual(rewrite.text, 'Discord', 'should rewrite the transcript to the recent seen term');
	assert.strictEqual(rewrite.shouldPersist, true, 'recent seen rewrite should request persistence when enabled');

	store.clearRecentSeenTerms();
	store.setRecentSeenKnownTerms({
		vocabTerms: [],
		hotTerms: [],
		coreTerms: [],
		corrections: {},
	});
	store.addRecentSeenTerms([
		{ term: 'Discord', confidence: 0.9 },
		{ term: 'Discords', confidence: 0.9 },
	], { now: 2000 });
	rewrite = store.findRecentSeenRewrite('discor', 2100);
	assert.strictEqual(rewrite, null, 'ambiguous candidates should not rewrite the transcript');

	store.clearRecentSeenTerms();
	store.addRecentSeenTerms([{ term: 'Discord', confidence: 0.95 }], { now: 3000 });
	rewrite = store.findRecentSeenRewrite('discord', 34050);
	assert.strictEqual(rewrite, null, 'expired recent seen terms should not be used');

	store.clearRecentSeenTerms();
	store.setRecentSeenKnownTerms({
		vocabTerms: ['Claude Code'],
		hotTerms: [],
		coreTerms: [],
		corrections: {},
	});
	const added = store.addRecentSeenTerms([
		{ term: 'Claude Code', confidence: 0.98 },
		{ term: 'Discord', confidence: 0.98 },
		{ term: 'Settings', confidence: 0.98 },
	], { now: 5000 });
	assert.deepStrictEqual(
		added.map((item) => item.term),
		['Discord'],
		'should keep unique visible terms and skip known/common ones'
	);

	console.log('Recent seen store tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
