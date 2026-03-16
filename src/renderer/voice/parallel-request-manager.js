import { Emitter } from '../../shared/emitter.js';
import { info as logInfo, error as logError } from '../logger.js';
import { showBubble, showStreamingBubble, finalizeStreamingBubble } from '../ui/bubbles.js';
import { toolDeclarations } from '../gemini/tool-declarations.js';

const FLASH_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const CLASSIFY_TIMEOUT_MS = 4000;
const DISPATCH_TIMEOUT_MS = 20000;
const MIN_WORDS_FOR_SEGMENTATION = 6;

// Convert Gemini Live tool declarations to REST API format
function toRestToolDeclarations() {
	return [{
		functionDeclarations: toolDeclarations.map(t => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		})),
	}];
}

export class ParallelRequestManager extends Emitter {
	constructor({ apiKey, gemini, onToolCall, onStateChange }) {
		super();
		this._apiKey = apiKey;
		this._gemini = gemini;
		this._onToolCall = onToolCall;
		this._onStateChange = onStateChange;
		this._responseQueue = [];
		this._pendingCount = 0;
		this._draining = false;
		this._parallelTurnId = 0;
		this._restToolDeclarations = toRestToolDeclarations();
	}

	/**
	 * Attempt parallel processing of a transcript.
	 * Returns true if parallel mode was activated (multiple segments found).
	 * Returns false if single segment — caller should use normal WebSocket flow.
	 */
	async processTranscript(transcript, { lastUserTurn, lastModelTurn } = {}) {
		if (!transcript || transcript.split(/\s+/).length < MIN_WORDS_FOR_SEGMENTATION) {
			return false;
		}

		let segments;
		try {
			segments = await this._classifySegments(transcript);
		} catch (err) {
			logError('Parallel', `Segmentation failed: ${err?.message || err}`);
			return false;
		}

		if (!segments || segments.length <= 1) {
			return false;
		}

		logInfo('Parallel', `Segmented into ${segments.length} requests: ${segments.map(s => s.summary).join(', ')}`);

		const turnId = ++this._parallelTurnId;
		this._pendingCount = segments.length;
		this._responseQueue = [];

		// Build conversation context from recent turns
		const context = [];
		if (lastUserTurn) context.push({ role: 'user', text: lastUserTurn });
		if (lastModelTurn) context.push({ role: 'model', text: lastModelTurn });

		// Dispatch all segments in parallel
		const promises = segments.map((seg, i) =>
			this._dispatchSegment(seg, i, turnId, context)
		);

		// Don't await — let responses stream in and drain as they complete
		Promise.allSettled(promises).then(() => {
			logInfo('Parallel', `All ${segments.length} parallel requests completed for turn ${turnId}`);
		});

		return true;
	}

