const assert = require('node:assert');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

console.log('Running daily loop local date tests...');

function installMockDate(isoString) {
	const fixedTime = new Date(isoString).getTime();
	const RealDate = Date;

	class MockDate extends RealDate {
		constructor(...args) {
			if (args.length === 0) {
				super(fixedTime);
				return;
			}
			super(...args);
		}

		static now() {
			return fixedTime;
		}

		static parse(value) {
			return RealDate.parse(value);
		}

		static UTC(...args) {
			return RealDate.UTC(...args);
		}
	}

	global.Date = MockDate;
	return () => {
		global.Date = RealDate;
	};
}

async function main() {
	// Force a timezone ahead of UTC so 2026-03-07T18:30Z rolls to 2026-03-08 local
	process.env.TZ = 'Asia/Kathmandu';
	const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-daily-loop-'));
	process.env.HOME = tempHome;

	const { DailyLoop, LOOP_STATE_PATH } = require('../src/main/autonomy/daily-loop');

	const fixedNow = '2026-03-07T18:30:00.000Z';
	const utcKey = new Date(fixedNow).toISOString().slice(0, 10);
	const ghostDraftCalls = [];
	const convexCalls = [];

	const restoreDate = installMockDate(fixedNow);
	try {
		const irisDir = path.join(tempHome, '.iris');
		fsSync.mkdirSync(irisDir, { recursive: true });
		await fs.writeFile(path.join(irisDir, 'learning_log.json'), JSON.stringify({
			version: 1,
			updatedAt: fixedNow,
			events: [
				{
					classification: 'memory',
					guidanceText: 'Remember the default browser instead of asking again.',
					userText: 'use the actual default browser',
				},
			],
		}, null, 2));
		await fs.writeFile(path.join(irisDir, 'self_fix_issues.json'), JSON.stringify({
			version: 1,
			updatedAt: fixedNow,
			issues: [
				{
					issueSignature: 'core_gap:browser',
					description: 'Browser recall is still brittle',
					canonicalDescription: 'browser recall still brittle',
					count: 2,
					status: 'pending',
				},
			],
		}, null, 2));

		const loop = new DailyLoop({
			taskEngine: { hasHighPriorityRunning: () => false },
			createGhostDraft: async (draft) => {
				ghostDraftCalls.push(draft);
				return { ok: true, draft: { id: 'ghost-1' } };
			},
			convexClient: {
				saveDailyDraft: async (record, key) => {
					convexCalls.push({ record, key });
					return { ok: true };
				},
			},
			eventBus: { emitEvent: () => {} },
		});

		await loop.tick();
		await new Promise((resolve) => setTimeout(resolve, 350));
		await loop.tick();
	} finally {
		restoreDate();
	}

	const state = JSON.parse(await fs.readFile(LOOP_STATE_PATH, 'utf-8'));

	console.log(
		[
			'Kathmandu rollover evidence:',
			`fixed_now=${fixedNow}`,
			`utc_key=${utcKey}`,
			`draft_title=${ghostDraftCalls[0]?.title || 'missing'}`,
			`convex_date=${convexCalls[0]?.record?.date || 'missing'}`,
			`state_date=${state.lastRunDate || 'missing'}`,
		].join(' '),
	);

	assert.strictEqual(utcKey, '2026-03-07', 'fixture should still be on the previous UTC date');
	assert.strictEqual(ghostDraftCalls.length, 1, 'daily loop should create one draft for the local day');
	assert.strictEqual(ghostDraftCalls[0].title, 'Iris Daily Note — 2026-03-08', 'draft title should use the local day');
	assert.match(ghostDraftCalls[0].html, /Signals:/, 'draft html should summarize learning signals');
	assert.match(ghostDraftCalls[0].html, /browser recall still brittle/i, 'draft html should include the top active issue');
	assert.strictEqual(convexCalls[0].record.date, '2026-03-08', 'convex payload should use the local day');
	assert.match(convexCalls[0].record.summary, /1 learning events, 1 active issues, 0 resolved issues/i, 'convex payload should persist the generated summary');
	assert.strictEqual(state.lastRunDate, '2026-03-08', 'loop state should persist the local day');

	console.log('Daily loop local date tests passed.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
