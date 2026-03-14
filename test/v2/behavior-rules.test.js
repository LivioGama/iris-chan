const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function simulateBehavior() {
	let userSpokeSinceAssistant = true;
	let idleAckSent = false;
	let proactiveLastAt = 0;
	let lastUserActivityAt = Date.now();
	let proactiveSuggestionsEnabled = true;
	let lastProactiveFingerprint = '';
	let lastProactiveEvalFingerprint = '';
	let lastProactiveEvalAt = 0;
	const proactiveUserActiveWindowMs = 60000;
	const proactiveModeCooldownMs = {
		silent: Number.MAX_SAFE_INTEGER,
		attentive: 30000,
		autonomous: 12000,
	};
	const proactiveEvalCooldownMs = {
		silent: Number.MAX_SAFE_INTEGER,
		attentive: 10000,
		autonomous: 4000,
	};
	const proactiveMinConfidence = {
		silent: 1,
		attentive: 0.9,
		autonomous: 0.82,
	};
	let mode = 'silent';
	return {
		noteUserActivity() {
			userSpokeSinceAssistant = true;
			idleAckSent = false;
			lastUserActivityAt = Date.now();
		},
		noteAssistantSpoke() {
			userSpokeSinceAssistant = false;
		},
		setMode(nextMode) {
			mode = nextMode;
		},
		setProactiveSuggestionsEnabled(enabled) {
			proactiveSuggestionsEnabled = !!enabled;
		},
		canSpeak({ directReply = false, majorMilestone = false, selfFixAck = false } = {}) {
			if (selfFixAck) return !idleAckSent;
			if (directReply) return true;
			if (majorMilestone) return userSpokeSinceAssistant;
			return userSpokeSinceAssistant;
		},
		markSelfFixAckSent() {
			idleAckSent = true;
		},
		shouldEvaluateProactively({ contextFingerprint, captureAgeMs = 0, now = Date.now() } = {}) {
			if (mode === 'silent') return false;
			if (!proactiveSuggestionsEnabled) return false;
			if (!contextFingerprint) return false;
			if (mode === 'attentive' && now - lastUserActivityAt > proactiveUserActiveWindowMs) return false;
			if (captureAgeMs > 20000) return false;
			if (contextFingerprint === lastProactiveEvalFingerprint && now - lastProactiveEvalAt < proactiveEvalCooldownMs[mode]) return false;
			if (contextFingerprint === lastProactiveFingerprint && now - proactiveLastAt < proactiveEvalCooldownMs[mode]) return false;
			lastProactiveEvalFingerprint = contextFingerprint;
			lastProactiveEvalAt = now;
			return true;
		},
		canSuggest({ confidence, contextFingerprint, now }) {
			if (mode === 'silent') return false;
			if (!proactiveSuggestionsEnabled) return false;
			if (confidence < proactiveMinConfidence[mode]) return false;
			if (mode === 'attentive' && now - lastUserActivityAt > proactiveUserActiveWindowMs) return false;
			if (now - proactiveLastAt < proactiveModeCooldownMs[mode]) return false;
			if (contextFingerprint === lastProactiveFingerprint) return false;
			proactiveLastAt = now;
			lastProactiveFingerprint = contextFingerprint;
			return true;
		},
	};
}

async function loadInteractionPolicy() {
	const moduleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/interaction/interaction-policy.js')).href;
	return import(moduleUrl);
}

console.log('Running V2 behavior rules tests...');

