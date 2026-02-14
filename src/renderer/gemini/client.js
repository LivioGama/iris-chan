// WebSocket lifecycle + message parsing (no tool schemas)
import { Emitter } from '../../shared/emitter.js';
import { toolDeclarations } from './tool-declarations.js';
import { refreshVocabulary, buildPrioritizedVocab, buildCorrectionsPrompt, buildSystemInstruction } from './system-prompt.js';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

export class GeminiClient extends Emitter {
	constructor() {
		super();
		this.ws = null;
		this.apiKey = null;
		this.retryCount = 0;
		this.maxRetries = 5;
		this.retryDelay = 2000;
		this.connected = false;
		this.sessionReady = false;
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
				tools: [{ functionDeclarations: toolDeclarations }],
				systemInstruction: {
					parts: [{ text: buildSystemInstruction() }],
				},
			},
		};
		this._send(setup);
	}

	_handleMessage(msg) {
		if (msg.setupComplete) {
			this.sessionReady = true;
			this.emit('ready');
			return;
		}

		if (msg.serverContent?.inputTranscription?.text) {
			this.emit('inputTranscription', msg.serverContent.inputTranscription.text);
		}
		if (msg.inputTranscription?.text) {
			this.emit('inputTranscription', msg.inputTranscription.text);
		}

		if (msg.serverContent?.outputTranscription?.text) {
			this.emit('outputTranscription', msg.serverContent.outputTranscription.text);
		}
		if (msg.outputTranscription?.text) {
			this.emit('outputTranscription', msg.outputTranscription.text);
		}

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

		if (msg.serverContent?.turnComplete) {
			this.emit('turnComplete');
		}

		if (msg.serverContent?.interrupted) {
			this.emit('interrupted');
		}

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
		this.sendText(`[SYSTEM: VOCABULARY UPDATE \u2014 do not read this aloud, just acknowledge internally]\nUpdated vocabulary:\n${terms.map(t => `\u2022 ${t}`).join('\n')}${corrections}`);
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
		this.maxRetries = 0;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		this.sessionReady = false;
	}
}
