import { info as logInfo } from '../logger.js';

const GLOBAL_KEY = '__irisAudioRoutingDiagnostics';
const DEFAULT_TEST_PHRASE = 'Testing audio routing 123.';
const DEFAULT_TRACE_WINDOW_MS = 30000;

export const AUDIO_ROUTING_TEST_PHRASE = String(
	globalThis.process?.env?.IRIS_AUDIO_ROUTING_TEST_PHRASE || DEFAULT_TEST_PHRASE
).trim();

export const AUDIO_ROUTING_DIAGNOSTICS_ENABLED = String(
	globalThis.process?.env?.IRIS_AUDIO_ROUTING_DIAGNOSTICS || '1'
) !== '0';

export function normalizeAudioRoutingText(value = '') {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function createInitialState() {
	return {
		enabled: AUDIO_ROUTING_DIAGNOSTICS_ENABLED,
		phrase: AUDIO_ROUTING_TEST_PHRASE,
		phraseNormalized: normalizeAudioRoutingText(AUDIO_ROUTING_TEST_PHRASE),
		traceWindowMs: Number.parseInt(globalThis.process?.env?.IRIS_AUDIO_ROUTING_TRACE_WINDOW_MS || `${DEFAULT_TRACE_WINDOW_MS}`, 10),
		events: [],
		capture: {
			chunkCount: 0,
			startedAt: 0,
			lastChunkAt: 0,
			lastChunkSamples: 0,
			preferredDevice: '',
			selectedDevice: '',
		},
		gemini: {
			outboundChunkCount: 0,
			inboundChunkCount: 0,
			lastOutboundAudioAt: 0,
			lastInboundAudioAt: 0,
			lastInputTranscript: '',
			lastOutputTranscript: '',
		},
		playback: {
			chunkCount: 0,
			totalFrames: 0,
			totalSeconds: 0,
			startedAt: 0,
			lastChunkAt: 0,
			lastChunkFrames: 0,
			lastChunkRms: 0,
			lastQueueLeadMs: 0,
		},
		activeTrace: null,
	};
}

export function getAudioRoutingDiagnosticsState() {
	if (!globalThis[GLOBAL_KEY]) {
		globalThis[GLOBAL_KEY] = createInitialState();
	}
	return globalThis[GLOBAL_KEY];
}

export function resetAudioRoutingDiagnosticsForTest() {
	delete globalThis[GLOBAL_KEY];
	return getAudioRoutingDiagnosticsState();
}

export function isAudioRoutingPhrase(text = '') {
	const state = getAudioRoutingDiagnosticsState();
	if (!state.phraseNormalized) return false;
	return normalizeAudioRoutingText(text).includes(state.phraseNormalized);
}

export function getActiveAudioRoutingTrace(maxAgeMs) {
	const state = getAudioRoutingDiagnosticsState();
	const trace = state.activeTrace;
	if (!trace) return null;
	const budget = Number.isFinite(maxAgeMs) ? maxAgeMs : state.traceWindowMs;
	if (Date.now() - trace.matchedAt > budget) return null;
	return trace;
}

export function recordAudioRoutingEvent(stage, details = {}, { log = true } = {}) {
	if (!AUDIO_ROUTING_DIAGNOSTICS_ENABLED) return null;
	const state = getAudioRoutingDiagnosticsState();
	const trace = getActiveAudioRoutingTrace();
	const entry = {
		stage,
		at: Date.now(),
		traceId: trace?.traceId || null,
		details: { ...details },
	};
	state.events.push(entry);
	if (state.events.length > 80) state.events.shift();
	if (log) {
		const summary = Object.entries(entry.details)
			.filter(([, value]) => value !== undefined && value !== null && value !== '')
			.map(([key, value]) => `${key}=${typeof value === 'number' ? Number(value.toFixed?.(4) || value) : value}`)
			.join(', ');
		logInfo('AudioRoute', summary ? `${stage} | ${summary}` : stage);
	}
	return entry;
}

export function markAudioRoutingPhraseDetected(transcript = '', source = 'unknown', details = {}) {
	if (!AUDIO_ROUTING_DIAGNOSTICS_ENABLED) return null;
	const state = getAudioRoutingDiagnosticsState();
	const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	state.activeTrace = {
		traceId,
		source,
		transcript,
		matchedAt: Date.now(),
		geminiAudioReceivedAt: 0,
		playbackStartedAt: 0,
		playbackEndedAt: 0,
		...details,
	};
	recordAudioRoutingEvent(
		'phrase_detected',
		{
			source,
			transcript,
			captureChunks: state.capture.chunkCount,
			outboundChunks: state.gemini.outboundChunkCount,
			playbackChunks: state.playback.chunkCount,
			...details,
		},
	);
	return state.activeTrace;
}
