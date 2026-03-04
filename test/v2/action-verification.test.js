const assert = require('node:assert');

async function executeWithVerification(action, { perform, verify, maxRetries = 3, delayMs = 0 }) {
	let lastError = null;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		await perform(action, attempt);
		if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
		const ok = await verify({ action, attempt });
		if (ok) return { ok: true, attempt };
		lastError = new Error(`Verification failed at attempt ${attempt}`);
	}
	return { ok: false, error: lastError ? lastError.message : 'Verification failed' };
}

console.log('Running V2 action verification tests...');

(async () => {
	let attempts = 0;
	const passOnThird = await executeWithVerification('click', {
		perform: async () => { attempts += 1; },
		verify: async ({ attempt }) => attempt >= 3,
		maxRetries: 3,
	});
	assert.strictEqual(passOnThird.ok, true, 'verification succeeds before cap');
	assert.strictEqual(passOnThird.attempt, 3, 'succeeds on expected retry');
	assert.strictEqual(attempts, 3, 'performs all attempts until success');

	const failAlways = await executeWithVerification('type', {
		perform: async () => {},
		verify: async () => false,
		maxRetries: 2,
	});
	assert.strictEqual(failAlways.ok, false, 'verification fails when all attempts fail');
	assert.ok(/attempt 2/.test(failAlways.error), 'failure reports last attempt');

	console.log('V2 action verification tests passed.');
})();