	async _classifySegments(transcript) {
		const prompt = [
			'Analyze this user utterance. Does it contain multiple independent requests or questions?',
			'Rules:',
			'- Only segment truly independent requests (not multi-step instructions for one task)',
			'- If it\'s a single coherent request, return exactly one segment',
			'- summary should be a natural 2-5 word topic reference for the speaker to use (e.g., "the weather", "your calendar", "that joke")',
			'',
			`User utterance: ${transcript}`,
		].join('\n');

		const resp = await fetch(`${FLASH_ENDPOINT}?key=${this._apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: {
					temperature: 0,
					maxOutputTokens: 1024,
					responseMimeType: 'application/json',
					responseSchema: {
						type: 'OBJECT',
						properties: {
							segments: {
								type: 'ARRAY',
								items: {
									type: 'OBJECT',
									properties: {
										text: { type: 'STRING' },
										summary: { type: 'STRING' },
									},
									required: ['text', 'summary'],
								},
							},
						},
						required: ['segments'],
					},
				},
			}),
			signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
		});

		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

		const data = await resp.json();
		const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
		logInfo('Parallel', `Raw segmentation response: ${text}`);

		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			// Attempt JSON repair before giving up
			const repaired = this._repairJson(text);
			try {
				parsed = JSON.parse(repaired);
			} catch {
				logError('Parallel', 'Segmentation JSON unparseable after repair, falling back to single-request mode');
				return [];
			}
		}

		return Array.isArray(parsed?.segments) ? parsed.segments : [];
	}

	_repairJson(text) {
		let s = text;
		// Strip markdown code fences
		s = s.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
		// Remove single-line comments
		s = s.replace(/\/\/[^\n]*/g, '');
		// Remove multi-line comments
		s = s.replace(/\/\*[\s\S]*?\*\//g, '');
		// Remove trailing commas before ] or }
		s = s.replace(/,\s*([}\]])/g, '$1');
		// Extract outermost JSON object if there's surrounding text
		const match = s.match(/\{[\s\S]*\}/);
		return match ? match[0] : s;
	}

	async _dispatchSegment(segment, index, turnId, context) {
		const systemInstruction = [
			'You are Iris, a helpful voice AI assistant.',
			'The user asked multiple questions simultaneously. This is one of them.',
			'Begin your response with a brief natural reference to the topic so the user knows which question you\'re addressing.',
			`For example, start with something like "About ${segment.summary}, ..." or "To answer your question about ${segment.summary}, ..."`,
			'Keep your response concise and conversational — it will be spoken aloud.',
			'Do NOT use markdown, bullet points, or formatting. Speak naturally.',
		].join('\n');

		const contents = [];
		// Add conversation context
		for (const turn of context) {
			contents.push({
				role: turn.role,
				parts: [{ text: turn.text }],
			});
		}
		// Add the segmented user request
		contents.push({
			role: 'user',
			parts: [{ text: segment.text }],
		});

		const body = {
			systemInstruction: { parts: [{ text: systemInstruction }] },
			contents,
			tools: this._restToolDeclarations,
			generationConfig: {
				temperature: 0.7,
				maxOutputTokens: 500,
			},
		};

		try {
			const resp = await fetch(`${FLASH_ENDPOINT}?key=${this._apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
			});

			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

			const data = await resp.json();
			const candidate = data?.candidates?.[0];
			const parts = candidate?.content?.parts || [];

			// Extract text and tool calls
			let responseText = '';
			const toolCalls = [];
			for (const part of parts) {
				if (part.text) responseText += part.text;
				if (part.functionCall) {
					toolCalls.push({
						name: part.functionCall.name,
						args: part.functionCall.args || {},
					});
				}
			}

			if (turnId !== this._parallelTurnId) {
				logInfo('Parallel', `Stale response for turn ${turnId} (current: ${this._parallelTurnId}), dropping`);
				return;
			}

			const response = {
				index,
				summary: segment.summary,
				text: responseText.trim(),
				toolCalls,
				completedAt: Date.now(),
			};

			logInfo('Parallel', `Segment ${index} ("${segment.summary}") completed: ${responseText.length} chars, ${toolCalls.length} tool calls`);

			this._responseQueue.push(response);
			this._drainResponseQueue();
		} catch (err) {
			logError('Parallel', `Segment ${index} ("${segment.summary}") failed: ${err?.message || err}`);
			this._pendingCount--;
			// Show error bubble for this segment
			showBubble('chat', `Sorry, I couldn't process your question about ${segment.summary}.`, { role: 'iris' });
		}
	}

	_drainResponseQueue() {
		if (this._draining) return;
		this._draining = true;
		this._drainNext();
	}

	_drainNext() {
		if (this._responseQueue.length === 0) {
			this._draining = false;
			return;
		}

		// Sort by completion time — first finished, first spoken
		this._responseQueue.sort((a, b) => a.completedAt - b.completedAt);
		const response = this._responseQueue.shift();

		if (!response.text && response.toolCalls.length === 0) {
			this._drainNext();
			return;
		}

		// Execute any tool calls from this response
		if (response.toolCalls.length > 0) {
			this._executeParallelToolCalls(response);
		}

		if (response.text) {
			// Show the response as a bubble immediately
			const streamId = `stream-parallel-${response.index}`;
			showStreamingBubble('chat', response.text, streamId, { role: 'iris' });
			finalizeStreamingBubble(streamId, { minDurationMs: 4000 });

			// Feed the text to Gemini WebSocket for TTS
			// Use a special directive so Gemini speaks it naturally
			const speakDirective = [
				'[SYSTEM: SPEAK PARALLEL RESPONSE — read the following response naturally as if you just thought of it.',
				'Do NOT add any extra commentary, greetings, or meta-remarks. Just speak the response exactly.]',
				response.text,
			].join('\n');

			// Listen for turnComplete to drain next response
			const onTurnComplete = () => {
				this._gemini.off('turnComplete', onTurnComplete);
				// Small gap between responses for natural pacing
				setTimeout(() => this._drainNext(), 300);
			};
			this._gemini.on('turnComplete', onTurnComplete);

			this._gemini.sendText(speakDirective);
			logInfo('Parallel', `Speaking response ${response.index} ("${response.summary}")`);
		} else {
			// Tool-only response, move to next
			this._drainNext();
		}
	}

	_executeParallelToolCalls(response) {
		if (!this._onToolCall) return;
		// Format tool calls to match Gemini WebSocket format
		const calls = response.toolCalls.map((tc, i) => ({
			id: `parallel-${response.index}-${i}`,
			name: tc.name,
			args: tc.args,
		}));
		// Fire tool calls — they'll execute through the existing tool handler
		// Tool responses won't be sent back to REST (already have the text response)
		// but the side effects will execute
		try {
			this._onToolCall(calls);
		} catch (err) {
			logError('Parallel', `Tool execution failed for segment ${response.index}: ${err?.message || err}`);
		}
	}

	/**
	 * Cancel any in-progress parallel processing (e.g., on new user speech)
	 */
	cancel() {
		this._parallelTurnId++;
		this._responseQueue = [];
		this._pendingCount = 0;
		this._draining = false;
		logInfo('Parallel', 'Parallel processing cancelled');
	}

	get isActive() {
		return this._draining || this._responseQueue.length > 0;
	}
}
