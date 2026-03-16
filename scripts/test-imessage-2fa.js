#!/usr/bin/env node
// Quick test: read recent iMessages and extract 2FA codes
const { readMessages, extractOTP } = require('../src/main/tools/auth');

(async () => {
	const maxAge = parseInt(process.argv[2]) || 300;
	console.log(`Reading recent iMessages (last ${maxAge}s)...\n`);

	const msgs = await readMessages(maxAge);

	if (!msgs.length) {
		console.log('No messages found in the last 5 minutes.');
		return;
	}

	console.log(`Found ${msgs.length} message(s):\n`);

	for (const msg of msgs) {
		const code = extractOTP(msg.text);
		const preview = (msg.text || '').slice(0, 120).replace(/\n/g, ' ');
		console.log(`  From: ${msg.sender}`);
		console.log(`  Text: ${preview}`);
		if (code) {
			console.log(`  >>> OTP CODE: ${code}`);
		} else {
			console.log(`  (no OTP detected)`);
		}
		console.log();
	}

	const codes = msgs.map(m => extractOTP(m.text)).filter(Boolean);
	if (codes.length) {
		console.log(`=== ${codes.length} code(s) extracted: ${codes.join(', ')} ===`);
	} else {
		console.log('=== No 2FA codes found in recent messages ===');
	}
})();
