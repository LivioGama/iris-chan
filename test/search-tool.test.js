const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true });

const serviceRef = require('../src/main/automation/service-ref');
const { MemoryStore } = require('../src/main/automation/memory-store');

console.log('Running search tool tests...');

function createTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-search-'));
}

function loadSearchModuleWithMocks({ execImpl, runHelperImpl }) {
	const searchPath = require.resolve('../src/main/tools/search');
	const nativeHelperPath = require.resolve('../src/main/native-helper');
	const childProcess = require('child_process');
	const originalExec = childProcess.exec;
	const originalNativeHelper = require.cache[nativeHelperPath];

	childProcess.exec = execImpl;
	require.cache[nativeHelperPath] = {
		id: nativeHelperPath,
		filename: nativeHelperPath,
		loaded: true,
		exports: { runHelper: runHelperImpl },
	};
	delete require.cache[searchPath];

	const searchModule = require('../src/main/tools/search');

	return {
		searchModule,
		restore() {
			childProcess.exec = originalExec;
			delete require.cache[searchPath];
			if (originalNativeHelper) {
				require.cache[nativeHelperPath] = originalNativeHelper;
			} else {
				delete require.cache[nativeHelperPath];
			}
		},
	};
}

async function testWebSearchFallsBackAndPersistsProviderPreference() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previousMemoryStore = serviceRef.getMemoryStore();
	const previousConvexClient = serviceRef.getConvexClient();
	const originalFetch = global.fetch;
	const runtimeEvents = [];
	serviceRef.setMemoryStore(memoryStore);
	serviceRef.setConvexClient({
		async saveRuntimeEvent(event) {
			runtimeEvents.push(event);
			return { ok: true };
		},
	});

	let clipboardReadCount = 0;
	const { searchModule, restore } = loadSearchModuleWithMocks({
		execImpl(command, options, callback) {
			if (typeof options === 'function') callback = options;
			callback?.(null, '', '');
		},
		async runHelperImpl({ action }) {
			if (action === 'clipboard_read') {
				clipboardReadCount += 1;
				return { result: 'Fallback answer from ChatGPT app' };
			}
			return { ok: true };
		},
	});

	global.fetch = async () => {
		throw new Error('perplexity offline');
	};

	try {
		const result = await searchModule.web_search({
			query: 'latest iris memory platform plan',
			providers: ['perplexity', 'chatgpt-app'],
			env: { PERPLEXITY_API_KEY: 'test-key' },
		});

		assert.strictEqual(result.ok, true, 'web search should fall back to the desktop provider');
		assert.strictEqual(result.provider, 'chatgpt-app', 'fallback provider should be surfaced');
		assert.strictEqual(clipboardReadCount, 1, 'chatgpt app fallback should read from the clipboard once');
		assert.strictEqual(memoryStore.getValue('search.provider.preferred').provider, 'chatgpt-app', 'successful provider should be remembered');
		assert.strictEqual(runtimeEvents.length, 1, 'successful searches should emit a Convex runtime event');
		const payload = JSON.parse(runtimeEvents[0].payload);
		assert.strictEqual(payload.status, 'success');
		assert.strictEqual(payload.provider, 'chatgpt-app');
		assert.strictEqual(payload.fallbackUsed, true, 'telemetry should record provider fallback');
		assert.strictEqual(Array.isArray(payload.attempts), true);
		assert.strictEqual(payload.attempts.length, 2, 'telemetry should include both failed and successful attempts');
	} finally {
		restore();
		global.fetch = originalFetch;
		serviceRef.setMemoryStore(previousMemoryStore);
		serviceRef.setConvexClient(previousConvexClient);
	}
}

async function testPerplexitySearchReturnsStructuredSources() {
	const originalFetch = global.fetch;
	const { searchModule, restore } = loadSearchModuleWithMocks({
		execImpl(command, options, callback) {
			if (typeof options === 'function') callback = options;
			callback?.(null, '', '');
		},
		async runHelperImpl() {
			return { result: '' };
		},
	});

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
		restore();
		global.fetch = originalFetch;
	}
}

async function testResolveProviderOrderUsesRememberedProviderFirst() {
	const irisDir = createTempDir();
	const memoryStore = new MemoryStore({ irisDir });
	const previousMemoryStore = serviceRef.getMemoryStore();
	serviceRef.setMemoryStore(memoryStore);
	const { searchModule, restore } = loadSearchModuleWithMocks({
		execImpl(command, options, callback) {
			if (typeof options === 'function') callback = options;
			callback?.(null, '', '');
		},
		async runHelperImpl() {
			return { result: '' };
		},
	});

	try {
		memoryStore.upsert({
			kind: 'integration_state',
			scope: 'machine',
			key: 'search.provider.preferred',
			value: { provider: 'chatgpt-app' },
			source: 'test',
			confidence: 1,
		});
		const providers = searchModule._private.resolveProviderOrder({}, { IRIS_SEARCH_PROVIDER: 'perplexity' }, memoryStore);
		assert.strictEqual(providers[0], 'chatgpt-app', 'remembered provider should be preferred before defaults');
		assert.ok(providers.includes('perplexity'), 'default provider should remain available');
	} finally {
		restore();
		serviceRef.setMemoryStore(previousMemoryStore);
	}
}

async function main() {
	await testWebSearchFallsBackAndPersistsProviderPreference();
	await testPerplexitySearchReturnsStructuredSources();
	await testResolveProviderOrderUsesRememberedProviderFirst();
	console.log('Search tool tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
