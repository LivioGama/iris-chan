const { app, BrowserWindow, screen, ipcMain, session, systemPreferences, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Force ANGLE Metal backend before any window is created
app.commandLine.appendSwitch('use-angle', 'metal');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-features', 'Metal');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Load API keys from .env or process.env
let apiKey = process.env.GEMINI_API_KEY || '';
let ollamaApiKey = process.env.OLLAMA_API_KEY || '';
try {
	const envPath = path.join(__dirname, '.env');
	const envContent = fs.readFileSync(envPath, 'utf-8');
	for (const line of envContent.split('\n')) {
		const geminiMatch = line.match(/^GEMINI_API_KEY=(.+)$/);
		if (geminiMatch) apiKey = geminiMatch[1].trim();
		const ollamaMatch = line.match(/^OLLAMA_API_KEY=(.+)$/);
		if (ollamaMatch) ollamaApiKey = ollamaMatch[1].trim();
	}
} catch {}

// Make Ollama key available to tool-executor
process.env.OLLAMA_API_KEY = ollamaApiKey;

const toolExecutor = require('./tool-executor');
const screenCapture = require('./screen-capture');

ipcMain.handle('get-api-key', () => apiKey);
ipcMain.handle('execute-tool', (_, name, args) => toolExecutor.execute(name, args));
ipcMain.handle('capture-screen', () => screenCapture.capture());

// Vocabulary tracking IPC
ipcMain.on('track-vocabulary', (_, terms) => {
	let stats;
	try { stats = JSON.parse(fs.readFileSync(vocabStatsPathIris, 'utf-8')); } catch { stats = {}; }
	const now = new Date().toISOString();
	for (const term of terms) {
		if (!stats[term]) stats[term] = { count: 0, lastUsed: null };
		stats[term].count++;
		stats[term].lastUsed = now;
	}
	try { fs.writeFileSync(vocabStatsPathIris, JSON.stringify(stats, null, '\t') + '\n', 'utf-8'); } catch {}
});

// Vocabulary IPC for renderer access (files are in ~/.iris/, not web-accessible)
ipcMain.handle('get-vocabulary', () => {
	try { return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).terms || []; } catch { return []; }
});
ipcMain.handle('get-hot-vocabulary', () => {
	try { return Object.keys(JSON.parse(fs.readFileSync(hotVocabPath, 'utf-8'))); } catch { return []; }
});
ipcMain.handle('get-vocabulary-stats', () => {
	try { return JSON.parse(fs.readFileSync(vocabStatsPathIris, 'utf-8')); } catch { return {}; }
});
ipcMain.handle('get-vocabulary-corrections', () => {
	try { return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).corrections || {}; } catch { return {}; }
});
ipcMain.handle('get-vocabulary-core', () => {
	try { return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).core || []; } catch { return []; }
});
ipcMain.on('add-correction', (_, wrong, right) => {
	try {
		const vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
		if (!vocab.corrections) vocab.corrections = {};
		if (!vocab.corrections[wrong]) {
			vocab.corrections[wrong] = right;
			fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
			console.log(`[Vocab] Saved correction: "${wrong}" → "${right}"`);
		}
	} catch (err) {
		console.error('[Vocab] Failed to save correction:', err.message);
	}
});

// Search overlay IPC
ipcMain.on('search-spinner', (_, query) => showSearchOverlay(query, null));
ipcMain.on('search-result', (_, query, content) => showSearchOverlay(query, content));
ipcMain.on('search-hide', () => hideSearchOverlay());

function showSearchOverlay(query, content) {
	const cursor = screen.getCursorScreenPoint();
	const display = screen.getDisplayNearestPoint(cursor);
	const { width: dw, height: dh } = display.workAreaSize;
	const { x: dx, y: dy } = display.workArea;
	const ow = Math.min(650, dw - 80);
	const oh = Math.min(520, dh - 80);

	if (!searchWin || searchWin.isDestroyed()) {
		searchWin = new BrowserWindow({
			width: ow,
			height: oh,
			x: dx + Math.round((dw - ow) / 2),
			y: dy + Math.round((dh - oh) / 2),
			transparent: true,
			frame: false,
			hasShadow: false,
			alwaysOnTop: true,
			skipTaskbar: true,
			resizable: false,
			focusable: true,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});
		searchWin.loadFile('search-overlay.html');
		searchWin.webContents.on('did-finish-load', () => {
			if (content !== null) {
				searchWin.webContents.send('search-result', query, content);
			} else {
				searchWin.webContents.send('search-spinner', query);
			}
		});
	} else {
		// Reposition to current display center
		searchWin.setBounds({
			x: dx + Math.round((dw - ow) / 2),
			y: dy + Math.round((dh - oh) / 2),
			width: ow,
			height: oh,
		});
		searchWin.show();
		if (content !== null) {
			searchWin.webContents.send('search-result', query, content);
		} else {
			searchWin.webContents.send('search-spinner', query);
		}
	}

	clearTimeout(searchHideTimeout);
	if (content !== null) {
		searchHideTimeout = setTimeout(() => hideSearchOverlay(), 30000);
	}
}

