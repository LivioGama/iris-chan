const assert = require('node:assert');
const fs = require('node:fs');

console.log('Running convex store tests...');

function makeEmbedding(value = 0.1) {
	return new Array(1024).fill(value);
}

function flushAsyncWork() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadConvexStoreWithMocks({ envText, fetchImpl }) {
	const modulePath = require.resolve('../src/main/convex-store');
	const originalReadFileSync = fs.readFileSync;
	const originalFetch = global.fetch;

	fs.readFileSync = function patchedReadFileSync(targetPath, encoding) {
		if (String(targetPath).endsWith('/.env')) {
			return envText;
		}
		return originalReadFileSync.call(this, targetPath, encoding);
	};
	global.fetch = fetchImpl;
	delete require.cache[modulePath];

	const convexStore = require('../src/main/convex-store');

	return {
		convexStore,
		restore() {
			fs.readFileSync = originalReadFileSync;
			global.fetch = originalFetch;
			delete require.cache[modulePath];
		},
	};
}

async function testSaveTurnMarksEmbeddingsPendingThenReady() {
	const requests = [];
	const { convexStore, restore } = loadConvexStoreWithMocks({
		envText: 'CONVEX_URL=http://convex.local\nOPENROUTER_API_KEY=test-key\n',
		async fetchImpl(url, options = {}) {
			requests.push({ url: String(url), body: JSON.parse(options.body || '{}') });
			if (String(url).includes('/api/run/conversations/saveTurn')) {
				return {
					async json() {
						return { status: 'success', value: 'doc_123' };
					},
				};
			}
			if (String(url).includes('openrouter.ai/api/v1/embeddings')) {
				return {
					ok: true,
					async json() {
						return { data: [{ embedding: makeEmbedding(0.25) }] };
					},
				};
			}
			if (String(url).includes('/api/run/conversations/patchEmbedding')) {
				return {
					async json() {
						return { status: 'success', value: null };
					},
				};
			}
			throw new Error(`Unexpected fetch: ${url}`);
		},
	});

	try {
		await convexStore.saveTurn('user', 'Remember this exact sentence.');
		await flushAsyncWork();

		const saveTurnRequest = requests.find((entry) => entry.url.includes('/api/run/conversations/saveTurn'));
		const patchRequest = requests.find((entry) => entry.url.includes('/api/run/conversations/patchEmbedding'));

		assert.ok(saveTurnRequest, 'saveTurn should persist the initial conversation row');
		assert.strictEqual(saveTurnRequest.body.args.embeddingStatus, 'pending', 'initial rows should not be searchable before embeddings exist');
		assert.ok(patchRequest, 'saveTurn should patch embeddings after generation completes');
		assert.strictEqual(patchRequest.body.args.embeddingStatus, 'ready', 'patched embeddings should become searchable only when ready');
		assert.strictEqual(Array.isArray(patchRequest.body.args.embedding), true, 'patched embedding should be sent back to Convex');
		assert.strictEqual(typeof patchRequest.body.args.embeddingUpdatedAt, 'number', 'patched embedding should carry provenance timing');
	} finally {
		restore();
	}
}

async function testSaveTurnRetriesWithoutUnsupportedFields() {
	const requests = [];
	const { convexStore, restore } = loadConvexStoreWithMocks({
		envText: 'CONVEX_URL=http://convex.local\nOPENROUTER_API_KEY=test-key\n',
		async fetchImpl(url, options = {}) {
			const body = JSON.parse(options.body || '{}');
			requests.push({ url: String(url), body });
			if (String(url).includes('/api/run/conversations/saveTurn')) {
				if ('embeddingStatus' in (body.args || {})) {
					return {
						async json() {
							return {
								status: 'error',
								errorMessage: 'ArgumentValidationError: Object contains extra field `embeddingStatus` that is not in the validator.',
							};
						},
					};
				}
				return {
					async json() {
						return { status: 'success', value: 'doc_legacy' };
					},
				};
			}
			if (String(url).includes('openrouter.ai/api/v1/embeddings')) {
				return {
					ok: true,
					async json() {
						return { data: [{ embedding: makeEmbedding(0.35) }] };
					},
				};
			}
			if (String(url).includes('/api/run/conversations/patchEmbedding')) {
				if ('embeddingStatus' in (body.args || {})) {
					return {
						async json() {
							return {
								status: 'error',
								errorMessage: 'ArgumentValidationError: Object contains extra field `embeddingStatus` that is not in the validator.',
							};
						},
					};
				}
				return {
					async json() {
						return { status: 'success', value: null };
					},
				};
			}
			throw new Error(`Unexpected fetch: ${url}`);
		},
	});

	try {
		await convexStore.saveTurn('user', 'Legacy validator compatibility check.');
		await flushAsyncWork();
		await flushAsyncWork();

		const saveTurnRequests = requests.filter((entry) => entry.url.includes('/api/run/conversations/saveTurn'));
		const patchRequests = requests.filter((entry) => entry.url.includes('/api/run/conversations/patchEmbedding'));

		assert.strictEqual(saveTurnRequests.length, 2, 'saveTurn should retry once when the backend rejects a new field');
		assert.strictEqual('embeddingStatus' in saveTurnRequests[0].body.args, true, 'the first attempt should use the modern payload');
		assert.strictEqual('embeddingStatus' in saveTurnRequests[1].body.args, false, 'the retry should strip unsupported fields');

		assert.strictEqual(patchRequests.length, 2, 'patchEmbedding should also retry against legacy validators');
		assert.strictEqual('embeddingStatus' in patchRequests[0].body.args, true, 'the first patch attempt should use the modern payload');
		assert.strictEqual('embeddingStatus' in patchRequests[1].body.args, false, 'legacy patch retries should strip unsupported fields');
		assert.strictEqual(Array.isArray(patchRequests[1].body.args.embedding), true, 'the embedding payload should still be preserved');
	} finally {
		restore();
	}
}

