const crypto = require('node:crypto');
const { getConvexClient, getMemoryStore } = require('../automation/service-ref');
const config = require('../../shared/config').default;
const convexStore = require('../convex-store');

const SEARCH_PROVIDER_KEY = 'search.provider.preferred';
const PROVIDER_PERPLEXITY = 'perplexity';
const KNOWN_PROVIDERS = new Set([PROVIDER_PERPLEXITY]);

function normalizeProvider(value = '') {
	return String(value || '').trim().toLowerCase();
}

function unique(values = []) {
	return [...new Set(values.filter(Boolean))];
}

function hashQuery(query = '') {
	return crypto.createHash('sha1').update(String(query || '')).digest('hex').slice(0, 12);
}

function normalizeUrl(url = '') {
	try {
		return new URL(String(url || '')).toString();
	} catch {
		return String(url || '').trim();
	}
}

function normalizeSource(entry = {}, index = 0) {
	const url = normalizeUrl(entry.url || entry.link || entry.href || entry.source || '');
	const title = String(entry.title || entry.name || url || `Source ${index + 1}`).trim();
	const snippet = String(entry.snippet || entry.text || entry.content || '').trim();
	return {
		title,
		url,
		snippet: snippet.slice(0, 500),
	};
}

function uniqueSources(entries = []) {
	const seen = new Set();
	const output = [];
	for (const entry of entries) {
		const normalized = normalizeSource(entry, output.length);
		if (!normalized.url || seen.has(normalized.url)) continue;
		seen.add(normalized.url);
		output.push(normalized);
	}
	return output;
}

function appendSources(answer, sources = []) {
	const cleaned = String(answer || '').trim();
	if (!sources.length) return cleaned;
	const lines = sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n');
	if (!cleaned) return `Sources:\n${lines}`;
	if (/sources:/i.test(cleaned)) return cleaned;
	return `${cleaned}\n\nSources:\n${lines}`;
}

function getRememberedProvider(memoryStore = getMemoryStore()) {
	const stored = memoryStore?.getValue?.(SEARCH_PROVIDER_KEY, null);
	if (typeof stored === 'string') return normalizeProvider(stored);
	return normalizeProvider(stored?.provider || '');
}

function rememberProvider(provider, memoryStore = getMemoryStore()) {
	if (!memoryStore?.upsert || !provider) return;
	memoryStore.upsert({
		kind: 'integration_state',
		scope: 'machine',
		key: SEARCH_PROVIDER_KEY,
		value: {
			provider,
			updatedAt: new Date().toISOString(),
		},
		source: 'runtime',
		confidence: 0.9,
	});
}

function resolveProviderOrder(args = {}, env = process.env, memoryStore = getMemoryStore()) {
	const explicit = [
		...(Array.isArray(args.providers) ? args.providers : []),
		args.provider,
	]
		.map(normalizeProvider)
		.filter((provider) => KNOWN_PROVIDERS.has(provider));
	const remembered = getRememberedProvider(memoryStore);
	const configProviders = Array.isArray(config.search.providers) ? config.search.providers : [];
	const envProviders = String(env.IRIS_SEARCH_PROVIDERS || '')
		.split(',')
		.map(normalizeProvider)
		.filter((provider) => KNOWN_PROVIDERS.has(provider));
	const defaultProvider = normalizeProvider(args.defaultProvider || env.IRIS_SEARCH_PROVIDER || config.search.defaultProvider);

	return unique([
		...explicit,
		remembered,
		defaultProvider,
		...envProviders,
		...configProviders.map(normalizeProvider),
		PROVIDER_PERPLEXITY,
	]).filter((provider) => KNOWN_PROVIDERS.has(provider));
}

async function emitSearchRuntimeEvent(payload) {
	const convexClient = getConvexClient();
	if (!convexClient?.saveRuntimeEvent) return;
	const timestamp = Date.now();
	const idempotencyKey = `search_${payload.queryHash || 'unknown'}_${payload.status || 'unknown'}_${timestamp}`;
	try {
		await convexClient.saveRuntimeEvent({
			type: 'SEARCH_QUERY',
			timestamp,
			source: 'search-tool',
			payload: JSON.stringify(payload),
		}, idempotencyKey);
	} catch {}
}

