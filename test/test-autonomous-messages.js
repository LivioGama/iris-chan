#!/usr/bin/env node
/**
 * Verification test: Autonomous mode idle message suppression
 *
 * Checks that the autonomous mode messages in pipeline.js and system-prompt.js
 * do NOT contain phrases that would encourage verbose idle status messages.
 */

import { readFileSync } from 'fs';

const pipeline = readFileSync('src/renderer/voice/pipeline.js', 'utf-8');
const systemPrompt = readFileSync('src/renderer/gemini/system-prompt.js', 'utf-8');

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

console.log('\n=== Autonomous Mode Idle Message Suppression Tests ===\n');

// 1. Activation message should NOT say "idle silence rules are SUSPENDED"
console.log('1. Activation message (toggleAutonomous):');
const activationMatch = pipeline.match(/MODE CHANGE — AUTONOMOUS MODE ACTIVATED\]\\n.*?(?=\);)/s);
const activationMsg = activationMatch ? activationMatch[0] : '';

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

// 2. Reconnection message should NOT say "idle silence rules are SUSPENDED"
console.log('\n2. Reconnection message:');
const reconnectMatch = pipeline.match(/MODE CHANGE — AUTONOMOUS MODE ACTIVATED \(reconnect\)\].*?(?=\);)/s);
const reconnectMsg = reconnectMatch ? reconnectMatch[0] : '';

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
// Match the sendText inside _sendScreenFrame().then() — the second occurrence of [AUTONOMOUS CODING PROMPT]
const loopSection = pipeline.match(/_startAutonomousLoop\(\)[\s\S]*?_stopAutonomousLoop/);
const loopContent = loopSection ? loopSection[0] : '';

assert(loopContent.includes('one-sentence') || loopContent.includes('One sentence'),
	'Limits response to one sentence');
assert(loopContent.includes('STOP'),
	'Instructs to STOP after asking');
assert(!loopContent.includes('gently'),
	'No soft language that invites verbose responses');

// 4. System prompt reinforces silence in autonomous mode
console.log('\n4. System prompt (FIX_PROJECT section):');
assert(systemPrompt.includes('idle rules are NOT suspended'),
	'System prompt states idle rules are NOT suspended in autonomous mode');
assert(systemPrompt.includes('Never repeat idle status messages'),
	'System prompt explicitly prohibits repeating idle status messages');

// 5. Verify activation message does NOT contain problematic phrases
console.log('\n5. Negative checks — problematic phrases absent:');
const fullPipeline = pipeline;
// Check all sendText calls related to autonomous mode
assert(!fullPipeline.includes("'Your idle silence rules are SUSPENDED"),
	'No sendText contains "Your idle silence rules are SUSPENDED"');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
