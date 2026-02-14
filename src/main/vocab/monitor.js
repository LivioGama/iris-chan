// Background clipboard/window scanning + Gemini extraction
const config = require('../../shared/config');
const vocabStore = require('./store');
const toolExecutor = require('../tools');

let vocabBuffer = [];
let lastClipboard = '';
let lastWindowTitle = '';

async function extractTermsWithGemini(textChunks, apiKey) {
	if (!textChunks.length || !apiKey) return [];
	const combined = textChunks.join('\n---\n').slice(0, config.vocab.maxExtractTextLen);
	const existing = [...vocabStore.loadTerms(), ...Object.keys(vocabStore.loadHot())];
	const existingList = existing.slice(0, 200).join(', ');

	const body = {
		contents: [{ parts: [{ text: [
			'Extract technical/proper-noun terms from the following text snippets.',
			'Return ONLY a JSON array of strings. No explanation.',
			'Rules:',
			'- Only include: product names, library names, framework names, model names, tool names, programming terms, brand names, tech acronyms',
			'- Exclude: common English words, generic verbs, common nouns, numbers, URLs, file paths',
			'- Preserve exact casing (e.g. "LangChain" not "langchain")',
			'- Min 2 chars, max 40 chars per term',
			`- Max ${config.vocab.maxExtractTerms} terms total`,
			existing.length ? `\nAlready known (skip these): ${existingList}` : '',
			'\nText:\n' + combined,
		].join('\n') }] }],
		generationConfig: { temperature: 0, maxOutputTokens: 256 },
	};

	try {
		const resp = await fetch(
			`${config.gemini.flashEndpoint}?key=${apiKey}`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }
		);
		if (!resp.ok) return [];
		const data = await resp.json();
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
		const match = text.match(/\[[\s\S]*?\]/);
		if (match) {
			const terms = JSON.parse(match[0]);
			return terms.filter(t => typeof t === 'string' && t.length >= 2 && t.length <= 40);
		}
	} catch (err) {
		console.error('[VocabAI] Gemini extraction error:', err.message);
	}
	return [];
}

function start(apiKey, getWin) {
	// Clipboard collector — every 5 seconds
	setInterval(async () => {
		try {
			const result = await toolExecutor.execute('clipboard_read', {});
			const text = result?.result || '';
			if (text && text !== lastClipboard && text.length < 2000) {
				lastClipboard = text;
				vocabBuffer.push(text);
			}
		} catch {}
	}, config.vocab.clipboardPollMs);

	// Window title collector — every 3 seconds
	let lastFocusedMessagingApp = null;
	setInterval(async () => {
		try {
			const result = await toolExecutor.execute('get_frontmost_app', {});
			const info = result?.result || '';
			if (info && info !== lastWindowTitle) {
				lastWindowTitle = info;
				vocabBuffer.push(info);
			}
			// Detect messaging app focus transitions
			const lower = info.toLowerCase();
			const msgApp = config.messaging.apps.find(a => lower.includes(a)) || null;
			const win = getWin();
			if (msgApp && msgApp !== lastFocusedMessagingApp) {
				lastFocusedMessagingApp = msgApp;
				if (win && !win.isDestroyed()) {
					win.webContents.send('messaging-app-focused', msgApp);
				}
			} else if (!msgApp && lastFocusedMessagingApp) {
				lastFocusedMessagingApp = null;
				if (win && !win.isDestroyed()) {
					win.webContents.send('messaging-app-left');
				}
			}
		} catch {}
	}, config.vocab.windowPollMs);

	// Gemini Flash batch extraction — every 60 seconds
	setInterval(async () => {
		if (vocabBuffer.length === 0) return;
		const chunks = vocabBuffer.splice(0);
		const terms = await extractTermsWithGemini(chunks, apiKey);
		for (const t of terms) vocabStore.addHotTerm(t);
		console.log('[VocabAI] Batch:', chunks.length, 'chunks \u2192', terms.length, 'terms:', terms.join(', '));
	}, config.vocab.batchExtractMs);

	// Promote/expire hot terms — every 60 seconds
	setInterval(() => vocabStore.promoteAndCleanHot(), config.vocab.promoteCleanMs);
}

module.exports = { start };
