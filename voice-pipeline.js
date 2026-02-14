// Voice pipeline: capture → Gemini → playback + debug UI

import { GeminiClient } from './gemini-client.js';
import { AudioCapture } from './audio-capture.js';
import { AudioPlayback } from './audio-playback.js';

const STATES = {
	IDLE: 'IDLE',
	LISTENING: 'LISTENING',
	USER_SPEAKING: 'USER_SPEAKING',
	PROCESSING: 'PROCESSING',
	RESPONDING: 'RESPONDING',
	TOOL_EXECUTING: 'TOOL_EXECUTING',
};

export class VoicePipeline {
	constructor() {
		this.gemini = new GeminiClient();
		this.capture = new AudioCapture();
		this.playback = new AudioPlayback();
		this.state = STATES.IDLE;
		this.volumeThreshold = 0.015;
		this.lastVolume = 0;
		this.userTranscript = '';
		this.modelTranscript = '';
		// Accumulation state for transcriptions
		this._accum = { user: '', model: '' };
		this._lastTranscriptTime = { user: 0, model: 0 };
		this._newTurnThresholdMs = 3000;
		this._active = false;
		this._apiKey = null;
		this._toolExecuting = false;
		this._screenInterval = null;
	}

	async start() {
		this._apiKey = await window.electronAPI.getApiKey();
		if (!this._apiKey || this._apiKey === 'YOUR_API_KEY_HERE') {
			this._updateStatus('No API key — set GEMINI_API_KEY in .env');
			return;
		}

		this._bindEvents();

		// Listen for Ctrl+I toggle
		window.electronAPI.onToggleVoice(() => this.toggle());

		await this._activate();
	}

	_bindEvents() {
		// Gemini events
		this.gemini.on('connected', () => {
			this._updateIndicator('ws', true);
			this._updateStatus('WebSocket connected, setting up...');
		});

		this.gemini.on('ready', async () => {
			this._updateStatus('Session ready — starting mic');
			try {
				await this.capture.start();
			} catch (err) {
				console.error('[Voice] Mic error:', err);
				this._updateStatus('Mic error: ' + err.message);
			}
			this._startScreenCapture();
		});

		this.gemini.on('disconnected', () => {
			this._updateIndicator('ws', false);
			this._updateIndicator('send', false);
			this._updateStatus('Disconnected');
			this._setState(STATES.IDLE);
		});

		this.gemini.on('error', (err) => {
			this._updateStatus('Error: ' + (err.message || 'WebSocket error'));
		});

		this.gemini.on('maxRetriesReached', () => {
			this._updateStatus('Max retries reached — reload to reconnect');
		});

		this.gemini.on('audio', (data) => {
			// First audio chunk of a response — reset user accumulator for next turn
			if (this.state !== STATES.RESPONDING) {
				this._accum.user = '';
			}
			this._setState(STATES.RESPONDING);
			this.playback.enqueue(data);
		});

		this.gemini.on('inputTranscription', (text) => {
			this._appendTranscript('user', text);
			this._updateIndicator('voice', true);
		});

		this.gemini.on('outputTranscription', (text) => {
			this._appendTranscript('model', text);
		});

		this.gemini.on('turnComplete', () => {
			this._setState(STATES.LISTENING);
			this._updateIndicator('think', false);
			// Mark turn boundary — next transcription from either side starts fresh
			this._accum.model = '';
		});

		this.gemini.on('interrupted', () => {
			this.playback.stop();
			this._setState(STATES.LISTENING);
		});

		this.gemini.on('toolCall', (calls) => this._handleToolCalls(calls));

		// Capture events
		this.capture.on('started', () => {
			this._updateIndicator('mic', true);
			this._updateIndicator('send', true);
			this._setState(STATES.LISTENING);
			this._updateStatus('Listening...');
		});

		this.capture.on('data', (base64) => {
			if (!this._toolExecuting) {
				this.gemini.sendAudio(base64);
			}
		});

		this.capture.on('volume', (vol) => {
			this.lastVolume = vol;
			if (vol > this.volumeThreshold && this.state === STATES.LISTENING) {
				this._setState(STATES.USER_SPEAKING);
			} else if (vol < this.volumeThreshold * 0.5 && this.state === STATES.USER_SPEAKING) {
				this._setState(STATES.PROCESSING);
			}
		});

		this.capture.on('stopped', () => {
			this._updateIndicator('mic', false);
			this._updateIndicator('send', false);
		});

		// Playback events
		this.playback.on('started', () => {
			this._updateIndicator('speak', true);
		});

		this.playback.on('ended', () => {
			this._updateIndicator('speak', false);
			if (this.state === STATES.RESPONDING) {
				this._setState(STATES.LISTENING);
			}
		});

		this.playback.on('stopped', () => {
			this._updateIndicator('speak', false);
		});
	}

