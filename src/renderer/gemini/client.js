// WebSocket lifecycle + message parsing (no tool schemas)
import { Emitter } from '../../shared/emitter.js';
import { toolDeclarations } from './tool-declarations.js';
import { refreshVocabulary, buildPrioritizedVocab, buildCorrectionsPrompt, buildSystemInstruction } from './system-prompt.js';
import { info as logInfo, error as logError } from '../logger.js';

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
		this._reconnectTimer = null;
		this._connectId = 0; // guards against stale WS callbacks
	}

	async connect(apiKey) {
		this.apiKey = apiKey;
		this.retryCount = 0;
		this.maxRetries = 5;
		// Cancel any pending reconnect timer from a previous session
		clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
		await refreshVocabulary();
		try {
			this._skillDeclarations = await window.electronAPI.getSkillDeclarations();
			this._skillPrompts = await window.electronAPI.getSkillPrompts();
			this._skillCatalog = await window.electronAPI.getSkillCatalog();
		} catch {
			this._skillDeclarations = [];
			this._skillPrompts = [];
			this._skillCatalog = [];
		}
		this._connect();
	}

	_connect() {
		// Kill old WS without triggering its onclose→reconnect
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onerror = null;
			this.ws.onclose = null;
			try { this.ws.close(); } catch {}
			this.ws = null;
		}

		const id = ++this._connectId;
		const url = `${ENDPOINT}?key=${this.apiKey}`;
		logInfo('Gemini', `Connecting to ${ENDPOINT}...`);
		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			if (id !== this._connectId) return; // stale
			this.connected = true;
			this.retryCount = 0;
			this.emit('connected');
			this._sendSetup();
		};

		this.ws.onmessage = async (ev) => {
			if (id !== this._connectId) return;
			try {
				const text = ev.data instanceof Blob ? await ev.data.text() : ev.data;
				const msg = JSON.parse(text);
				this._handleMessage(msg);
			} catch (e) {
				logError('Gemini', 'Parse error:', e);
			}
		};

		this.ws.onerror = (err) => {
			if (id !== this._connectId) return;
			const errorMsg = err?.message || err?.code || JSON.stringify(err) || 'Unknown error';
			logError('Gemini', 'WebSocket error:', errorMsg);
			this.emit('error', err);
		};

		this.ws.onclose = (ev) => {
			if (id !== this._connectId) return; // stale WS — don't reconnect
			this.connected = false;
			this.sessionReady = false;
			logInfo('Gemini', `WebSocket closed: code=${ev.code}, reason=${ev.reason}`);
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
						endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
						prefixPaddingMs: 150,
						silenceDurationMs: 1000,
					},
				},
				outputAudioTranscription: {},
				inputAudioTranscription: {},
				tools: [{ functionDeclarations: [...toolDeclarations, ...(this._skillDeclarations || [])] }],
				systemInstruction: {
					parts: [{ text: buildSystemInstruction() + this._buildSkillSection() }],
				},
			},
		};
		this._send(setup);
	}

	_buildSkillSection() {
		let section = '';
		// Active skill prompts (skills with tools.json)
		if (this._skillPrompts?.length) {
			section += '\n\n' + this._skillPrompts.join('\n\n');
		}
		// Skill catalog (all skills, for use_skill discovery)
		if (this._skillCatalog?.length) {
			section += '\n\nINSTALLED SKILLS CATALOG (located at ~/.iris/skills/) — use the use_skill tool to load any skill\'s full instructions:\n';
			section += this._skillCatalog.map(s => `• ${s.name}: ${s.description}`).join('\n');
			section += '\nWhen the user asks for something that matches a skill, call use_skill with the skill name to get detailed instructions, then execute them using your existing tools. Skills are stored in ~/.iris/skills/<skill-name>/.';
		}
		return section;
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
		// Tool responses must always be sent (even if session dropped) to avoid
		// hanging the conversation. Log a warning if the socket isn't ready.
		if (!this.connected) {
			logError('Gemini', `sendToolResponse for "${name}" but WS not connected — response will be dropped`);
		}
		this._send({
			toolResponse: {
				functionResponses: [{
					id: callId,
					name,
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
		// Cancel any existing reconnect timer to prevent stacking
		clearTimeout(this._reconnectTimer);
		const delay = Math.min(this.retryDelay * Math.pow(2, this.retryCount), 30000);
		this.retryCount++;
		logInfo('Gemini', `Reconnecting in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this._connect();
		}, delay);
	}

	disconnect() {
		this.maxRetries = 0;
		clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
		this._connectId++; // invalidate any in-flight WS callbacks
		if (this.ws) {
			this.ws.onopen = null;
			this.ws.onmessage = null;
			this.ws.onerror = null;
			this.ws.onclose = null;
			try { this.ws.close(); } catch {}
			this.ws = null;
		}
		this.connected = false;
		this.sessionReady = false;
	}
}
