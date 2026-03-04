/**
 * Throwaway test to verify idle message rate-limiting logic in VoicePipeline.
 *
 * Since VoicePipeline depends on Electron APIs, we mock the dependencies
 * and test the core state-machine logic in isolation.
 */

// Minimal EventEmitter mock
class MockEmitter {
	constructor() { this._handlers = {}; }
	on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); }
	emit(ev, ...args) { (this._handlers[ev] || []).forEach(fn => fn(...args)); }
}

// Mock GeminiClient
class MockGemini extends MockEmitter {
	constructor() { super(); this.sessionReady = true; this.sentTexts = []; }
	sendAudio() {}
	sendImage() {}
	sendText(t) { this.sentTexts.push(t); }
	sendToolResponse() {}
	sendVocabUpdate() {}
	connect() { return Promise.resolve(); }
	disconnect() {}
}

// Mock AudioCapture
class MockCapture extends MockEmitter {
	start() { return Promise.resolve(); }
	stop() {}
	setEchoSuppression() {}
	setSuppressionGain() {}
	sendReferenceSignal() {}
	notifyPlaybackStop() {}
}

// Mock AudioPlayback
class MockPlayback extends MockEmitter {
	setReferenceCallback() {}
	enqueue() {}
	stop() {}
	getVolume() { return 0; }
}

// ---- Simulate the idle rate-limiting logic extracted from VoicePipeline ----

const STATES = {
	IDLE: 'IDLE',
	LISTENING: 'LISTENING',
	USER_SPEAKING: 'USER_SPEAKING',
	PROCESSING: 'PROCESSING',
	RESPONDING: 'RESPONDING',
	TOOL_EXECUTING: 'TOOL_EXECUTING',
};

function createPipelineState() {
	return {
		state: STATES.LISTENING,
		_lastUserSpeechTime: Date.now(),
		_unpromptedTurnCount: 0,
		_idleMessageSent: false,
		_idleGracePeriodMs: 60000,
		_autonomousMode: false,
		_muted: false,
		audioPlayed: [],
		transcriptShown: [],
	};
}

// Simulate the audio handler logic
function handleAudio(s, data) {
	if (s._muted) return false;
	if (!s._autonomousMode) {
		if (s._idleMessageSent) return false;
		if (s._unpromptedTurnCount >= 1) return false;
		const timeSinceUser = Date.now() - s._lastUserSpeechTime;
		if (timeSinceUser > 10000 && s.state !== STATES.RESPONDING) return false;
	}
	s.state = STATES.RESPONDING;
	s.audioPlayed.push(data);
	return true;
}

// Simulate the outputTranscription handler logic
function handleTranscription(s, text) {
	if (s._muted) return false;
	if (!s._autonomousMode) {
		if (s._idleMessageSent) return false;
		if (s._unpromptedTurnCount >= 1) return false;
		const timeSinceUser = Date.now() - s._lastUserSpeechTime;
		if (timeSinceUser > 10000 && s.state !== STATES.RESPONDING) return false;
	}
	s.transcriptShown.push(text);
	return true;
}

// Simulate turnComplete handler
function handleTurnComplete(s) {
	s.state = STATES.LISTENING;
	if (!s._autonomousMode) {
		const timeSinceUserSpoke = Date.now() - s._lastUserSpeechTime;
		if (timeSinceUserSpoke > 3000) {
			s._unpromptedTurnCount++;
			if (s._unpromptedTurnCount >= 1) {
				s._idleMessageSent = true;
			}
		} else {
			s._unpromptedTurnCount = 0;
		}
	}
}

// Simulate user speaking
function userSpeaks(s) {
	s.state = STATES.USER_SPEAKING;
	s._lastUserSpeechTime = Date.now();
	s._unpromptedTurnCount = 0;
	if (s._idleMessageSent) {
		s._idleMessageSent = false;
	}
}

// ---- Tests ----

let passed = 0;
let failed = 0;

function assert(condition, msg) {
	if (condition) {
		passed++;
		console.log(`  ✅ ${msg}`);
	} else {
		failed++;
		console.error(`  ❌ ${msg}`);
	}
}

console.log('\n=== Idle Message Rate-Limiting Tests ===\n');

// Test 1: First unprompted response goes through
console.log('Test 1: First unprompted turn audio plays');
{
	const s = createPipelineState();
	// Simulate user spoke 1 second ago (within 10s grace window)
	s._lastUserSpeechTime = Date.now() - 1000;
	const played = handleAudio(s, 'audio-chunk-1');
	assert(played, 'First audio chunk should play when user spoke recently');
	assert(s.state === STATES.RESPONDING, 'State should transition to RESPONDING');
}