async function runPerplexitySearch(query, env = process.env) {
	const apiKey = env.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY || '';
	if (!apiKey) {
		throw new Error('PERPLEXITY_API_KEY not configured');
	}

	const startedAt = Date.now();
	const response = await fetch(`${config.search.perplexityBaseUrl.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: config.search.perplexityModel,
			messages: [
				{
					role: 'system',
					content: 'Answer with concise factual synthesis. Preserve provenance. Prefer direct source-backed statements and cite sources in markdown links when available.',
				},
				{ role: 'user', content: query },
			],
			stream: false,
		}),
		signal: AbortSignal.timeout(config.search.requestTimeoutMs),
	});
	if (!response.ok) {
		throw new Error(`Perplexity API error: ${response.status}`);
	}

	const payload = await response.json();
	const answer = String(payload.choices?.[0]?.message?.content || '').trim();
	const sources = uniqueSources([
		...(Array.isArray(payload.search_results) ? payload.search_results : []),
		...(Array.isArray(payload.citations)
			? payload.citations.map((url, index) => ({ url, title: `Citation ${index + 1}` }))
			: []),
	]);

	return {
		ok: true,
		provider: PROVIDER_PERPLEXITY,
		result: appendSources(answer.slice(0, 4000), sources),
		rawResults: Array.isArray(payload.search_results) ? payload.search_results : [],
		sources,
		latencyMs: Date.now() - startedAt,
	};
}

async function runSearchWithProvider(provider, query, env = process.env) {
	if (provider === PROVIDER_PERPLEXITY) return runPerplexitySearch(query, env);
	throw new Error(`Unsupported search provider: ${provider}`);
}

async function web_search(args = {}) {
	const query = String(args.query || '').trim();
	if (!query) return { ok: false, result: 'No query provided' };

	const providers = resolveProviderOrder(args);
	const queryHash = hashQuery(query);
	const attempts = [];
	const startedAt = Date.now();

	for (const provider of providers) {
		try {
			const response = await runSearchWithProvider(provider, query, args.env || process.env);
			const attempt = {
				provider,
				ok: true,
				latencyMs: response.latencyMs,
				resultCount: Array.isArray(response.rawResults) ? response.rawResults.length : 0,
			};
			attempts.push(attempt);
			rememberProvider(provider);
			await emitSearchRuntimeEvent({
				status: 'success',
				queryHash,
				queryLength: query.length,
				provider,
				attempts,
				fallbackUsed: attempts.length > 1,
				durationMs: Date.now() - startedAt,
				resultLength: String(response.result || '').length,
				sourceCount: Array.isArray(response.sources) ? response.sources.length : 0,
			});
			if (convexStore.saveLink && Array.isArray(response.sources)) {
				for (const src of response.sources) {
					if (src.url) {
						convexStore.saveLink({ url: src.url, title: src.title || '', snippet: src.snippet || '', source: 'web_search' }).catch(() => {});
					}
				}
			}
			return {
				ok: true,
				result: response.result,
				provider,
				attempts,
				sources: Array.isArray(response.sources) ? response.sources : [],
				latencyMs: Date.now() - startedAt,
			};
		} catch (err) {
			attempts.push({
				provider,
				ok: false,
				error: err.message,
			});
		}
	}

	await emitSearchRuntimeEvent({
		status: 'error',
		queryHash,
		queryLength: query.length,
		provider: attempts[attempts.length - 1]?.provider || 'none',
		attempts,
		fallbackUsed: attempts.length > 1,
		durationMs: Date.now() - startedAt,
	});

	const lastError = attempts[attempts.length - 1]?.error || 'Unknown search error';
	return {
		ok: false,
		result: `Search error: ${lastError}`,
		attempts,
		sources: [],
	};
}

module.exports = {
	web_search,
	_private: {
		resolveProviderOrder,
		getRememberedProvider,
		rememberProvider,
		emitSearchRuntimeEvent,
		runPerplexitySearch,
		hashQuery,
		appendSources,
		uniqueSources,
	},
};
