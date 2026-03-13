#!/usr/bin/env node
/**
 * Verification test: autonomous mode idle message suppression
 *
 * Checks that the autonomous mode messages in voice-engine.js and
 * system-prompt.js do NOT contain phrases that encourage verbose idle chatter.
 */

const { readFileSync } = require('node:fs');
const path = require('node:path');

const voiceEnginePath = path.join(__dirname, '..', 'src', 'renderer', 'voice', 'voice-engine.js');
const systemPromptPath = path.join(__dirname, '..', 'src', 'renderer', 'gemini', 'system-prompt.js');
const voiceEngine = readFileSync(voiceEnginePath, 'utf-8');
const systemPrompt = readFileSync(systemPromptPath, 'utf-8');

let passed = 0;
let failed = 0;

function assert(condition, desc) {
	if (condition) {
		console.log(`  ✓ ${desc}`);
		passed++;
	} else {
		console.error(`  ✗ FAIL: ${desc}`);
		failed++;
	}
}

function sliceFrom(source, marker, length = 1200) {
	const start = source.indexOf(marker);
	return start === -1 ? '' : source.slice(start, start + length);
}

console.log('\n=== Autonomous Mode Idle Message Suppression Tests ===\n');

// 1. Activation message should NOT say "idle silence rules are SUSPENDED"
console.log('1. Activation message (toggleAutonomous):');
const activationMsg = sliceFrom(voiceEngine, '[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED]');

assert(!activationMsg.includes('idle silence rules are SUSPENDED'),
	'Does not say "idle silence rules are SUSPENDED"');
assert(!activationMsg.includes('idle silence rules are suspended'),
	'Does not say "idle silence rules are suspended" (case-insensitive)');
assert(activationMsg.includes('IDLE RULES STILL APPLY'),
	'Explicitly states idle rules still apply');
assert(activationMsg.includes('COMPLETELY SILENT'),
	'Instructs to remain completely silent');
assert(activationMsg.includes('ONE short sentence'),
	'Limits initial confirmation to one short sentence');
assert(activationMsg.includes('then STOP'),
	'Instructs to STOP after confirmation');
assert(!activationMsg.includes('what should I work on'),
	'Does not ask what to work on during activation');

// 2. Reconnection message should NOT say "idle silence rules are SUSPENDED"
console.log('\n2. Reconnection message:');
const reconnectMsg = sliceFrom(voiceEngine, '[SYSTEM: MODE CHANGE — AUTONOMOUS MODE ACTIVATED (reconnect)]', 500);

assert(!reconnectMsg.includes('idle silence rules are SUSPENDED'),
	'Does not say "idle silence rules are SUSPENDED"');
assert(!reconnectMsg.includes('Proactively suggest'),
	'Does not say "Proactively suggest tasks"');
assert(reconnectMsg.includes('SILENT') || reconnectMsg.includes('silent'),
	'Instructs to remain silent');
assert(reconnectMsg.includes('Do NOT announce'),
	'Instructs not to announce reconnection');

// 3. Autonomous loop prompt should be brief (in _startAutonomousLoop)
console.log('\n3. Autonomous loop follow-up prompt:');
const loopContent = sliceFrom(voiceEngine, '[AUTONOMOUS CODING PROMPT] If a Claude Code task is running', 420);

assert(loopContent.includes('one-sentence') || loopContent.includes('One sentence'),
	'Limits response to one sentence');
assert(loopContent.includes('STOP'),
	'Instructs to STOP after asking');
assert(!loopContent.includes('gently'),
	'No soft language that invites verbose responses');
assert(loopContent.includes('continue working silently'),
	'Keeps active coding tasks progressing without a reprompt');
assert(loopContent.includes('Otherwise, ask ONE short question about what to work on'),
	'Only asks what to work on when no active coding task exists');

// 4. System prompt reinforces silence in autonomous mode
console.log('\n4. System prompt (FIX_PROJECT section):');
assert(systemPrompt.includes('idle rules are NOT suspended'),
	'System prompt states idle rules are NOT suspended in autonomous mode');
assert(systemPrompt.includes('Never repeat idle status messages'),
	'System prompt explicitly prohibits repeating idle status messages');

// 5. Verify activation message does NOT contain problematic phrases
console.log('\n5. Negative checks — problematic phrases absent:');
const fullVoiceEngine = voiceEngine;
// Check all sendText calls related to autonomous mode
assert(!fullVoiceEngine.includes("'Your idle silence rules are SUSPENDED"),
	'No sendText contains "Your idle silence rules are SUSPENDED"');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
