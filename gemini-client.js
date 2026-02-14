// Gemini Live WebSocket client
// Bidirectional audio streaming via Gemini 2.5 Flash native audio

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// Vocabulary cache — loaded async from main process via IPC
let _vocabCache = [];
let _hotVocabCache = [];
let _vocabStats = {};
let _vocabCore = [];
let _vocabCorrections = {};

const MAX_SYSTEM_TERMS = 40;

async function refreshVocabulary() {
	try {
		_vocabCache = await window.electronAPI.getVocabulary() || [];
		_hotVocabCache = await window.electronAPI.getHotVocabulary() || [];
		_vocabStats = await window.electronAPI.getVocabularyStats() || {};
		_vocabCore = await window.electronAPI.getVocabularyCore() || [];
		_vocabCorrections = await window.electronAPI.getVocabularyCorrections() || {};
	} catch {}
}

function buildPrioritizedVocab() {
	// Core terms always included
	const result = [..._vocabCore];
	const seen = new Set(result.map(t => t.toLowerCase()));

	// Hot terms — high priority (context-relevant)
	for (const t of _hotVocabCache) {
		if (!seen.has(t.toLowerCase())) {
			result.push(t);
			seen.add(t.toLowerCase());
		}
	}

	// Rank remaining by stats (count * recency weight)
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

function buildCorrectionsPrompt() {
	const entries = Object.entries(_vocabCorrections);
	if (!entries.length) return '';
	const lines = entries.map(([wrong, right]) => `"${wrong}" → "${right}"`);
	return `\n\nSPEECH CORRECTIONS — when you hear these misrecognitions, understand them as the corrected term:\n${lines.join('\n')}`;
}

export class GeminiClient {
	constructor() {
		this.ws = null;
		this.apiKey = null;
		this.listeners = {};
		this.retryCount = 0;
		this.maxRetries = 5;
		this.retryDelay = 2000;
		this.connected = false;
		this.sessionReady = false;
	}

	on(event, fn) {
		(this.listeners[event] ||= []).push(fn);
	}

	emit(event, ...args) {
		(this.listeners[event] || []).forEach(fn => fn(...args));
	}

	async connect(apiKey) {
		this.apiKey = apiKey;
		this.retryCount = 0;
		await refreshVocabulary();
		this._connect();
	}

	_connect() {
		if (this.ws) {
			try { this.ws.close(); } catch {}
		}

		const url = `${ENDPOINT}?key=${this.apiKey}`;
		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.connected = true;
			this.retryCount = 0;
			this.emit('connected');
			this._sendSetup();
		};

		this.ws.onmessage = async (ev) => {
			try {
				const text = ev.data instanceof Blob ? await ev.data.text() : ev.data;
				const msg = JSON.parse(text);
				this._handleMessage(msg);
			} catch (e) {
				console.error('[Gemini] Parse error:', e);
			}
		};

		this.ws.onerror = (err) => {
			console.error('[Gemini] WebSocket error:', err);
			this.emit('error', err);
		};

		this.ws.onclose = (ev) => {
			this.connected = false;
			this.sessionReady = false;
			this.emit('disconnected', ev.code, ev.reason);
			this._tryReconnect();
		};
	}

	_sendSetup() {
		const setup = {
			setup: {
				model: MODEL,
				generationConfig: {
					responseModalities: ['AUDIO'],
					speechConfig: {
						voiceConfig: {
							prebuiltVoiceConfig: {
								voiceName: 'Kore',
							},
						},
					},
				},
				realtimeInputConfig: {
					automaticActivityDetection: {
						disabled: false,
						startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
						endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
						prefixPaddingMs: 10,
						silenceDurationMs: 200,
					},
				},
				outputAudioTranscription: {},
				inputAudioTranscription: {},
				tools: [{ functionDeclarations: [
					{
						name: 'type_text',
						description: 'Type text into the currently focused input field on the user\'s computer',
						parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
					},
					{
						name: 'press_key',
						description: 'Press a keyboard key or combo. Supported: return, space, escape, tab, delete, up, down, left, right, single letters a-z, or combos like cmd+c, ctrl+shift+a',
						parameters: { type: 'OBJECT', properties: { key: { type: 'STRING' } }, required: ['key'] },
					},
					{
						name: 'run_terminal_command',
						description: 'Run a shell command in the terminal and return the output',
						parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] },
					},
					{
						name: 'open_app',
						description: 'Open a macOS application by name (e.g. Safari, Finder, Terminal, Notes)',
						parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] },
					},
					{
						name: 'scroll',
						description: 'Scroll the current page or view up or down',
						parameters: { type: 'OBJECT', properties: { direction: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['direction'] },
					},
					{
						name: 'click_at',
						description: 'Click at screen coordinates. Use button "right" for right-click, default is left-click. Use the screenshot to estimate coordinates.',
						parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, button: { type: 'STRING' } }, required: ['x', 'y'] },
					},
					{
						name: 'double_click',
						description: 'Double-click at screen coordinates (e.g. to select a word or open a file).',
						parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
					},
					{
						name: 'mouse_move',
						description: 'Move the mouse cursor to screen coordinates without clicking.',
						parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
					},
					{
						name: 'drag',
						description: 'Drag from one point to another (e.g. to move a window, select text, or drag files).',
						parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, x2: { type: 'NUMBER' }, y2: { type: 'NUMBER' } }, required: ['x', 'y', 'x2', 'y2'] },
					},
					{
						name: 'get_mouse_position',
						description: 'Get the current mouse cursor position as x,y coordinates.',
						parameters: { type: 'OBJECT', properties: {} },
					},
					{
						name: 'clipboard_read',
						description: 'Read the current clipboard text content.',
						parameters: { type: 'OBJECT', properties: {} },
					},
					{
						name: 'clipboard_write',
						description: 'Write text to the clipboard.',
						parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
					},
					{
						name: 'web_search',
						description: 'Search the web using Ollama Cloud with gpt-oss-120b. Use this for any web search, research, looking up current information, facts, news, documentation, or answering questions that need up-to-date data. Returns a concise, structured summary of search results. Prefer this over ask_chatgpt for research.',
						parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The search query — be specific and descriptive' } }, required: ['query'] },
					},
					{
						name: 'ask_chatgpt',
						description: 'Send a prompt to the ChatGPT macOS desktop app and get a response. Fallback for complex multi-step research. For simple web searches, prefer the web_search tool instead.',
						parameters: { type: 'OBJECT', properties: { prompt: { type: 'STRING' } }, required: ['prompt'] },
					},
					{
						name: 'notify',
						description: 'Show a macOS notification to the user with a message.',
						parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
					},
					{
						name: 'propose_reply',
						description: 'Type a reply into a messaging app input field. After typing, ask the user to confirm before pressing return to send.',
						parameters: { type: 'OBJECT', properties: { reply: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ['reply'] },
					},
					{
						name: 'set_volume',
						description: 'Set the system audio volume. Level is 0.0 (mute) to 1.0 (max).',
						parameters: { type: 'OBJECT', properties: { level: { type: 'NUMBER' } }, required: ['level'] },
					},
					{
						name: 'get_frontmost_app',
						description: 'Get the name and window titles of the currently focused application.',
						parameters: { type: 'OBJECT', properties: {} },
					},
					{
						name: 'window_manage',
						description: 'Move/resize the frontmost window. Position: "left" (left half), "right" (right half), "maximize" (full screen), "center" (centered).',
						parameters: { type: 'OBJECT', properties: { position: { type: 'STRING' } }, required: ['position'] },
					},
					{
						name: 'read_file',
						description: 'Read the contents of a file at a given path. Returns the text content.',
						parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
					},
					{
						name: 'write_file',
						description: 'Write or overwrite a file at a given path with the provided content.',
						parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] },
					},
					{
						name: 'list_directory',
						description: 'List files and folders in a directory path.',
						parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
					},
					{
						name: 'manage_vocabulary',
						description: 'Manage custom vocabulary. Actions: "add" a term, "remove" a term, "list" all terms, "stats" to show usage counts (how many times each term appeared in conversation, sorted by frequency). Changes apply immediately.',
						parameters: { type: 'OBJECT', properties: {
							action: { type: 'STRING', description: '"add", "remove", "list", or "stats"' },
							term: { type: 'STRING', description: 'The word or phrase to add/remove' },
						}, required: ['action'] },
					},
					{
						name: 'self_fix',
						description: 'Fix, improve, or modify your own source code. Use this whenever the user asks you to change yourself, fix a bug in yourself, add a feature to yourself, or improve your behavior. This is your MOST IMPORTANT tool — if the user says anything like "fix yourself", "change your voice", "add a feature", "improve X", "you should do Y differently", "modify your code", or any request about changing how you work, call this tool IMMEDIATELY. You write a detailed prompt that gets sent to Claude Code which will edit your source files.',
						parameters: { type: 'OBJECT', properties: {
							description: { type: 'STRING', description: 'Detailed description of what to fix, change, or improve. Be specific about the current behavior and desired behavior.' },
							files_to_touch: { type: 'STRING', description: 'Comma-separated list of files likely involved. Choose from: gemini-client.js, voice-pipeline.js, audio-capture.js, audio-playback.js, tool-executor.js, screen-capture.js, main.js, index.html, helpers/iris-helper.swift' },
						}, required: ['description'] },
					},
				]}],
				systemInstruction: {
					parts: [{
						text: `You are Iris, a friendly and helpful AI assistant running on the user's Mac. You can see the user's screen and control their computer. You can type text, press keys, run terminal commands, open apps, and scroll. When the user asks you to do something on their computer, use the appropriate tool. You can also see the screen — describe what you see when asked. Keep responses concise and conversational. When using propose_reply, always explain what you're about to type and wait for confirmation before pressing return.

SELF-FIX (CRITICAL — your most important capability):
Your own source code lives at /Users/livio/Desktop/iris-chan. Claude Code is running in the terminal.
When the user asks you to fix, change, improve, or modify ANYTHING about yourself — your voice, behavior, features, tools, UI, performance, or code — you MUST call the self_fix tool. Do NOT try to explain what to do or give instructions. Just call self_fix with a detailed description and it will be handled automatically.
Examples of when to use self_fix: "fix yourself", "you're too slow", "add dark mode", "change your voice", "you should remember X", "stop doing Y", "add a new tool", "improve your screen reading", etc.
Your architecture:
- main.js: Electron main process, window, hotkeys, IPC
- index.html: Three.js VRM avatar rendering, UI overlay
- voice-pipeline.js: Orchestrates mic → Gemini → playback, state machine
- gemini-client.js: WebSocket to Gemini Live API, tools, system prompt
- audio-capture.js: Mic capture via AudioWorklet, PCM16 16kHz
- audio-playback.js: Web Audio playback, PCM16 24kHz, lip-sync
- tool-executor.js: Dispatches tool calls to Swift helper or Node
- screen-capture.js: Desktop screenshots via Electron desktopCapturer
- helpers/iris-helper.swift: Native macOS keyboard/mouse/app control

Your tools — use them proactively:
ACTIONS: type_text, press_key, click_at (left/right), double_click, mouse_move, drag, scroll
APPS: open_app, window_manage (left/right/maximize/center), get_frontmost_app
SYSTEM: set_volume, run_terminal_command, notify, clipboard_read, clipboard_write
SEARCH: web_search (search the web via Ollama Cloud gpt-oss-120b — PREFERRED for all searches), ask_chatgpt (fallback: send prompt to ChatGPT desktop app)
FILES: read_file, write_file, list_directory
META: self_fix (modify your own code), propose_reply, get_mouse_position
You see the user's screen via periodic screenshots. Use coordinates from what you see to click, drag, and interact with UI elements.
After performing an action, verify it worked by checking the next screenshot. If it didn't work, try a different approach.

CUSTOM VOCABULARY — these terms MUST be recognized and used with exact spelling.
Prioritize these terms over phonetically similar alternatives.
${buildPrioritizedVocab().map(t => `• ${t}`).join('\n') || '(none configured)'}${buildCorrectionsPrompt()}`,
					}],
				},
			},
		};
		this._send(setup);
	}

	_handleMessage(msg) {
		// Setup complete
		if (msg.setupComplete) {
			this.sessionReady = true;
			this.emit('ready');
			return;
		}

		// Input transcription (user speech)
		if (msg.serverContent?.inputTranscription?.text) {
			this.emit('inputTranscription', msg.serverContent.inputTranscription.text);
		}
		if (msg.inputTranscription?.text) {
			this.emit('inputTranscription', msg.inputTranscription.text);
		}

		// Output transcription (model speech)
		if (msg.serverContent?.outputTranscription?.text) {
			this.emit('outputTranscription', msg.serverContent.outputTranscription.text);
		}
		if (msg.outputTranscription?.text) {
			this.emit('outputTranscription', msg.outputTranscription.text);
		}

		// Audio data from model
		if (msg.serverContent?.modelTurn?.parts) {
			for (const part of msg.serverContent.modelTurn.parts) {
				if (part.inlineData?.data) {
					this.emit('audio', part.inlineData.data);
				}
				if (part.text) {
					this.emit('text', part.text);
				}
			}
		}

		// Turn complete
		if (msg.serverContent?.turnComplete) {
			this.emit('turnComplete');
		}

		// Interrupted (barge-in)
		if (msg.serverContent?.interrupted) {
			this.emit('interrupted');
		}

		// Tool calls from Gemini
		if (msg.toolCall?.functionCalls) {
			this.emit('toolCall', msg.toolCall.functionCalls);
		}
	}

	sendAudio(base64Data) {
		if (!this.sessionReady) return;
		this._send({
			realtimeInput: {
				mediaChunks: [{
					mimeType: 'audio/pcm;rate=16000',
					data: base64Data,
				}],
			},
		});
	}

	sendToolResponse(callId, name, result) {
		this._send({
			toolResponse: {
				functionResponses: [{
					id: callId,
					name: name,
					response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
				}],
			},
		});
	}

	sendText(text) {
		if (!this.sessionReady) return;
		this._send({
			clientContent: {
				turns: [{ role: 'user', parts: [{ text }] }],
				turnComplete: true,
			},
		});
	}

	async sendVocabUpdate() {
		if (!this.sessionReady) return;
		await refreshVocabulary();
		const terms = buildPrioritizedVocab();
		const corrections = buildCorrectionsPrompt();
		this.sendText(`[SYSTEM: VOCABULARY UPDATE — do not read this aloud, just acknowledge internally]\nUpdated vocabulary:\n${terms.map(t => `• ${t}`).join('\n')}${corrections}`);
	}

	sendImage(base64Jpeg) {
		if (!this.sessionReady) return;
		this._send({
			realtimeInput: {
				mediaChunks: [{
					mimeType: 'image/jpeg',
					data: base64Jpeg,
				}],
			},
		});
	}

	_send(obj) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(obj));
		}
	}

	_tryReconnect() {
		if (this.retryCount >= this.maxRetries) {
			this.emit('maxRetriesReached');
			return;
		}
		const delay = Math.min(this.retryDelay * Math.pow(2, this.retryCount), 30000);
		this.retryCount++;
		console.log(`[Gemini] Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
		setTimeout(() => this._connect(), delay);
	}

	disconnect() {
		this.maxRetries = 0; // prevent reconnection
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		this.sessionReady = false;
	}
}
