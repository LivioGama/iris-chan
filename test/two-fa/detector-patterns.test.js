// Unit test for vision-based detector module + resilient parser
const { detect2FAField, parseGeminiResponse } = require('../../src/main/two-fa/detector');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Module shape
test('detect2FAField is exported as a function', () => {
	assert(typeof detect2FAField === 'function', 'Expected function');
});

test('parseGeminiResponse is exported as a function', () => {
	assert(typeof parseGeminiResponse === 'function', 'Expected function');
});

// Complete valid JSON
test('parses complete JSON with detected:true', () => {
	const r = parseGeminiResponse('{"detected":true,"app":"Google"}');
	assert(r.detected === true, `detected should be true, got ${r.detected}`);
	assert(r.app === 'Google', `app should be Google, got ${r.app}`);
});

test('parses complete JSON with detected:false', () => {
	const r = parseGeminiResponse('{"detected":false}');
	assert(r.detected === false, `detected should be false`);
});

// Truncated JSON — the core bug this fix addresses
test('handles truncated JSON: {"detected": true, "app": "Google"', () => {
	const r = parseGeminiResponse('{"detected": true, "app": "Google"');
	assert(r.detected === true, 'detected should be true');
	assert(r.app === 'Google', `app should be Google, got ${r.app}`);
});

test('handles truncated JSON with partial app value', () => {
	const r = parseGeminiResponse('{"detected": true, "app": "Goo');
	assert(r.detected === true, 'detected should be true');
	assert(r.app === 'Goo', `app should be Goo, got ${r.app}`);
});

test('handles truncated JSON with no app at all', () => {
	const r = parseGeminiResponse('{"detected": true, "ap');
	assert(r.detected === true, 'detected should be true');
	assert(r.app === '', `app should be empty, got ${r.app}`);
});

// JSON with markdown wrapping
test('handles JSON wrapped in markdown code block', () => {
	const r = parseGeminiResponse('```json\n{"detected":true,"app":"GitHub"}\n```');
	assert(r.detected === true, 'detected should be true');
	assert(r.app === 'GitHub', `app should be GitHub, got ${r.app}`);
});

// Edge cases
test('returns null for empty/null input', () => {
	assert(parseGeminiResponse(null) === null, 'null input');
	assert(parseGeminiResponse('') === null, 'empty string');
});

test('returns null for unrelated text', () => {
	assert(parseGeminiResponse('Hello world') === null, 'random text');
});

test('handles detected:false in truncated JSON', () => {
	const r = parseGeminiResponse('{"detected": false');
	assert(r.detected === false, 'detected should be false');
});

console.log('\nAll detector pattern tests passed!');