async function main() {
{
	const b = simulateBehavior();
	assert.strictEqual(b.canSpeak(), true, 'initially can speak');
	b.noteAssistantSpoke();
	assert.strictEqual(b.canSpeak(), false, 'assistant cannot speak twice in a row');
	b.noteUserActivity();
	assert.strictEqual(b.canSpeak(), true, 'user activity re-enables speaking');
}

{
	const b = simulateBehavior();
	assert.strictEqual(b.canSpeak({ selfFixAck: true }), true, 'self fix ack allowed first time');
	b.markSelfFixAckSent();
	assert.strictEqual(b.canSpeak({ selfFixAck: true }), false, 'self fix ack blocked after first emission');
}

{
	const b = simulateBehavior();
	const t0 = Date.now();
	b.setMode('attentive');
	assert.strictEqual(b.canSuggest({ confidence: 0.93, contextFingerprint: 'ctx-a', now: t0 }), true, 'high confidence suggestion allowed');
	assert.strictEqual(b.canSuggest({ confidence: 0.95, contextFingerprint: 'ctx-a', now: t0 + 1000 }), false, 'same-context suggestion blocked');
	assert.strictEqual(b.canSuggest({ confidence: 0.95, contextFingerprint: 'ctx-b', now: t0 + 1000 }), false, 'different context still throttled during cooldown');
	assert.strictEqual(b.canSuggest({ confidence: 0.95, contextFingerprint: 'ctx-b', now: t0 + 31000 }), true, 'suggestion allowed after attentive cooldown');
}

{
	const b = simulateBehavior();
	const t0 = Date.now();
	b.setMode('silent');
	assert.strictEqual(b.shouldEvaluateProactively({ contextFingerprint: 'ctx-a', captureAgeMs: 1000, now: t0 }), false, 'silent mode blocks proactive evaluation');
	b.setMode('attentive');
	assert.strictEqual(b.shouldEvaluateProactively({ contextFingerprint: 'ctx-a', captureAgeMs: 1000, now: t0 }), true, 'attentive mode allows proactive evaluation');
	assert.strictEqual(b.shouldEvaluateProactively({ contextFingerprint: 'ctx-a', captureAgeMs: 1000, now: t0 + 1000 }), false, 'duplicate proactive evaluation is suppressed');
	assert.strictEqual(b.shouldEvaluateProactively({ contextFingerprint: 'ctx-b', captureAgeMs: 25000, now: t0 + 11000 }), false, 'stale capture blocks proactive evaluation');
}

{
	const b = simulateBehavior();
	const t0 = Date.now();
	b.setMode('autonomous');
	b.setProactiveSuggestionsEnabled(false);
	assert.strictEqual(b.shouldEvaluateProactively({ contextFingerprint: 'ctx-a', captureAgeMs: 1000, now: t0 }), false, 'disabled proactive suggestions block proactive evaluation');
	assert.strictEqual(b.canSuggest({ confidence: 0.95, contextFingerprint: 'ctx-a', now: t0 }), false, 'disabled proactive suggestions block proactive output');
}

{
	// 30-minute idle simulation: assistant should never keep speaking repeatedly
	const b = simulateBehavior();
	let emissions = 0;
	for (let i = 0; i < 180; i++) {
		if (b.canSpeak()) {
			emissions += 1;
			b.noteAssistantSpoke();
		}
	}
	assert.strictEqual(emissions, 1, 'only one emission during prolonged idle window');
}

{
	const src = fs.readFileSync('src/renderer/voice/behavior-engine.js', 'utf-8');
	assert.ok(src.includes('isBannedIdleText'), 'behavior-engine contains banned idle text filter');
	assert.ok(src.includes('markSelfFixAckSent'), 'behavior-engine contains self-fix ack gate');
}

{
	const promptSrc = fs.readFileSync('src/renderer/gemini/system-prompt.js', 'utf-8');
	assert.ok(promptSrc.includes('your turn must start with tool calls'), 'system prompt requires tool-first behavior for direct computer-control requests');
	assert.ok(promptSrc.includes('Do not say "Done", "I clicked it", or "I went there"'), 'system prompt forbids claiming UI actions without same-turn tool use');
	assert.ok(promptSrc.includes('If a click depends on prior setup, do that setup first.'), 'system prompt requires setup before dependent click actions');
}

{
	const policy = await loadInteractionPolicy();
	const promptReply = policy.buildReplyPresentation({
		replyPrompt: false,
		replyOptions: ['Sounds good', 'Let me check'],
	}, { mode: 'passive', feedbackEnabled: false, introversionEnabled: false });
	assert.strictEqual(promptReply.sessionMode, 'prompt', 'passive mode should downshift reply opportunities into prompts');

	const feedbackReply = policy.buildReplyPresentation({
		replyPrompt: false,
		replyOptions: ['Sounds good', 'Let me check'],
	}, { mode: 'proactive', feedbackEnabled: true, introversionEnabled: false });
	assert.match(feedbackReply.spoken, /make 1 warmer, shorter, or clearer/i, 'feedback mode should make revision affordances explicit');

	const proactivePrompt = policy.buildInteractionPromptPolicy({
		mode: 'proactive',
		proactiveSuggestionsEnabled: true,
		feedbackEnabled: false,
		introversionEnabled: false,
	});
	assert.match(proactivePrompt, /Proactive suggestions are enabled for proactive mode/i, 'interaction policy should advertise enabled proactive suggestions');

	const disabledPrompt = policy.buildInteractionPromptPolicy({
		mode: 'proactive',
		proactiveSuggestionsEnabled: false,
		feedbackEnabled: false,
		introversionEnabled: false,
	});
	assert.match(disabledPrompt, /Primary mode posture: proactive mode with unsolicited suggestions disabled/i, 'interaction policy should surface when proactive suggestions are disabled');

	const introvertReply = policy.buildReplyPresentation({
		replyPrompt: false,
		replyOptions: ['Sounds good', 'Let me check'],
	}, { mode: 'proactive', feedbackEnabled: false, introversionEnabled: true });
	assert.strictEqual(introvertReply.sessionMode, 'prompt', 'introversion mode should prefer brief prompts over enumerating options');

	assert.strictEqual(
		policy.shouldAutoEscalateFromToolFailure({
			toolName: 'click_at',
			result: { ok: false, result: 'not found' },
			intentText: 'open the GitHub tab',
		}),
		true,
		'clear navigational asks should auto-escalate once'
	);

	assert.strictEqual(
		policy.shouldAutoEscalateFromToolFailure({
			toolName: 'click_at',
			result: { ok: false, result: 'not found' },
			intentText: 'delete that draft',
		}),
		false,
		'destructive asks should not auto-escalate implicitly'
	);
}

console.log('V2 behavior rules tests passed.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
