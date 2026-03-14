const assert = require('node:assert');

require('ts-node').register({ transpileOnly: true });

const serviceRef = require('../src/main/automation/service-ref');

console.log('Running search tool tests...');

function loadSearchModule() {
	const searchPath = require.resolve('../src/main/tools/search');
	delete require.cache[searchPath];
	return require('../src/main/tools/search');
}

async function testPerplexitySearchReturnsStructuredSources() {
	const originalFetch = global.fetch;
	const searchModule = loadSearchModule();

	global.fetch = async () => ({
		ok: true,
		async json() {
			return {
				choices: [{ message: { content: 'Perplexity summary of the current Iris retrieval plan.' } }],
				search_results: [
					{ title: 'Iris Plan', url: 'https://example.com/iris-plan', snippet: 'Plan details' },
				],
			};
		},
	});

	try {
		const result = await searchModule._private.runPerplexitySearch('iris retrieval plan', {
			PERPLEXITY_API_KEY: 'test-key',
		});
		assert.strictEqual(result.provider, 'perplexity');
		assert.strictEqual(result.sources.length, 1);
		assert.strictEqual(result.sources[0].url, 'https://example.com/iris-plan');
		assert.match(result.result, /Sources:/);
	} finally {
		global.fetch = originalFetch;
	}
}

async function testWebSearchCallsPerplexityDirectly() {
	const originalFetch = global.fetch;
	const previousConvexClient = serviceRef.getConvexClient();
	const runtimeEvents = [];
	serviceRef.setConvexClient({
		async saveRuntimeEvent(event) {
			runtimeEvents.push(event);
			return { ok: true };
		},
	});

	const searchModule = loadSearchModule();

	global.fetch = async () => ({
		ok: true,
		async json() {
			return {
				choices: [{ message: { content: 'Test answer from Perplexity.' } }],
				search_results: [
					{ title: 'Test Source', url: 'https://example.com/test', snippet: 'Test snippet' },
				],
			};
		},
	});

	try {
		const result = await searchModule.web_search({
			query: 'test query',
			env: { PERPLEXITY_API_KEY: 'test-key' },
		});

		assert.strictEqual(result.ok, true, 'web_search should return ok: true');
		assert.strictEqual(result.provider, 'perplexity', 'provider should be perplexity');
		assert.ok(result.result.includes('Test answer from Perplexity'), 'result should contain Perplexity answer');
		assert.strictEqual(result.sources.length, 1, 'should have one source');
		assert.strictEqual(runtimeEvents.length, 1, 'should emit one runtime event');
		const payload = JSON.parse(runtimeEvents[0].payload);
		assert.strictEqual(payload.status, 'success');
		assert.strictEqual(payload.provider, 'perplexity');
	} finally {
		global.fetch = originalFetch;
		serviceRef.setConvexClient(previousConvexClient);
	}
}

async function testWebSearchReturnsErrorOnApiFailure() {
	const originalFetch = global.fetch;
	const previousConvexClient = serviceRef.getConvexClient();
	const runtimeEvents = [];
	serviceRef.setConvexClient({
		async saveRuntimeEvent(event) {
			runtimeEvents.push(event);
			return { ok: true };
		},
	});

	const searchModule = loadSearchModule();

	global.fetch = async () => {
		throw new Error('network timeout');
	};

	try {
		const result = await searchModule.web_search({
			query: 'failing query',
			env: { PERPLEXITY_API_KEY: 'test-key' },
		});

		assert.strictEqual(result.ok, false, 'web_search should return ok: false on failure');
		assert.ok(result.result.includes('network timeout'), 'error message should be surfaced');
		assert.strictEqual(runtimeEvents.length, 1, 'should emit error runtime event');
		const payload = JSON.parse(runtimeEvents[0].payload);
		assert.strictEqual(payload.status, 'error');
	} finally {
		global.fetch = originalFetch;
		serviceRef.setConvexClient(previousConvexClient);
	}
}

async function main() {
	await testPerplexitySearchReturnsStructuredSources();
	await testWebSearchCallsPerplexityDirectly();
	await testWebSearchReturnsErrorOnApiFailure();
	console.log('Search tool tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