	async toggle() {
		if (this._active) {
			this._deactivate();
		} else {
			await this._activate();
		}
	}

	async _activate() {
		this._active = true;
		this._updateStatus('Connecting...');
		await this.gemini.connect(this._apiKey);
	}

	_deactivate() {
		this._active = false;
		this._toolExecuting = false;
		this._stopScreenCapture();
		this.playback.stop();
		this.capture.stop();
		this.gemini.disconnect();
		this._setState(STATES.IDLE);
		// Reset all indicators
		for (const id of ['ws', 'mic', 'voice', 'send', 'think', 'speak', 'tool']) {
			this._updateIndicator(id, false);
		}
		// Hide bubbles
		document.getElementById('bubble-user')?.classList.remove('visible');
		document.getElementById('bubble-iris')?.classList.remove('visible');
		this._updateStatus('Voice off (Ctrl+I to enable)');
	}

	getSpeakingVolume() {
		return this.playback.getVolume();
	}

	_setState(state) {
		this.state = state;

		// Update indicators based on state
		this._updateIndicator('voice', state === STATES.USER_SPEAKING);
		this._updateIndicator('think', state === STATES.PROCESSING);
		this._updateIndicator('speak', state === STATES.RESPONDING);
	}

	_updateIndicator(id, active) {
		const el = document.getElementById(`dbg-${id}`);
		if (el) el.classList.toggle('active', active);
	}

	_updateStatus(text) {
		const el = document.getElementById('dbg-status');
		if (el) el.textContent = text;
	}

	_appendTranscript(who, chunk) {
		if (!chunk) return;
		const now = Date.now();
		const gap = now - this._lastTranscriptTime[who];

		// New turn: large time gap, or accumulator was reset
		if (gap > this._newTurnThresholdMs || !this._accum[who]) {
			this._accum[who] = chunk;
		} else {
			this._accum[who] += chunk;
		}
		this._lastTranscriptTime[who] = now;

		// Update DOM
		const el = document.getElementById(`dbg-${who}-text`);
		if (el) el.textContent = this._accum[who];

		const bubbleId = who === 'user' ? 'bubble-user' : 'bubble-iris';
		const bubble = document.getElementById(bubbleId);
		if (bubble) {
			bubble.classList.add('visible');
			const key = `_hide_${who}`;
			clearTimeout(this[key]);
			this[key] = setTimeout(() => bubble.classList.remove('visible'), 8000);
		}
	}

	async _handleToolCalls(calls) {
		this._setState(STATES.TOOL_EXECUTING);
		this._toolExecuting = true;
		this._updateIndicator('tool', true);

		for (const call of calls) {
			const { name, args, id } = call;
			try {
				const result = await window.electronAPI.executeTool(name, args);
				this.gemini.sendToolResponse(id, name, result.result || 'done');
			} catch (err) {
				this.gemini.sendToolResponse(id, name, 'Error: ' + err.message);
			}
		}

		await this._sendScreenFrame();

		this._toolExecuting = false;
		this._updateIndicator('tool', false);
		this._setState(STATES.LISTENING);
	}

	async _sendScreenFrame() {
		try {
			const capture = await window.electronAPI.captureScreen();
			if (capture?.ok && capture.data) {
				this.gemini.sendImage(capture.data);
			}
		} catch (err) {
			console.error('[Voice] Screen capture error:', err);
		}
	}

	_startScreenCapture() {
		this._stopScreenCapture();
		this._sendScreenFrame();
		this._screenInterval = setInterval(() => {
			if (!this._toolExecuting && this._active) {
				this._sendScreenFrame();
			}
		}, 3000);
	}

	_stopScreenCapture() {
		if (this._screenInterval) {
			clearInterval(this._screenInterval);
			this._screenInterval = null;
		}
	}
}
