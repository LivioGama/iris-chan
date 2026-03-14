// WebSocket lifecycle + message parsing (no tool schemas)
import { Emitter } from '../../shared/emitter.js';
import { toolDeclarations } from './tool-declarations.js';
import { refreshVocabulary, refreshRecentObservations, buildPrioritizedVocab, buildCorrectionsPrompt, buildSystemInstruction } from './system-prompt.js';
import { buildRecentSeenPrompt } from '../vocab/recent-seen-store.js';
import { info as logInfo, warn as logWarn, error as logError } from '../logger.js';

const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const LOW_LATENCY_ACTIVITY_DETECTION = {
	disabled: false,
	startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
	endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
	prefixPaddingMs: 20,
	silenceDurationMs: 140,
};
const MAX_SKILL_SECTION_CHARS = 12000;
const MAX_SKILL_CATALOG_ENTRIES = 40;
const SYSTEM_PROMPT_VERSION = 'speed-scientific-v1';
const DEFAULT_SETUP_MAX_SYSTEM_CHARS = Number.parseInt(globalThis.process?.env?.IRIS_GEMINI_SETUP_MAX_SYSTEM_CHARS || '24000', 10);
const COMPACT_SETUP_MAX_SYSTEM_CHARS = Number.parseInt(globalThis.process?.env?.IRIS_GEMINI_SETUP_COMPACT_SYSTEM_CHARS || '14000', 10);
const DEFAULT_SETUP_MAX_PAYLOAD_CHARS = Number.parseInt(globalThis.process?.env?.IRIS_GEMINI_SETUP_MAX_PAYLOAD_CHARS || '45000', 10);
const INBOUND_MESSAGE_BATCH_SIZE = Math.max(1, Number.parseInt(globalThis.process?.env?.IRIS_GEMINI_INBOUND_BATCH_SIZE || '24', 10));
const SETUP_FALLBACK_PROFILES = Object.freeze([
	Object.freeze({
		label: 'full',
		includeSkillDeclarations: true,
		maxSystemInstructionChars: DEFAULT_SETUP_MAX_SYSTEM_CHARS,
	}),
	Object.freeze({
		label: 'no-custom-voice',
		includeSkillDeclarations: true,
		maxSystemInstructionChars: DEFAULT_SETUP_MAX_SYSTEM_CHARS,
	}),
	Object.freeze({
		label: 'core-tools-only',
		includeSkillDeclarations: false,
		maxSystemInstructionChars: DEFAULT_SETUP_MAX_SYSTEM_CHARS,
	}),
	Object.freeze({
		label: 'compact-system-instruction',
		includeSkillDeclarations: false,
		maxSystemInstructionChars: Math.min(DEFAULT_SETUP_MAX_SYSTEM_CHARS, COMPACT_SETUP_MAX_SYSTEM_CHARS),
	}),
]);
const SELF_FIX_PREAMBLE_PATTERNS = [
	/^(?:ok(?:ay)?|sure|alright|fine)[, ]+(?:go ahead|continue|tell me|let'?s hear it)\.?$/i,
	/^(?:go ahead|continue|keep going|tell me|say it|i'?m listening|i am listening|i'?m ready|i am ready|ready)\.?$/i,
	/^(?:hold on|wait|one sec|one second|hang on|let me explain|hear me out|listen up)\.?$/i,
	/^(?:i(?:'m| am)? going to|i(?:'m| am)? about to|i want to|i need to) (?:change|fix|modify|update|improve) (?:you|iris|yourself|your behavior|your idle behavior|your voice)\.?$/i,
	/^(?:we need to|i need to) talk about changing (?:you|your behavior|your idle behavior|your voice)\.?$/i,
];
const SELF_FIX_ACTION_PATTERNS = [
	/\b(?:change|fix|modify|update|improve|stop|start|add|remove|rewrite|adjust|enforce)\b/i,
];
const SELF_FIX_TARGET_PATTERNS = [
	/\b(?:you|yourself|iris|your|voice|behavior|instructions|memory|prompt|tool|tools|ui|speech|responses?|idle behavior|silence)\b/i,
];
const SELF_FIX_DETAIL_PATTERNS = [
	/\b(?:because|when|after|before|instead of|so that|followed by|unless|until|prevent|ensure|should|must|never|always)\b/i,
	/\b(?:problem|desired behavior|implementation|files?)\s*:/i,
	/\b(?:voice|behavior|instructions|memory|prompt|tool|tools|ui|speech|response|responses|restart|screen|transcript|idle|silence)\b/i,
];
const MANAGEMENT_CORRECTION_MARKER = '[SYSTEM: MANAGEMENT CORRECTION';
const MANAGEMENT_TASK_ID_PATTERN = /#?([a-f0-9]{8,})/ig;
const DEFAULT_BEHAVIOR_STATE = Object.freeze({
	mode: 'silent',
	proactiveSuggestionsEnabled: true,
	directMode: false,
	feedbackEnabled: false,
	introversionEnabled: false,
});

function normalizeSelfFixUtterance(text = '') {
	return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripSelfFixPunctuation(text = '') {
	return normalizeSelfFixUtterance(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
}

function splitManagementTaskIds(value = '') {
	return Array.from(
		new Set(
			Array.from(String(value || '').matchAll(MANAGEMENT_TASK_ID_PATTERN))
				.map((match) => String(match[1] || '').toLowerCase())
				.filter(Boolean)
		)
	);
}

function parseManagementCorrections(text = '') {
	const rawText = String(text || '');
	if (!rawText.trim()) return null;
	const normalized = normalizeSelfFixUtterance(rawText).toLowerCase();
	const signalsManagementCorrection = [
		'agent-relay',
		'management correction',
		'management corrections',
		'execution wave',
		'restaff',
		'approve the first execution wave',
		'cancel cosmetic',
		'memory lane',
		'safety lane',
		'observability lane',
		'research lane',
	].some((signal) => normalized.includes(signal));
	if (!signalsManagementCorrection) return null;

	const cancellations = Array.from(rawText.matchAll(/cancel(?:led|s|ling)?[^.\n]*?task\s+#?([a-f0-9]{8,})/ig))
		.map((match) => ({
			taskId: String(match[1] || '').toLowerCase(),
			reason: /cosmetic/i.test(match[0]) ? 'cosmetic task explicitly cancelled by management correction' : 'explicitly cancelled by management correction',
		}))
		.filter((entry) => entry.taskId);

	const approvals = [];
	for (const match of rawText.matchAll(/([a-z][a-z0-9_-]*eng)\s*\(([^)]+)\)/ig)) {
		const agent = String(match[1] || '').toLowerCase();
		const taskIds = splitManagementTaskIds(match[2]);
		if (!agent || !taskIds.length) continue;
		approvals.push({ agent, taskIds });
	}

	if (!cancellations.length && !approvals.length) return null;
	return {
		cancellations,
		approvals,
		preserveExecutionCritical: /preserve execution-critical tasks/i.test(rawText),
		prioritizeP0: /\bp0\b/i.test(rawText) || /execution-critical/i.test(rawText),
		requireExactSequence: /exactly as listed/i.test(rawText) || /correct sequencing/i.test(rawText),
	};
}

function buildManagementCorrectionsNote(parsed) {
	if (!parsed) return '';
	const lines = ['[SYSTEM: MANAGEMENT CORRECTION — preserve exact task ids/assignments from the user text]'];
	if (parsed.preserveExecutionCritical) lines.push('- preserve execution-critical tasks');
	if (parsed.prioritizeP0) lines.push('- prioritize p0 planning lanes, including memory/safety/research-observability coverage');
	if (parsed.requireExactSequence) lines.push('- execute first-wave approvals exactly as listed');
	for (const cancellation of parsed.cancellations || []) {
		lines.push(`- cancel task ${cancellation.taskId}: ${cancellation.reason}`);
	}
	for (const approval of parsed.approvals || []) {
		lines.push(`- approve tasks for ${approval.agent}: ${approval.taskIds.join(', ')}`);
	}
	lines.push('[SYSTEM: treat this as binding planning/dispatch input, not a summary target]');
	return lines.join('\n');
}

function augmentTextWithManagementCorrections(text = '') {
	const value = String(text || '');
	if (!value || value.startsWith('[SYSTEM:') || value.includes(MANAGEMENT_CORRECTION_MARKER)) {
		return value;
	}
	const parsed = parseManagementCorrections(value);
	if (!parsed) return value;
	return `${value}\n\n${buildManagementCorrectionsNote(parsed)}`;
}

export function classifySelfFixRequest(text = '', { awaitingDetails = false } = {}) {
	const normalized = normalizeSelfFixUtterance(text);
	if (!normalized) {
		return { kind: 'none', normalizedText: '', detailSignals: 0 };
	}

	const plain = stripSelfFixPunctuation(normalized);
	if (!plain) {
		return { kind: 'none', normalizedText: normalized, detailSignals: 0 };
	}

	const isPreamble = SELF_FIX_PREAMBLE_PATTERNS.some((pattern) => pattern.test(normalized));
	const hasAction = SELF_FIX_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
	const hasTarget = SELF_FIX_TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
	const detailSignals = SELF_FIX_DETAIL_PATTERNS.reduce(
		(count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
		0,
	);
	const longEnough = plain.length >= 40 || normalized.split(/\s+/).length >= 8;

	if (isPreamble) {
		return { kind: 'intent_preamble', normalizedText: normalized, detailSignals };
	}

	if (awaitingDetails && !longEnough) {
		return { kind: 'intent_preamble', normalizedText: normalized, detailSignals };
	}

	if (hasAction && hasTarget && (detailSignals >= 2 || longEnough)) {
		return { kind: 'specific_change', normalizedText: normalized, detailSignals };
	}

	if (awaitingDetails && hasAction && hasTarget) {
		return { kind: detailSignals >= 1 ? 'specific_change' : 'intent_preamble', normalizedText: normalized, detailSignals };
	}

	return { kind: 'none', normalizedText: normalized, detailSignals };
}

function parseClaudeCodeStatus(text) {
	const value = String(text || '');
	const updateMatch = value.match(/^\[CLAUDE CODE UPDATE — ([^\]]+)\]/);
	if (updateMatch) {
		return { kind: 'update', taskId: updateMatch[1] };
	}
	const finishedMatch = value.match(/^\[CLAUDE CODE FINISHED — ([^\]]+)\]/);
	if (finishedMatch) {
		return { kind: 'finished', taskId: finishedMatch[1] };
	}
	return null;
}

function appendWithinBudget(baseText = '', block = '', budget = MAX_SKILL_SECTION_CHARS) {
	if (!block) return baseText;
	if (!baseText) return block.slice(0, budget);
	const remaining = Math.max(0, budget - baseText.length - 2);
	if (!remaining) return baseText;
	return `${baseText}\n\n${block.slice(0, remaining)}`;
}

function fingerprintText(value = '') {
	const text = String(value || '');
	let hash = 0;
	for (let index = 0; index < text.length; index += 1) {
		hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
	}
	return `${text.length}:${hash.toString(16)}`;
}

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
		this._behaviorState = { ...DEFAULT_BEHAVIOR_STATE };
		this._cachedSetupPayload = null;
		this._cachedSetupPayloadJson = '';
		this._cachedSetupKey = '';
		this._cachedSkillSection = '';
		this._cachedSystemInstruction = '';
		this._cachedSystemInstructionKey = '';
		this._voiceName = null;
		this._setupFallbackLevel = 0;
		this._inboundQueue = [];
		this._inboundDrainScheduled = false;
	}

	setDirectMode(enabled) {
		this.setBehaviorState({ ...this._behaviorState, directMode: !!enabled });
	}

	setAutonomousMode(enabled) {
		this.setBehaviorState({
			...this._behaviorState,
			mode: enabled ? 'proactive' : 'silent',
		});
	}

	setBehaviorState(nextState = {}) {
		const nextMode = ['silent', 'passive', 'proactive'].includes(nextState.mode)
			? nextState.mode
			: this._behaviorState.mode;
		this._behaviorState = {
			mode: nextMode,
			proactiveSuggestionsEnabled: nextState.proactiveSuggestionsEnabled !== false,
			directMode: !!nextState.directMode,
			feedbackEnabled: !!nextState.feedbackEnabled,
			introversionEnabled: !!nextState.introversionEnabled,
		};
		this._invalidateSetupCache();
	}

	setVoiceName(voiceName) {
		const normalized = String(voiceName || '').trim();
		this._voiceName = normalized || null;
		this._invalidateSetupCache();
	}

	async connect(apiKey) {
		this.apiKey = apiKey;
		this.retryCount = 0;
		this.maxRetries = 5;
		this._setupFallbackLevel = 0;
		// Cancel any pending reconnect timer from a previous session
		clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
		await this._loadSetupResources();
		this._connect();
	}

	async _loadSetupResources() {
		const [
			vocabRefresh,
			skillDeclarations,
			skillPrompts,
			skillCatalog,
		] = await Promise.allSettled([
			refreshVocabulary().then(() => refreshRecentObservations()),
			window.electronAPI.getSkillDeclarations(),
			window.electronAPI.getSkillPrompts(),
			window.electronAPI.getSkillCatalog(),
		]);
		if (vocabRefresh.status === 'rejected') {
			logWarn('Gemini', `Vocabulary refresh failed before connect: ${vocabRefresh.reason?.message || vocabRefresh.reason || 'unknown error'}`);
		}
		this._skillDeclarations = skillDeclarations.status === 'fulfilled' ? skillDeclarations.value : [];
		this._skillPrompts = skillPrompts.status === 'fulfilled' ? skillPrompts.value : [];
		this._skillCatalog = skillCatalog.status === 'fulfilled' ? skillCatalog.value : [];
		this._cachedSkillSection = this._buildSkillSection();
		this._invalidateSetupCache();
	}

	_invalidateSetupCache() {
		this._cachedSetupPayload = null;
		this._cachedSetupPayloadJson = '';
		this._cachedSetupKey = '';
		this._cachedSystemInstruction = '';
		this._cachedSystemInstructionKey = '';
	}

	_getSystemInstruction() {
		const systemInstructionKey = JSON.stringify({
			version: SYSTEM_PROMPT_VERSION,
			behaviorState: this._behaviorState,
			skillFingerprint: fingerprintText(this._cachedSkillSection),
		});
		if (this._cachedSystemInstruction && this._cachedSystemInstructionKey === systemInstructionKey) {
			return this._cachedSystemInstruction;
		}
		const nextInstruction = `${buildSystemInstruction({
			behaviorState: this._behaviorState,
		})}${this._cachedSkillSection}`;
		this._cachedSystemInstruction = nextInstruction;
		this._cachedSystemInstructionKey = systemInstructionKey;
		return nextInstruction;
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
				this._enqueueInboundMessage(text);
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
			if (this._shouldDegradeSetupOnClose(ev)) {
				this._applyInvalidArgumentFallback(ev.reason);
			}
			this.emit('disconnected', ev.code, ev.reason);
			this._tryReconnect();
		};
	}

	_sendSetup() {
		this._send(this._getSerializedSetupPayload());
	}

	_getSetupPayload() {
		return this._getSetupPayloadBundle().payload;
	}

	_getSerializedSetupPayload() {
		return this._getSetupPayloadBundle().serialized;
	}

	_getSetupPayloadBundle() {
		const setupKey = JSON.stringify({
			behaviorState: this._behaviorState,
			setupFallbackLevel: this._setupFallbackLevel,
			skillDeclarations: Array.isArray(this._skillDeclarations)
				? this._skillDeclarations.length
				: 0,
			skillSectionFingerprint: fingerprintText(this._cachedSkillSection),
			systemPromptVersion: SYSTEM_PROMPT_VERSION,
		});
		if (this._cachedSetupPayload && this._cachedSetupPayloadJson && this._cachedSetupKey === setupKey) {
			return {
				payload: this._cachedSetupPayload,
				serialized: this._cachedSetupPayloadJson,
			};
		}

		let nextLevel = this._setupFallbackLevel;
		let fallbackProfile = this._getSetupFallbackProfile(nextLevel);
		let setup = null;
		let serialized = '';
		do {
			fallbackProfile = this._getSetupFallbackProfile(nextLevel);
			setup = this._buildSetupPayload(fallbackProfile);
			serialized = JSON.stringify(setup);
			if (serialized.length <= DEFAULT_SETUP_MAX_PAYLOAD_CHARS || nextLevel >= SETUP_FALLBACK_PROFILES.length - 1) {
				break;
			}
			nextLevel += 1;
			logWarn('Gemini', `Setup payload estimated at ${serialized.length} chars; degrading to ${this._getSetupFallbackProfile(nextLevel).label} profile before connect`);
		} while (true);
		if (nextLevel !== this._setupFallbackLevel) {
			this._setupFallbackLevel = nextLevel;
		}
		this._cachedSetupPayload = setup;
		this._cachedSetupPayloadJson = serialized;
		this._cachedSetupKey = JSON.stringify({
			behaviorState: this._behaviorState,
			setupFallbackLevel: this._setupFallbackLevel,
			skillDeclarations: Array.isArray(this._skillDeclarations)
				? this._skillDeclarations.length
				: 0,
			skillSectionFingerprint: fingerprintText(this._cachedSkillSection),
			systemPromptVersion: SYSTEM_PROMPT_VERSION,
		});
		return { payload: setup, serialized };
	}

	_buildSetupPayload(fallbackProfile = this._getSetupFallbackProfile()) {
		const generationConfig = {
			responseModalities: ['AUDIO'],
		};
		if (this._voiceName && fallbackProfile.label === 'full') {
			generationConfig.speechConfig = {
				voiceConfig: {
					prebuiltVoiceConfig: {
						voiceName: this._voiceName,
					},
				},
			};
		}
		const functionDeclarations = [
			...toolDeclarations,
			...(fallbackProfile.includeSkillDeclarations ? (this._skillDeclarations || []) : []),
		];
		return {
			setup: {
				model: MODEL,
				generationConfig,
				realtimeInputConfig: {
					activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
					automaticActivityDetection: LOW_LATENCY_ACTIVITY_DETECTION,
				},
				outputAudioTranscription: {},
				inputAudioTranscription: {},
				tools: [{ functionDeclarations }],
				systemInstruction: {
					parts: [{ text: this._getTrimmedSystemInstruction(fallbackProfile) }],
				},
			},
		};
	}

	_getSetupFallbackProfile(level = this._setupFallbackLevel) {
		return SETUP_FALLBACK_PROFILES[Math.min(Math.max(level, 0), SETUP_FALLBACK_PROFILES.length - 1)];
	}

	_getTrimmedSystemInstruction(profile = this._getSetupFallbackProfile()) {
		const fullInstruction = this._getSystemInstruction();
		const budget = Math.max(4000, Number(profile?.maxSystemInstructionChars || DEFAULT_SETUP_MAX_SYSTEM_CHARS));
		if (fullInstruction.length <= budget) return fullInstruction;
		const trimmed = `${fullInstruction.slice(0, Math.max(0, budget - 29)).trimEnd()}\n\n[system instruction truncated]`;
		logWarn('Gemini', `Trimmed system instruction from ${fullInstruction.length} to ${trimmed.length} chars for ${profile?.label || 'unknown'} setup profile`);
		return trimmed;
	}

	_shouldDegradeSetupOnClose(ev) {
		return ev?.code === 1007 && /invalid argument/i.test(String(ev?.reason || ''));
	}

	_applyInvalidArgumentFallback(reason = '') {
		if (this._setupFallbackLevel >= SETUP_FALLBACK_PROFILES.length - 1) {
			logWarn('Gemini', `Invalid-argument close persisted after all setup fallbacks. reason=${reason || 'unknown'}`);
			return false;
		}
		this._setupFallbackLevel += 1;
		this._invalidateSetupCache();
		const profile = this._getSetupFallbackProfile();
		logWarn('Gemini', `Invalid-argument close detected. Retrying with ${profile.label} setup profile. reason=${reason || 'unknown'}`);
		return true;
	}

	_buildSkillSection() {
		let section = '';
		let truncated = false;
		// Active skill prompts (skills with tools.json)
		if (this._skillPrompts?.length) {
			const promptBlock = this._skillPrompts.join('\n\n');
			const nextSection = appendWithinBudget(section, promptBlock, MAX_SKILL_SECTION_CHARS);
			truncated = truncated || nextSection.length < section.length + promptBlock.length + (section ? 2 : 0);
			section = nextSection;
		}
		// Skill catalog (all skills, for use_skill discovery)
		if (this._skillCatalog?.length) {
			const catalogHeader = 'INSTALLED SKILLS CATALOG (located at ~/.iris/skills/) — use the use_skill tool to load any skill\'s full instructions:\n';
			const catalogEntries = this._skillCatalog
				.slice(0, MAX_SKILL_CATALOG_ENTRIES)
				.map((s) => `• ${s.name}: ${s.description}`)
				.join('\n');
			const catalogFooter = '\nWhen the user asks for something that matches a skill, call use_skill with the skill name to get detailed instructions, then execute them using your existing tools. Skills are stored in ~/.iris/skills/<skill-name>/.';
			const catalogBlock = `${catalogHeader}${catalogEntries}${catalogFooter}`;
			const nextSection = appendWithinBudget(section, catalogBlock, MAX_SKILL_SECTION_CHARS);
			truncated = truncated
				|| this._skillCatalog.length > MAX_SKILL_CATALOG_ENTRIES
				|| nextSection.length < section.length + catalogBlock.length + (section ? 2 : 0);
			section = nextSection;
		}
		if (truncated) {
			logWarn('Gemini', `Trimmed skill prompt/catalog section to ${section.length} chars to keep setup payload stable`);
		}
		return section;
	}

	_handleMessage(msg) {
		if (msg.setupComplete) {
			this.sessionReady = true;
			if (this._setupFallbackLevel > 0) {
				const profile = this._getSetupFallbackProfile();
				logInfo('Gemini', `Session ready using ${profile.label} setup fallback`);
			}
			this.emit('ready');
			return;
		}

		const sc = msg.serverContent;
		if (sc) {
			if (sc.inputTranscription?.text) {
				this.emit('inputTranscription', sc.inputTranscription.text);
			}
			if (sc.outputTranscription?.text) {
				this.emit('outputTranscription', sc.outputTranscription.text);
			}
			if (sc.modelTurn?.parts) {
				for (const part of sc.modelTurn.parts) {
					if (part.inlineData?.data) {
						this.emit('audio', part.inlineData.data);
					}
					if (part.text) {
						this.emit('text', part.text);
					}
				}
			}
			if (sc.turnComplete) {
				this.emit('turnComplete');
			}
			if (sc.interrupted) {
				this.emit('interrupted');
			}
		}

		// Alternative message formats (API compatibility)
		if (msg.inputTranscription?.text) {
			this.emit('inputTranscription', msg.inputTranscription.text);
		}
		if (msg.outputTranscription?.text) {
			this.emit('outputTranscription', msg.outputTranscription.text);
		}
		if (msg.toolCall?.functionCalls) {
			this.emit('toolCall', msg.toolCall.functionCalls);
		}
	}

	_enqueueInboundMessage(raw) {
		if (typeof raw !== 'string' || !raw) return;
		this._inboundQueue.push(raw);
		if (this._inboundDrainScheduled) return;
		this._inboundDrainScheduled = true;
		queueMicrotask(() => this._drainInboundQueue());
	}

	_drainInboundQueue() {
		this._inboundDrainScheduled = false;
		let processed = 0;
		while (this._inboundQueue.length && processed < INBOUND_MESSAGE_BATCH_SIZE) {
			const raw = this._inboundQueue.shift();
			processed += 1;
			try {
				this._handleMessage(JSON.parse(raw));
			} catch (e) {
				logError('Gemini', 'Parse error:', e);
			}
		}
		if (this._inboundQueue.length) {
			this._inboundDrainScheduled = true;
			setTimeout(() => this._drainInboundQueue(), 0);
		}
	}

	sendAudio(base64Data) {
		if (!this.sessionReady) return;
		this._send(`{"realtimeInput":{"audio":{"mimeType":"audio/pcm;rate=16000","data":"${base64Data}"}}}`);
	}

	sendToolResponse(callId, name, result) {
		// Tool responses must always be sent (even if session dropped) to avoid
		// hanging the conversation. Log a warning if the socket isn't ready.
		if (!this.connected) {
			logError('Gemini', `sendToolResponse for "${name}" but WS not connected — response will be dropped`);
		}
		const resultText = typeof result === 'string' ? result : JSON.stringify(result);
		this._send(
			`{"toolResponse":{"functionResponses":[{"id":${JSON.stringify(callId)},"name":${JSON.stringify(name)},"response":{"result":${JSON.stringify(resultText)}}}]}}`
		);
	}

	sendText(text) {
		if (!this.sessionReady) return;
		const claudeCodeStatus = parseClaudeCodeStatus(text);
		if (claudeCodeStatus) {
			this.emit('claudeCodeStatusPrompt', {
				...claudeCodeStatus,
				text,
			});
			if (this._behaviorState.mode === 'proactive') {
				return;
			}
		}
		const outgoingText = augmentTextWithManagementCorrections(text);
		this._send(
			`{"clientContent":{"turns":[{"role":"user","parts":[{"text":${JSON.stringify(outgoingText)}}]}],"turnComplete":true}}`
		);
	}

	sendRealtimeText(text) {
		if (!this.sessionReady || !text) return;
		this._send(`{"realtimeInput":{"text":${JSON.stringify(text)}}}`);
	}

	async sendVocabUpdate() {
		if (!this.sessionReady) return;
		await refreshVocabulary();
		await refreshRecentObservations();
		const terms = buildPrioritizedVocab();
		const corrections = buildCorrectionsPrompt();
		const recentSeen = buildRecentSeenPrompt();
		this.sendText(`[SYSTEM: VOCABULARY UPDATE \u2014 do not read this aloud, just acknowledge internally]\nUpdated vocabulary:\n${terms.map(t => `\u2022 ${t}`).join('\n')}${corrections}${recentSeen}`);
	}

	sendRecentSeenUpdate() {
		if (!this.sessionReady) return;
		const recentSeen = buildRecentSeenPrompt();
		if (!recentSeen) return;
		this.sendText(`[SYSTEM: RECENT SCREEN TERMS \u2014 do not read this aloud, just use these as short-lived speech hints]${recentSeen}`);
	}

	sendImage(base64Jpeg) {
		if (!this.sessionReady) return;
		this._send(`{"realtimeInput":{"mediaChunks":[{"mimeType":"image/jpeg","data":"${base64Jpeg}"}]}}`);
	}

	_send(obj) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
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
