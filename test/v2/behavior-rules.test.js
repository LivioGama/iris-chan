const assert = require('node:assert');
const fs = require('node:fs');

function simulateBehavior() {
	let userSpokeSinceAssistant = true;
	let idleAckSent = false;
	let proactiveLastAt = 0;
	const proactiveCooldownMs = 90000;
	return {
		noteUserActivity() {
			userSpokeSinceAssistant = true;
			idleAckSent = false;
		},
		noteAssistantSpoke() {
			userSpokeSinceAssistant = false;
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
		canSuggest(confidence, now) {
			if (confidence < 0.85) return false;
			if (now - proactiveLastAt < proactiveCooldownMs) return false;
			proactiveLastAt = now;
			return true;
		},
	};
}

console.log('Running V2 behavior rules tests...');

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
	assert.strictEqual(b.canSuggest(0.93, t0), true, 'high confidence suggestion allowed');
	assert.strictEqual(b.canSuggest(0.95, t0 + 1000), false, 'suggestion throttled during cooldown');
	assert.strictEqual(b.canSuggest(0.95, t0 + 91000), true, 'suggestion allowed after cooldown');
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

console.log('V2 behavior rules tests passed.');