// Test 2: After turnComplete with no user speech, idle gate is set
console.log('\nTest 2: Idle gate set after first unprompted turnComplete');
{
	const s = createPipelineState();
	s._lastUserSpeechTime = Date.now() - 5000; // 5s since user spoke
	s.state = STATES.RESPONDING;
	handleTurnComplete(s);
	assert(s._idleMessageSent === true, '_idleMessageSent should be true');
	assert(s._unpromptedTurnCount === 1, '_unpromptedTurnCount should be 1');
}

// Test 3: After idle gate is set, all subsequent audio is blocked
console.log('\nTest 3: Audio blocked after idle gate is set');
{
	const s = createPipelineState();
	s._idleMessageSent = true;
	s._lastUserSpeechTime = Date.now() - 1000; // Even if recent
	const played = handleAudio(s, 'audio-chunk-2');
	assert(!played, 'Audio should be blocked when _idleMessageSent is true');
	assert(s.audioPlayed.length === 0, 'No audio should be in the queue');
}

// Test 4: After idle gate is set, transcriptions are blocked
console.log('\nTest 4: Transcription blocked after idle gate');
{
	const s = createPipelineState();
	s._idleMessageSent = true;
	const shown = handleTranscription(s, 'I am ready');
	assert(!shown, 'Transcription should be blocked when _idleMessageSent is true');
	assert(s.transcriptShown.length === 0, 'No transcription should be shown');
}

// Test 5: User speaking resets the idle gate
console.log('\nTest 5: User speaking resets idle gate');
{
	const s = createPipelineState();
	s._idleMessageSent = true;
	s._unpromptedTurnCount = 3;
	userSpeaks(s);
	assert(s._idleMessageSent === false, '_idleMessageSent should be reset to false');
	assert(s._unpromptedTurnCount === 0, '_unpromptedTurnCount should be reset to 0');
}

// Test 6: After reset, normal audio plays again
console.log('\nTest 6: Audio plays after idle gate reset');
{
	const s = createPipelineState();
	s._idleMessageSent = true;
	userSpeaks(s); // Reset
	s.state = STATES.LISTENING;
	// Simulate user spoke very recently
	const played = handleAudio(s, 'audio-chunk-3');
	assert(played, 'Audio should play after idle gate reset');
}

// Test 7: Multiple unprompted turns are all blocked (simulate the original bug)
console.log('\nTest 7: Simulate 10 idle turns - only first plays');
{
	const s = createPipelineState();
	s._lastUserSpeechTime = Date.now() - 2000; // 2s ago

	let playedCount = 0;

	for (let i = 0; i < 10; i++) {
		// Each "turn": try to play audio, then complete
		const played = handleAudio(s, `idle-audio-${i}`);
		if (played) {
			playedCount++;
			// Simulate some time passing during the response
			s.state = STATES.RESPONDING;
		}

		// Wait simulated 1s between turns
		s._lastUserSpeechTime = Date.now() - (5000 + i * 1000);

		handleTurnComplete(s);
	}

	assert(playedCount <= 1, `Only 0-1 idle turns should play, got ${playedCount}`);
	assert(s._idleMessageSent === true, 'Idle gate should be permanently set');
	assert(s._unpromptedTurnCount >= 1, 'Unprompted count should be >= 1');
}

// Test 8: Autonomous mode bypasses idle gate
console.log('\nTest 8: Autonomous mode bypasses idle gate');
{
	const s = createPipelineState();
	s._autonomousMode = true;
	s._idleMessageSent = true;
	s._unpromptedTurnCount = 5;
	s._lastUserSpeechTime = Date.now() - 1000;
	const played = handleAudio(s, 'auto-audio');
	assert(played, 'Audio should play in autonomous mode regardless of idle gate');
}

// Test 9: Screen capture check - idle > 60s should stop captures
console.log('\nTest 9: Screen capture idle check (>60s)');
{
	const s = createPipelineState();
	s._lastUserSpeechTime = Date.now() - 61000; // 61s ago
	const shouldCapture = !s._idleMessageSent &&
		(s._autonomousMode || (Date.now() - s._lastUserSpeechTime) <= s._idleGracePeriodMs);
	assert(!shouldCapture, 'Passive captures should stop after 60s idle');
}

// Test 10: Screen capture check - idle < 60s should continue
console.log('\nTest 10: Screen capture continues when user active');
{
	const s = createPipelineState();
	s._lastUserSpeechTime = Date.now() - 30000; // 30s ago
	const shouldCapture = !s._idleMessageSent &&
		(s._autonomousMode || (Date.now() - s._lastUserSpeechTime) <= s._idleGracePeriodMs);
	assert(shouldCapture, 'Passive captures should continue within 60s');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
