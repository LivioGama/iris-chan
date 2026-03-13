const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

console.log('Running daily draft summary tests...');

async function main() {
	const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-daily-draft-summary-'));
	process.env.HOME = tempHome;
	const irisDir = path.join(tempHome, '.iris');
	await fs.mkdir(irisDir, { recursive: true });
	await fs.writeFile(path.join(irisDir, 'learning_log.json'), JSON.stringify({
		version: 1,
		updatedAt: '2026-03-14T00:00:00.000Z',
		events: [
			{
				classification: 'memory',
				guidanceText: 'Use visible labels before clicking.',
			},
			{
				classification: 'core-gap',
				userText: 'Stop asking what to do next after a self-fix.',
			},
			{
				classification: 'memory',
				guidanceText: 'Keep progress updates concrete.',
			},
		],
	}, null, 2), 'utf8');
	await fs.writeFile(path.join(irisDir, 'self_fix_issues.json'), JSON.stringify({
		version: 1,
		updatedAt: '2026-03-14T00:00:00.000Z',
		issues: [
			{
				issueSignature: 'issue-1',
				canonicalDescription: 'needs better autonomous continuation after self-fix',
				count: 3,
				status: 'pending',
			},
			{
				issueSignature: 'issue-2',
				canonicalDescription: 'resolved browser recall issue',
				count: 2,
				status: 'resolved',
			},
		],
	}, null, 2), 'utf8');

	const { buildDailyDraft } = require('../src/main/autonomy/daily-draft-summary');
	const draft = buildDailyDraft({ date: '2026-03-14' });

	assert.strictEqual(draft.title, 'Iris Daily Note — 2026-03-14');
	assert.match(draft.summary, /3 learning events, 1 active issues, 1 resolved issues/i);
	assert.match(draft.summary, /memory \(2\), core-gap \(1\)/i);
	assert.match(draft.summary, /needs better autonomous continuation after self-fix/i);
	assert.match(draft.html, /Recent guidance:/);
	assert.match(draft.html, /Use visible labels before clicking/i);

	console.log('Daily draft summary tests passed.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
