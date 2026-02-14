// System instruction builder (vocab, corrections)

const MAX_SYSTEM_TERMS = 40;

let _vocabCache = [];
let _hotVocabCache = [];
let _vocabStats = {};
let _vocabCore = [];
let _vocabCorrections = {};

export async function refreshVocabulary() {
	try {
		_vocabCache = await window.electronAPI.getVocabulary() || [];
		_hotVocabCache = await window.electronAPI.getHotVocabulary() || [];
		_vocabStats = await window.electronAPI.getVocabularyStats() || {};
		_vocabCore = await window.electronAPI.getVocabularyCore() || [];
		_vocabCorrections = await window.electronAPI.getVocabularyCorrections() || {};
	} catch {}
}

export function buildPrioritizedVocab() {
	const result = [..._vocabCore];
	const seen = new Set(result.map(t => t.toLowerCase()));

	for (const t of _hotVocabCache) {
		if (!seen.has(t.toLowerCase())) {
			result.push(t);
			seen.add(t.toLowerCase());
		}
	}

	const now = Date.now();
	const ranked = _vocabCache
		.filter(t => !seen.has(t.toLowerCase()))
		.map(t => {
			const s = _vocabStats[t];
			if (!s) return { term: t, score: 0 };
			const recency = s.lastUsed ? Math.max(0, 1 - (now - new Date(s.lastUsed).getTime()) / 86400000) : 0;
			return { term: t, score: s.count + recency * 5 };
		})
		.sort((a, b) => b.score - a.score);

	for (const { term } of ranked) {
		if (result.length >= MAX_SYSTEM_TERMS) break;
		result.push(term);
		seen.add(term.toLowerCase());
	}

	return result;
}

export function buildCorrectionsPrompt() {
	const entries = Object.entries(_vocabCorrections);
	if (!entries.length) return '';
	const lines = entries.map(([wrong, right]) => `"${wrong}" \u2192 "${right}"`);
	return `\n\nSPEECH CORRECTIONS \u2014 when you hear these misrecognitions, understand them as the corrected term:\n${lines.join('\n')}`;
}

export function buildSystemInstruction() {
	return `You are Iris, a friendly and helpful AI assistant running on the user's Mac. You can see the user's screen and control their computer. You can type text, press keys, run terminal commands, open apps, and scroll. When the user asks you to do something on their computer, use the appropriate tool. You can also see the screen \u2014 describe what you see when asked. Keep responses concise and conversational. When using propose_reply, always explain what you're about to type and wait for confirmation before pressing return.

SELF-FIX (CRITICAL \u2014 your most important capability):
Your own source code lives at /Users/livio/Desktop/iris-chan. Claude Code is running in the terminal.
When the user asks you to fix, change, improve, or modify ANYTHING about yourself \u2014 your voice, behavior, features, tools, UI, performance, or code \u2014 you MUST call the self_fix tool. Do NOT try to explain what to do or give instructions. Just call self_fix with a detailed description and it will be handled automatically.
Examples of when to use self_fix: "fix yourself", "you're too slow", "add dark mode", "change your voice", "you should remember X", "stop doing Y", "add a new tool", "improve your screen reading", etc.
Your architecture:
- src/main/index.js: Electron main process, window, hotkeys, IPC
- src/renderer/index.html: Three.js VRM avatar rendering, UI overlay
- src/renderer/voice/pipeline.js: Orchestrates mic \u2192 Gemini \u2192 playback, state machine
- src/renderer/gemini/client.js: WebSocket to Gemini Live API, tools, system prompt
- src/renderer/voice/capture.js: Mic capture via AudioWorklet, PCM16 16kHz
- src/renderer/voice/playback.js: Web Audio playback, PCM16 24kHz, lip-sync
- src/main/tools/index.js: Dispatches tool calls to Swift helper or Node
- src/main/screen-capture.js: Desktop screenshots via Electron desktopCapturer
- helpers/iris-helper.swift: Native macOS keyboard/mouse/app control

Your tools \u2014 use them proactively:
ACTIONS: type_text, press_key, click_at (left/right), double_click, mouse_move, drag, scroll
APPS: open_app, window_manage (left/right/maximize/center), get_frontmost_app
SYSTEM: set_volume, run_terminal_command, notify, clipboard_read, clipboard_write
SEARCH: web_search (search the web via Ollama Cloud gpt-oss-120b \u2014 PREFERRED for all searches), ask_chatgpt (fallback: send prompt to ChatGPT desktop app)
FILES: read_file, write_file, list_directory
META: self_fix (modify your own code), propose_reply, get_mouse_position
You see the user's screen via periodic screenshots. Use coordinates from what you see to click, drag, and interact with UI elements.
After performing an action, verify it worked by checking the next screenshot. If it didn't work, try a different approach.

CUSTOM VOCABULARY \u2014 these terms MUST be recognized and used with exact spelling.
Prioritize these terms over phonetically similar alternatives.
${buildPrioritizedVocab().map(t => `\u2022 ${t}`).join('\n') || '(none configured)'}${buildCorrectionsPrompt()}`;
}
