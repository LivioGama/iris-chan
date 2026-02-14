// Gemini Live WebSocket client
// Bidirectional audio streaming via Gemini 2.5 Flash native audio

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

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
						name: 'propose_reply',
						description: 'Type a reply into a messaging app input field. After typing, ask the user to confirm before pressing return to send.',
						parameters: { type: 'OBJECT', properties: { reply: { type: 'STRING' }, explanation: { type: 'STRING' } }, required: ['reply'] },
					},
				]}],
				systemInstruction: {
					parts: [{
						text: `You are Iris, a friendly and helpful AI assistant running on the user's Mac. You can see the user's screen and control their computer. You can type text, press keys, run terminal commands, open apps, and scroll. When the user asks you to do something on their computer, use the appropriate tool. You can also see the screen — describe what you see when asked. Keep responses concise and conversational. When using propose_reply, always explain what you're about to type and wait for confirmation before pressing return.`,
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
