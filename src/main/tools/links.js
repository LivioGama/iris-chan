const { exec } = require('child_process');
const convexStore = require('../convex-store');

const RECENCY_PATTERN = /\b(most recent|latest|last|newest|just now|just saw|just visited|currently?\s+open)\b/i;

function formatLinkResults(results) {
	return results.map((r, i) =>
		`${i + 1}. [${r.title || r.domain || 'Untitled'}](${r.url})${r.snippet ? ` — ${r.snippet.slice(0, 120)}` : ''}`
	).join('\n');
}

async function recall_link(args = {}) {
	const query = String(args.query || '').trim();
	if (!query) return { ok: false, result: 'No query provided' };
	const domain = args.domain ? String(args.domain).trim() : null;
	const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);

	// Detect recency queries — return most recent links by time, not keyword
	if (RECENCY_PATTERN.test(query)) {
		const recent = await convexStore.getRecentLinks(limit);
		const filtered = domain ? recent.filter(r => (r.domain || '') === domain) : recent;
		if (!filtered.length) return { ok: true, result: 'No links have been saved yet. Links are captured automatically when you browse the web.' };
		return { ok: true, result: formatLinkResults(filtered) };
	}

	const results = await convexStore.searchLinks(query, limit, domain);
	if (!results.length) return { ok: true, result: `I don't have any saved links matching "${query}". Links are saved automatically when you browse the web or when I search for something.` };

	return { ok: true, result: formatLinkResults(results) };
}

async function open_link(args = {}) {
	const query = String(args.query || '').trim();
	const url = String(args.url || '').trim();

	let targetUrl = url;
	if (!targetUrl && query) {
		const results = await convexStore.searchLinks(query, 1);
		if (results.length) targetUrl = results[0].url;
	}
	if (!targetUrl) return { ok: false, result: 'No link found matching your query.' };

	return new Promise((resolve) => {
		exec(`open "${targetUrl.replace(/"/g, '\\"')}"`, { timeout: 5000 }, (err) => {
			if (err) resolve({ ok: false, result: `Failed to open: ${err.message}` });
			else resolve({ ok: true, result: `Opened ${targetUrl}` });
		});
	});
}

module.exports = { recall_link, open_link };