async function testSemanticSearchDropsUnavailableEmbeddingsAndDedupesResults() {
	const requests = [];
	const { convexStore, restore } = loadConvexStoreWithMocks({
		envText: 'CONVEX_URL=http://convex.local\nOPENROUTER_API_KEY=test-key\n',
		async fetchImpl(url, options = {}) {
			requests.push({ url: String(url), body: JSON.parse(options.body || '{}') });
			if (String(url).includes('openrouter.ai/api/v1/embeddings')) {
				return {
					ok: true,
					async json() {
						return { data: [{ embedding: makeEmbedding(0.5) }] };
					},
				};
			}
			if (String(url).includes('/api/run/search/semanticSearch')) {
				return {
					async json() {
						return {
							status: 'success',
							value: [
								{
									_id: 'a',
									_score: 0.92,
									role: 'user',
									text: 'Find the Convex memory note',
									cleanText: 'Find the Convex memory note',
									sessionId: 'session-1',
									timestamp: 10,
									source: 'realtime',
									provenance: { sessionId: 'session-1', timestamp: 10, source: 'realtime' },
								},
								{
									_id: 'b',
									_score: 0.91,
									role: 'user',
									text: 'Find the Convex memory note',
									cleanText: 'Find the Convex memory note',
									sessionId: 'session-1',
									timestamp: 10,
									source: 'realtime',
									provenance: { sessionId: 'session-1', timestamp: 10, source: 'realtime' },
								},
								{
									_id: 'c',
									_score: 0.88,
									role: 'iris',
									text: 'A different matching memory',
									cleanText: 'A different matching memory',
									sessionId: 'session-2',
									timestamp: 20,
									source: 'historical',
									provenance: { sessionId: 'session-2', timestamp: 20, source: 'historical' },
								},
							],
						};
					},
				};
			}
			throw new Error(`Unexpected fetch: ${url}`);
		},
	});

	try {
		const results = await convexStore.semanticSearch('Find my Convex memory', 5, 'user');
		assert.strictEqual(results.length, 2, 'duplicate recalls should be collapsed before returning');
		assert.strictEqual(results[0].provenance.source, 'realtime', 'results should include provenance');

		const searchRequest = requests.find((entry) => entry.url.includes('/api/run/search/semanticSearch'));
		assert.ok(searchRequest, 'semantic search should hit the Convex search action when embeddings are ready');
		assert.strictEqual(searchRequest.body.args.minScore, 0.35, 'search requests should include the precision guardrail threshold');
		assert.strictEqual(searchRequest.body.args.roleFilter, 'user', 'role filters should continue to be forwarded');
	} finally {
		restore();
	}

	const unavailableRequests = [];
	const unavailable = loadConvexStoreWithMocks({
		envText: 'CONVEX_URL=http://convex.local\n',
		async fetchImpl(url) {
			unavailableRequests.push(String(url));
			throw new Error(`Unexpected fetch: ${url}`);
		},
	});

	try {
		const results = await unavailable.convexStore.semanticSearch('Any memory query', 5, null);
		assert.deepStrictEqual(results, [], 'search should fail closed when query embeddings cannot be generated');
		assert.strictEqual(
			unavailableRequests.some((url) => url.includes('/api/run/search/semanticSearch')),
			false,
			'Convex search should not run when embeddings are unavailable'
		);
	} finally {
		unavailable.restore();
	}
}

async function testEndSessionPreservesSessionIntegrityFields() {
	const requests = [];
	const { convexStore, restore } = loadConvexStoreWithMocks({
		envText: 'CONVEX_URL=http://convex.local\n',
		async fetchImpl(url, options = {}) {
			requests.push({ url: String(url), body: JSON.parse(options.body || '{}') });
			return {
				async json() {
					return { status: 'success', value: null };
				},
			};
		},
	});

	try {
		convexStore.newSession();
		await flushAsyncWork();
		await convexStore.endSession();

		const upserts = requests.filter((entry) => entry.url.includes('/api/run/conversations/upsertSession'));
		assert.strictEqual(upserts.length >= 2, true, 'newSession and endSession should both sync session state');
		assert.strictEqual(typeof upserts[0].body.args.startedAt, 'number', 'new sessions should set startedAt');
		assert.strictEqual(upserts[0].body.args.turnCount, 0, 'new sessions should initialize turnCount');
		assert.strictEqual(typeof upserts[1].body.args.endedAt, 'number', 'endSession should only set endedAt');
		assert.strictEqual('startedAt' in upserts[1].body.args, false, 'endSession must not overwrite startedAt');
		assert.strictEqual('turnCount' in upserts[1].body.args, false, 'endSession must not reset turnCount');
	} finally {
		restore();
	}
}

async function main() {
	await testSaveTurnMarksEmbeddingsPendingThenReady();
	await testSaveTurnRetriesWithoutUnsupportedFields();
	await testSemanticSearchDropsUnavailableEmbeddingsAndDedupesResults();
	await testEndSessionPreservesSessionIntegrityFields();
	console.log('Convex store tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
