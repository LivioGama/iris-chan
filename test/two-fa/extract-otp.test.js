// OTP extraction tests — adapted from Raycast imessage-2fa test vectors
const assert = require('node:assert');
// Clear any cached mock from other test files (e.g. orchestrator.test.js)
delete require.cache[require.resolve('../../src/main/tools/auth')];
const { extractOTP, stripHtmlTags, extractTextFromBinaryData, extractVerificationLink } = require('../../src/main/tools/auth');

function test(name, fn) {
	try { fn(); console.log(`PASS: ${name}`); }
	catch (e) { console.error(`FAIL: ${name} — ${e.message}`); process.exit(1); }
}

// ---- extractOTP tests (Raycast test vectors) ----

test('Chase 8-digit code', () => {
	assert.strictEqual(extractOTP("Chase: DON'T share. Use code 41646271 to complete Extra Security at Sign In."), '41646271');
});

test('Microsoft 4-digit code', () => {
	assert.strictEqual(extractOTP('2773 is your Microsoft account verification code'), '2773');
});

test('Airbnb verification code', () => {
	assert.strictEqual(extractOTP('Your Airbnb verification code is: 1234.'), '1234');
});

test('code followed by comma', () => {
	assert.strictEqual(extractOTP('Your verification code is: 1234, use it to log in'), '1234');
});

test('code without space after colon', () => {
	assert.strictEqual(extractOTP('Here is your authorization code:9384'), '9384');
});

test('Chinese 验证码', () => {
	assert.strictEqual(extractOTP('【抖音】验证码9316，用于手机验证'), '9316');
});

test('healow verification code', () => {
	assert.strictEqual(extractOTP('Your healow verification code is : 7579.'), '7579');
});

test('short 3-digit code with keyword', () => {
	assert.strictEqual(extractOTP('Please enter code 548 on Zocdoc.'), '548');
});

test('USAA fraud prevention code', () => {
	assert.strictEqual(extractOTP("USAA FRAUD PREVENTION ALERT: USAA will never contact you for this code, don't share it: 123456."), '123456');
});

test('Chinese 验证码 with expiry', () => {
	assert.strictEqual(extractOTP('您的验证码是 199035，10分钟内有效，请勿泄露'), '199035');
});

test('Chinese login code', () => {
	assert.strictEqual(extractOTP('登录验证码：627823，您正在尝试【登录】，10分钟内有效'), '627823');
});

test('Google G- prefix', () => {
	assert.strictEqual(extractOTP('G-315643 is your Google verification code'), '315643');
});

test('code followed by exclamation', () => {
	assert.strictEqual(extractOTP('Your code is 45678!'), '45678');
});

test('code with colon no space and exclamation', () => {
	assert.strictEqual(extractOTP('Your code is:98765!'), '98765');
});

test('code with "enter" prefix', () => {
	assert.strictEqual(extractOTP('Enter the code 765432, and then click the button to log in.'), '765432');
});

test('dashed code: Stripe', () => {
	assert.strictEqual(extractOTP('Your Stripe verification code is: 719-839.'), '719839');
});

test('dashed code: simple', () => {
	assert.strictEqual(extractOTP('123-456'), '123456');
});

test('alphanumeric code: 5WGU8G', () => {
	assert.strictEqual(extractOTP('5WGU8G'), '5WGU8G');
});

test('alphanumeric code with context', () => {
	assert.strictEqual(extractOTP('Your code is: 5WGU8G'), '5WGU8G');
});

test('alphanumeric code: CWGUG8', () => {
	assert.strictEqual(extractOTP('CWGUG8'), 'CWGUG8');
});

test('alphanumeric code with suffix', () => {
	assert.strictEqual(extractOTP('CWGUG8 is your code'), 'CWGUG8');
});

test('alphanumeric 8-char: 7645W453', () => {
	assert.strictEqual(extractOTP('7645W453'), '7645W453');
});

test('Portuguese: Código de Autorização', () => {
	assert.strictEqual(extractOTP('Código de Autorização: 12345678'), '12345678');
});

test('Portuguese: O seu código', () => {
	assert.strictEqual(extractOTP('O seu código: 12345678'), '12345678');
});

test('Chase 8-digit with expiry', () => {
	assert.strictEqual(extractOTP("Chase: DON'T share. Use code 89050683. Only use this online. Code expires in 10 min."), '89050683');
});

test('Facebook code', () => {
	assert.strictEqual(extractOTP('148966 is your Facebook code'), '148966');
});

test('does not match URL digits', () => {
	const code = extractOTP('Visit https://example.com/token/847291 for your code 593021');
	assert.strictEqual(code, '593021');
});

test('does not match phone numbers', () => {
	const code = extractOTP('Call 800-531-8722 if needed. Your code: 654321');
	assert.strictEqual(code, '654321');
});

test('returns null for no code', () => {
	assert.strictEqual(extractOTP('Hello, how are you today?'), null);
});

test('returns null for empty string', () => {
	assert.strictEqual(extractOTP(''), null);
});

test('returns null for null', () => {
	assert.strictEqual(extractOTP(null), null);
});

// ---- stripHtmlTags tests ----

test('strips basic HTML tags', () => {
	assert.strictEqual(stripHtmlTags('<p>Your code is <b>123456</b></p>'), 'Your code is 123456');
});

test('decodes HTML entities', () => {
	assert.strictEqual(stripHtmlTags('Tom &amp; Jerry &lt;3&gt;'), 'Tom & Jerry <3>');
});

test('replaces <br> with newline', () => {
	assert.strictEqual(stripHtmlTags('line1<br>line2<br/>line3'), 'line1\nline2\nline3');
});

test('handles null/empty', () => {
	assert.strictEqual(stripHtmlTags(''), '');
	assert.strictEqual(stripHtmlTags(null), '');
});

// ---- extractTextFromBinaryData tests ----

test('plain text passes through', () => {
	assert.strictEqual(extractTextFromBinaryData('Your verification code is: 123456'), 'Your verification code is: 123456');
});

test('returns empty for null/empty', () => {
	assert.strictEqual(extractTextFromBinaryData(''), '');
	assert.strictEqual(extractTextFromBinaryData(null), '');
});

test('detects NSArchiver binary and extracts text', () => {
	const binary = 'NSKeyedArchiver\x00\x84\x84\x12Your code is: 987654\x86';
	const result = extractTextFromBinaryData(binary);
	assert.ok(result.includes('987654'), `Expected 987654 in "${result}"`);
});

// ---- extractVerificationLink tests ----

test('extracts verification link from plain URL', () => {
	const result = extractVerificationLink('Please verify: https://example.com/verify?token=abc123');
	assert.ok(result);
	assert.strictEqual(result.type, 'verification');
	assert.ok(result.url.includes('example.com/verify'));
});

test('extracts sign-in link from href', () => {
	const result = extractVerificationLink('<a href="https://app.com/login?token=xyz">Sign in</a>');
	assert.ok(result);
	assert.strictEqual(result.type, 'sign-in');
});

test('returns null for unrelated URL', () => {
	const result = extractVerificationLink('Check out https://news.example.com/latest-trends');
	assert.strictEqual(result, null);
});

test('returns null for no links', () => {
	assert.strictEqual(extractVerificationLink('Just a regular message'), null);
});

console.log('\nAll OTP extraction tests passed!');
