// Background clipboard/window scanning + AX tree + Gemini extraction
const config = require('../../shared/config').default;
const vocabStore = require('./store');
const toolExecutor = require('../tools');
const { runHelper } = require('../native-helper');
const log = require('../logger');

let vocabBuffer = [];
let lastClipboard = '';
let lastWindowTitle = '';
let intervalIds = [];

async function extractTermsWithGemini(textChunks, apiKey) {
	if (!textChunks.length || !apiKey) return [];
	const combined = textChunks.join('\n---\n').slice(0, config.vocab.maxExtractTextLen);
	const existing = [...vocabStore.loadTerms(), ...Object.keys(vocabStore.loadHot())];
	const existingList = existing.slice(0, 200).join(', ');

	const body = {
		contents: [{
			parts: [{
				text: [
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
				].join('\n')
			}]
		}],
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
		log.error('VocabAI', 'Gemini extraction error:', err.message);
	}
	return [];
}

const GENERIC_AX_LABELS = new Set([
	'close', 'minimize', 'zoom', 'back', 'forward', 'save', 'cancel',
	'ok', 'done', 'next', 'previous', 'search', 'file', 'edit', 'view',
	'window', 'help', 'new', 'open', 'delete', 'copy', 'paste', 'cut',
	'undo', 'redo', 'select all', 'quit', 'preferences', 'settings',
	'toolbar', 'scroll bar', 'menu bar', 'tab bar', 'group', 'list',
	'button', 'text', 'image', 'icon', 'menu', 'menu item', 'separator',
	'scroll area', 'content', 'main', 'navigation', 'banner',
]);

async function extractFromAccessibility(getWin) {
	try {
		const result = await runHelper({ action: 'ax_snapshot', limit: config.vocab.axMaxElements || 80 });
		if (!result.ok || !result.result) return;

		const parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
		const appName = parsed.appName || '';
		const windowTitle = parsed.windowTitle || '';

		// App names are always valid vocabulary — add directly as hot terms
		if (appName && appName.length >= 2 && appName.length <= 40) {
			vocabStore.addHotTerm(appName);
		}

		// Extract text from AX element fields
		const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
		const texts = [];
		for (const el of elements) {
			for (const field of ['title', 'value', 'description']) {
				const val = String(el[field] || '').trim();
				if (val && val.length >= 3 && val.length <= 60 && !GENERIC_AX_LABELS.has(val.toLowerCase())) {
					texts.push(val);
				}
			}
		}

		// Deduplicate and push into vocabBuffer for Gemini batch processing
		const unique = [...new Set(texts)];
		if (unique.length) {
			vocabBuffer.push(`[AX:${appName}] ${unique.join(' | ')}`);
		}

		// Push to renderer for recent-seen speech hints
		const win = getWin();
		if (win && !win.isDestroyed() && unique.length) {
			win.webContents.send('ax-vocab-terms', { appName, windowTitle, terms: unique });
		}
	} catch (err) {
		log.error('VocabAX', 'AX extraction error:', err.message);
	}
}

function start(apiKey, getWin) {
	// Clipboard collector — every 5 seconds
	intervalIds.push(setInterval(async () => {
		try {
			const result = await toolExecutor.execute('clipboard_read', {});
			const text = result?.result || '';
			if (text && text !== lastClipboard && text.length < 2000) {
				lastClipboard = text;
				vocabBuffer.push(text);
			}
		} catch { }
	}, config.vocab.clipboardPollMs));

	// Window title collector — every 3 seconds
	let lastFocusedMessagingApp = null;
	intervalIds.push(setInterval(async () => {
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
		} catch { }
	}, config.vocab.windowPollMs));

	// Gemini Flash batch extraction — every 60 seconds
	intervalIds.push(setInterval(async () => {
		if (vocabBuffer.length === 0) return;
		const chunks = vocabBuffer.splice(0);
		const terms = await extractTermsWithGemini(chunks, apiKey);
		for (const t of terms) vocabStore.addHotTerm(t);
		log.info('VocabAI', `Batch: ${chunks.length} chunks → ${terms.length} terms: ${terms.join(', ')}`);
	}, config.vocab.batchExtractMs));

	// Accessibility tree extraction — every 15 seconds (free, no API cost)
	intervalIds.push(setInterval(() => extractFromAccessibility(getWin), config.vocab.axPollMs));

	// Promote/expire hot terms — every 60 seconds
	intervalIds.push(setInterval(() => vocabStore.promoteAndCleanHot(), config.vocab.promoteCleanMs));
}

function stop() {
	for (const id of intervalIds) clearInterval(id);
	intervalIds = [];
}

module.exports = { start, stop };
