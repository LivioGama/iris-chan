// Tool handlers: web_search, ask_chatgpt
const { exec } = require('child_process');
const { runHelper } = require('../native-helper');
const config = require('../../shared/config');

async function web_search(args) {
	const query = args.query || '';
	if (!query) return { ok: false, result: 'No query provided' };

	const OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';
	if (!OLLAMA_KEY) return { ok: false, result: 'OLLAMA_API_KEY not configured' };

	const headers = {
		'Content-Type': 'application/json',
		'Authorization': `Bearer ${OLLAMA_KEY}`,
	};

	try {
		const searchResp = await fetch(`${config.search.ollamaHost}/api/web_search`, {
			method: 'POST', headers,
			body: JSON.stringify({ query, max_results: 5 }),
			signal: AbortSignal.timeout(15000),
		});
		if (!searchResp.ok) {
			return { ok: false, result: 'Search API error: ' + searchResp.status };
		}
		const searchData = await searchResp.json();
		const results = searchData.results || [];

		if (!results.length) return { ok: true, result: 'No search results found.' };

		const rawResults = results
			.map(r => `## ${r.title}\nURL: ${r.url}\n${(r.content || r.snippet || '').slice(0, 1500)}`)
			.join('\n\n---\n\n')
			.slice(0, 8000);

		const synthResp = await fetch(`${config.search.ollamaHost}/api/chat`, {
			method: 'POST', headers,
			body: JSON.stringify({
				model: 'gpt-oss:120b-cloud',
				messages: [
					{ role: 'system', content: 'You are a search-result synthesizer. Your output feeds directly into another LLM — not a human. Rules: Return ONLY factual data. No greetings, disclaimers, or filler. Use compact bullet points. Include source URLs as [title](url). Max 400 words.' },
					{ role: 'user', content: `Query: ${query}\n\nSearch results:\n${rawResults}\n\nSynthesize these results into a concise, structured answer.` },
				],
				stream: false,
				think: false,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!synthResp.ok) {
			return { ok: true, result: rawResults.slice(0, 4000) };
		}

		const synthData = await synthResp.json();
		const answer = synthData.message?.content || '';

		if (answer.length < 20) {
			return { ok: true, result: rawResults.slice(0, 4000) };
		}

		return { ok: true, result: answer.slice(0, 4000) };
	} catch (err) {
		return { ok: false, result: 'Search error: ' + err.message };
	}
}

async function ask_chatgpt(args) {
	const prompt = args.prompt || '';
	if (!prompt) return { ok: false, result: 'No prompt provided' };

	await new Promise((resolve) => {
		exec(`osascript -e 'tell application "ChatGPT" to activate'`, { timeout: 3000 }, resolve);
	});
	await new Promise(r => setTimeout(r, 800));

	await runHelper({ action: 'press_key', key: 'cmd+n' });
	await new Promise(r => setTimeout(r, 500));

	await runHelper({ action: 'type_text', text: prompt });
	await new Promise(r => setTimeout(r, 300));
	await runHelper({ action: 'press_key', key: 'return' });

	await new Promise(r => setTimeout(r, 8000));

	await runHelper({ action: 'press_key', key: 'cmd+shift+c' });
	await new Promise(r => setTimeout(r, 300));

	const clipResult = await runHelper({ action: 'clipboard_read' });
	const response = clipResult?.result || '(no response captured)';

	return { ok: true, result: response.slice(0, 4000) };
}

module.exports = { web_search, ask_chatgpt };