function hideSearchOverlay() {
	clearTimeout(searchHideTimeout);
	if (searchWin && !searchWin.isDestroyed()) {
		searchWin.webContents.send('search-hide');
		setTimeout(() => {
			if (searchWin && !searchWin.isDestroyed()) searchWin.hide();
		}, 350);
	}
}

const winW = 400;
const winH = 600;
let win = null;
let searchWin = null;
let searchHideTimeout = null;
let currentDisplayId = null;

function getBottomLeftPosition(display) {
	const { x, y, height } = display.bounds;
	return {
		x: x + 40,
		y: y + height - winH,
	};
}

function moveToDisplay(display) {
	if (!win || display.id === currentDisplayId) return;
	currentDisplayId = display.id;
	const pos = getBottomLeftPosition(display);
	win.setPosition(pos.x, pos.y, false);
}

function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const pos = getBottomLeftPosition(primaryDisplay);
	currentDisplayId = primaryDisplay.id;

	win = new BrowserWindow({
		width: winW,
		height: winH,
		x: pos.x,
		y: pos.y,
		transparent: true,
		frame: false,
		hasShadow: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		focusable: false,
		webPreferences: {
			webgl: true,
			webSecurity: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	win.setIgnoreMouseEvents(true, { forward: true });
	win.loadFile('index.html');

	// Forward renderer console to main process stdout
	win.webContents.on('console-message', (ev) => {
		if (ev.message.startsWith('[Vocab]') || ev.message.startsWith('[Voice]'))
			console.log(ev.message);
	});

	// Poll cursor position to follow it across displays
	setInterval(() => {
		const cursor = screen.getCursorScreenPoint();
		const display = screen.getDisplayNearestPoint(cursor);
		moveToDisplay(display);
	}, 500);
}

// --- Auto vocabulary from clipboard & window titles ---
const os = require('os');
const IRIS_DIR = path.join(os.homedir(), '.iris');
// Ensure ~/.iris/ exists
try { fs.mkdirSync(IRIS_DIR, { recursive: true }); } catch {}

const vocabPath = path.join(IRIS_DIR, 'vocabulary.json');
const hotVocabPath = path.join(IRIS_DIR, 'vocabulary-hot.json');
const vocabStatsPathIris = path.join(IRIS_DIR, 'vocabulary-stats.json');

const HOT_PROMOTE_COUNT = 5;   // promote to all after N sightings
const HOT_EXPIRE_MS = 3600000; // expire from hot after 1 hour unseen

// Sync corrections & core from source into ~/.iris/vocabulary.json if missing
const srcVocabPath = path.join(__dirname, 'vocabulary.json');
try {
	const src = JSON.parse(fs.readFileSync(srcVocabPath, 'utf-8'));
	let dest;
	try { dest = JSON.parse(fs.readFileSync(vocabPath, 'utf-8')); } catch { dest = { terms: [] }; }
	let changed = false;
	if (src.corrections && !dest.corrections) { dest.corrections = src.corrections; changed = true; }
	if (src.core && !dest.core) { dest.core = src.core; changed = true; }
	if (changed) fs.writeFileSync(vocabPath, JSON.stringify(dest, null, '\t') + '\n', 'utf-8');
} catch {}

function loadVocabTerms() {
	try {
		return JSON.parse(fs.readFileSync(vocabPath, 'utf-8')).terms || [];
	} catch { return []; }
}

function loadHotVocab() {
	try { return JSON.parse(fs.readFileSync(hotVocabPath, 'utf-8')); } catch { return {}; }
}

function saveHotVocab(hot) {
	try { fs.writeFileSync(hotVocabPath, JSON.stringify(hot, null, '\t') + '\n', 'utf-8'); } catch {}
}

function addVocabTerm(term) {
	// Skip if already in permanent vocab
	const allTerms = loadVocabTerms();
	if (allTerms.some(t => t.toLowerCase() === term.toLowerCase())) return false;

	// Add/update in hot vocab
	const hot = loadHotVocab();
	const now = new Date().toISOString();
	if (hot[term]) {
		hot[term].count++;
		hot[term].lastSeen = now;
	} else {
		hot[term] = { count: 1, firstSeen: now, lastSeen: now };
		console.log('[VocabHot] New hot term:', term);
	}
	saveHotVocab(hot);
	return true;
}

function promoteAndCleanHot() {
	const hot = loadHotVocab();
	const now = Date.now();
	let vocab;
	try { vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8')); } catch { vocab = { terms: [] }; }
	let changed = false;
	let vocabChanged = false;

	for (const [term, data] of Object.entries(hot)) {
		const lastSeen = new Date(data.lastSeen).getTime();
		const age = now - lastSeen;

		// Promote: high count
		if (data.count >= HOT_PROMOTE_COUNT) {
			if (!vocab.terms.includes(term)) {
				vocab.terms.push(term);
				vocabChanged = true;
				console.log('[VocabHot] Promoted to permanent:', term, `(${data.count}x)`);
			}
			delete hot[term];
			changed = true;
		}
		// Expire: not seen in 1 hour
		else if (age > HOT_EXPIRE_MS) {
			console.log('[VocabHot] Expired:', term);
			delete hot[term];
			changed = true;
		}
	}

	if (changed) saveHotVocab(hot);
	if (vocabChanged) fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
}

// --- Gemini Flash batch vocabulary extraction ---
let vocabBuffer = [];
let lastClipboard = '';
let lastWindowTitle = '';

async function extractTermsWithGemini(textChunks) {
	if (!textChunks.length || !apiKey) return [];
	const combined = textChunks.join('\n---\n').slice(0, 4000);
	const existing = [...loadVocabTerms(), ...Object.keys(loadHotVocab())];
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
			'- Max 10 terms total',
			existing.length ? `\nAlready known (skip these): ${existingList}` : '',
			'\nText:\n' + combined,
		].join('\n') }] }],
		generationConfig: { temperature: 0, maxOutputTokens: 256 },
	};

	try {
		const resp = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${apiKey}`,
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

function startVocabMonitors() {
	// Clipboard collector — every 5 seconds, buffers text
	setInterval(async () => {
		try {
			const result = await toolExecutor.execute('clipboard_read', {});
			const text = result?.result || '';
			if (text && text !== lastClipboard && text.length < 2000) {
				lastClipboard = text;
				vocabBuffer.push(text);
			}
		} catch {}
	}, 5000);

	// Window title collector — every 3 seconds, buffers text + detects messaging apps
	const MESSAGING_APPS = ['whatsapp', 'telegram', 'signal', 'messages', 'imessage', 'discord', 'slack', 'messenger'];
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
			const msgApp = MESSAGING_APPS.find(a => lower.includes(a)) || null;
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
	}, 3000);

	// Gemini Flash batch extraction — every 60 seconds
	setInterval(async () => {
		if (vocabBuffer.length === 0) return;
		const chunks = vocabBuffer.splice(0);
		const terms = await extractTermsWithGemini(chunks);
		for (const t of terms) addVocabTerm(t);
		console.log('[VocabAI] Batch:', chunks.length, 'chunks →', terms.length, 'terms:', terms.join(', '));
	}, 60000);

	// Promote/expire hot terms — every 60 seconds
	setInterval(() => promoteAndCleanHot(), 60000);
}

app.whenReady().then(async () => {
	// Request mic permission on macOS
	if (process.platform === 'darwin') {
		await systemPreferences.askForMediaAccess('microphone');
	}

	// Grant media permissions automatically
	session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
		if (permission === 'media') {
			callback(true);
		} else {
			callback(false);
		}
	});

	// Set mic input volume to max
	exec('osascript -e "set volume input volume 100"', () => {});

	createWindow();
	startVocabMonitors();

	// Ctrl+I toggles voice on/off
	globalShortcut.register('CommandOrControl+I', () => {
		if (win) win.webContents.send('toggle-voice');
	});

});

app.on('window-all-closed', () => {
	app.quit();
});
