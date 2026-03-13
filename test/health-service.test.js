const assert = require('node:assert');

const { HealthService } = require('../src/main/runtime/health-service');

console.log('Running health service tests...');

async function main() {
	const emitted = [];
	const service = new HealthService({
		convexClient: {
			async healthCheck() {
				return { ok: true, latencyMs: 42, retryCount: 0 };
			},
		},
		taskEngine: {
			getHealth() {
				return 'ok';
			},
		},
		skillEngine: {
			getHealth() {
				return 'ok';
			},
		},
		eventBus: {
			emitEvent(type, payload, source) {
				emitted.push({ type, payload, source });
			},
		},
	});

	const healthy = await service.getHealth();
	assert.deepStrictEqual(
		healthy,
		{ voice: 'ok', db: 'ok', tasks: 'ok', skills: 'ok', latencyMs: 42, dbError: undefined },
		'healthy probes should report ok statuses and preserve latency'
	);
	assert.strictEqual(emitted.length, 1, 'health check should emit a DB health event');
	assert.strictEqual(emitted[0].source, 'health-service', 'health event should identify its source');

	const degraded = new HealthService({
		convexClient: {
			async healthCheck() {
				throw new Error('backend offline');
			},
		},
		taskEngine: {
			getHealth() {
				throw new Error('task engine crashed');
			},
		},
		skillEngine: {
			getHealth() {
				throw new Error('skill engine crashed');
			},
		},
		eventBus: {
			emitEvent(type, payload) {
				emitted.push({ type, payload });
			},
		},
	});

	const degradedResult = await degraded.getHealth();
	assert.strictEqual(degradedResult.db, 'degraded', 'db failures should degrade rather than throw');
	assert.strictEqual(degradedResult.tasks, 'tasks-degraded', 'task engine failures should degrade rather than throw');
	assert.strictEqual(degradedResult.skills, 'skills-degraded', 'skill engine failures should degrade rather than throw');
	assert.strictEqual(degradedResult.latencyMs, -1, 'thrown db probes should fall back to unknown latency');
	assert.match(degradedResult.dbError, /backend offline/, 'db error should be preserved for diagnostics');

	const missingDeps = new HealthService({
		convexClient: null,
		taskEngine: {},
		skillEngine: {},
		eventBus: null,
	});
	const missingResult = await missingDeps.getHealth();
	assert.strictEqual(missingResult.db, 'degraded', 'missing convex client should still return a health object');
	assert.strictEqual(missingResult.tasks, 'tasks-degraded', 'missing task engine getter should degrade safely');
	assert.strictEqual(missingResult.skills, 'skills-degraded', 'missing skill engine getter should degrade safely');

	console.log('Health service tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
