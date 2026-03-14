// Unit tests for CodeCache
const assert = require('node:assert');
const { CodeCache } = require('../../src/main/two-fa/code-cache');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

test('add and getLatest', () => {
	const cache = new CodeCache();
	cache.add({ code: '123456', source: 'messages', sender: '+15551234567', text: 'Your code is 123456' });
	const codes = cache.getLatest();
	assert.strictEqual(codes.length, 1);
	assert.strictEqual(codes[0].maskedCode, '12****');
	assert.strictEqual(codes[0].source, 'messages');
});

test('dedup by code value', () => {
	const cache = new CodeCache();
	cache.add({ code: '123456', source: 'messages', sender: 'a', text: 'code 123456' });
	cache.add({ code: '123456', source: 'notifications', sender: 'b', text: 'code 123456' });
	assert.strictEqual(cache.size, 1);
});

test('updates timestamp on dedup', () => {
	const cache = new CodeCache();
	cache.add({ code: '111111', source: 'messages', timestamp: Date.now() - 60000 });
	cache.add({ code: '111111', source: 'notifications', timestamp: Date.now() });
	const codes = cache.getLatest();
	assert.ok(codes[0].age.includes('just now') || codes[0].age.includes('s ago'));
});

test('getLatest respects limit', () => {
	const cache = new CodeCache();
	for (let i = 0; i < 10; i++) {
		cache.add({ code: String(100000 + i), source: 'test', timestamp: Date.now() + i });
	}
	assert.strictEqual(cache.getLatest(3).length, 3);
	assert.strictEqual(cache.getLatest().length, 5); // default limit
});

test('getLatest sorts by timestamp desc', () => {
	const cache = new CodeCache();
	cache.add({ code: '111111', source: 'old', timestamp: Date.now() - 10000 });
	cache.add({ code: '222222', source: 'new', timestamp: Date.now() });
	const codes = cache.getLatest();
	assert.strictEqual(codes[0].source, 'new');
	assert.strictEqual(codes[1].source, 'old');
});

test('prune removes expired entries', () => {
	const cache = new CodeCache({ maxAgeMs: 100 });
	cache.add({ code: '123456', source: 'test', timestamp: Date.now() - 200 });
	const codes = cache.getLatest();
	assert.strictEqual(codes.length, 0);
});

test('maxEntries evicts oldest', () => {
	const cache = new CodeCache({ maxEntries: 3 });
	cache.add({ code: '111111', source: 'a', timestamp: Date.now() - 3000 });
	cache.add({ code: '222222', source: 'b', timestamp: Date.now() - 2000 });
	cache.add({ code: '333333', source: 'c', timestamp: Date.now() - 1000 });
	cache.add({ code: '444444', source: 'd', timestamp: Date.now() });
	assert.strictEqual(cache.size, 3);
	// Oldest (111111) should be evicted
	const codes = cache.getLatest(10);
	assert.ok(!codes.find(c => c.maskedCode === '11****'));
});

test('getByKeyword matches sender', () => {
	const cache = new CodeCache();
	cache.add({ code: '148966', source: 'messages', sender: 'Facebook', text: '148966 is your Facebook code' });
	cache.add({ code: '315643', source: 'messages', sender: 'Google', text: 'G-315643' });
	const result = cache.getByKeyword('facebook');
	assert.ok(result);
	assert.strictEqual(result.maskedCode, '14****');
});

test('getByKeyword matches snippet', () => {
	const cache = new CodeCache();
	cache.add({ code: '999888', source: 'mail', sender: 'noreply@stripe.com', text: 'Your Stripe verification code is: 999888' });
	const result = cache.getByKeyword('stripe');
	assert.ok(result);
	assert.strictEqual(result.maskedCode, '99****');
});

test('getByKeyword returns null for no match', () => {
	const cache = new CodeCache();
	cache.add({ code: '123456', source: 'messages', sender: 'Facebook' });
	assert.strictEqual(cache.getByKeyword('twitter'), null);
});

test('getFullCode by keyword', () => {
	const cache = new CodeCache();
	cache.add({ code: '148966', source: 'messages', sender: 'Facebook' });
	assert.strictEqual(cache.getFullCode('facebook'), '148966');
});

test('getFullCode by "latest"', () => {
	const cache = new CodeCache();
	cache.add({ code: '111111', source: 'a', timestamp: Date.now() - 5000 });
	cache.add({ code: '222222', source: 'b', timestamp: Date.now() });
	assert.strictEqual(cache.getFullCode('latest'), '222222');
});

test('getFullCode returns null when empty', () => {
	const cache = new CodeCache();
	assert.strictEqual(cache.getFullCode('anything'), null);
});

test('clear empties cache', () => {
	const cache = new CodeCache();
	cache.add({ code: '123456', source: 'test' });
	cache.clear();
	assert.strictEqual(cache.size, 0);
	assert.strictEqual(cache.getLatest().length, 0);
});

test('snippet strips code from text', () => {
	const cache = new CodeCache();
	cache.add({ code: '148966', source: 'messages', text: '148966 is your Facebook code' });
	const codes = cache.getLatest();
	assert.ok(!codes[0].snippet.includes('148966'), 'Snippet should not contain the code');
	assert.ok(codes[0].snippet.includes('Facebook'), 'Snippet should contain context');
});

test('masked code format', () => {
	const cache = new CodeCache();
	cache.add({ code: '5WGU8G', source: 'messages' });
	const codes = cache.getLatest();
	assert.strictEqual(codes[0].maskedCode, '5W****');
});

test('handles null/missing fields gracefully', () => {
	const cache = new CodeCache();
	cache.add({ code: '123456' });
	const codes = cache.getLatest();
	assert.strictEqual(codes.length, 1);
	assert.strictEqual(codes[0].source, 'unknown');
	assert.strictEqual(codes[0].sender, 'unknown');
});

console.log('\nAll code cache tests passed!');
