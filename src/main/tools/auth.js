// Tool handler: auto_2fa — retrieve 2FA codes from Messages or Mail and auto-type them
const { exec } = require('child_process');
const { runHelper } = require('../native-helper');
const log = require('../logger');
const os = require('os');
const path = require('path');

// ---- HTML / text utilities ----

function stripHtmlTags(html) {
	if (!html) return '';
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
}

// ---- iMessage NSArchiver binary data decoder ----

const BINARY_MARKERS = ['streamtyped', 'NSArchiver', 'NSKeyedArchiver', 'NSMutableAttributedString', 'NSMutableString', 'NSString'];

function extractTextFromBinaryData(data) {
	if (!data) return '';
	const isBinary = BINARY_MARKERS.some(m => data.includes(m));
	if (!isBinary) return data;

	// Extract printable character sequences (≥3 chars)
	const segments = [];
	let current = '';
	for (let i = 0; i < data.length; i++) {
		const code = data.charCodeAt(i);
		// Printable ASCII, common Unicode, or whitespace
		if ((code >= 32 && code <= 126) || code >= 0x4E00 || (code >= 0x0600 && code <= 0x06FF) || (code >= 0x3000 && code <= 0x30FF) || code === 10 || code === 13) {
			current += data[i];
		} else {
			if (current.length >= 3) segments.push(current.trim());
			current = '';
		}
	}
	if (current.length >= 3) segments.push(current.trim());

	// Filter out class names and internal markers
	const filtered = segments.filter(s =>
		!s.startsWith('NS') &&
		!s.startsWith('__kIM') &&
		!s.startsWith('streamtyped') &&
		s.length >= 3
	);

	// Prefer segments with spaces (actual messages) over short tokens
	const withSpaces = filtered.filter(s => s.includes(' ') && s.length >= 10);
	if (withSpaces.length) return withSpaces.join(' ');
	return filtered.join(' ');
}

// ---- Verification link detection ----

const VERIFY_KEYWORDS = /\b(?:verify|confirm|activate|validate|verification|sign.?in|log.?in|authorize|auth)\b/i;
const VERIFY_URL_PATHS = /\/(?:verify|confirm|login|auth|signin|activate|validate|token=|code=)/i;

function extractVerificationLink(text) {
	if (!text) return null;
	// Check <a href="..."> tags first
	const hrefMatches = [...text.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)];
	for (const m of hrefMatches) {
		const url = m[1].replace(/&amp;/g, '&');
		const linkText = m[2];
		if (VERIFY_KEYWORDS.test(linkText) || VERIFY_URL_PATHS.test(url)) {
			const type = /sign.?in|log.?in|login/i.test(linkText + ' ' + url) ? 'sign-in' : 'verification';
			return { url, type };
		}
	}
	// Check plain URLs
	const urlMatches = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)];
	for (const m of urlMatches) {
		const url = m[0].replace(/&amp;/g, '&');
		if (VERIFY_URL_PATHS.test(url) || VERIFY_KEYWORDS.test(text)) {
			const type = /sign.?in|log.?in|login/i.test(url) ? 'sign-in' : 'verification';
			return { url, type };
		}
	}
	return null;
}

// ---- OTP extraction (Raycast-inspired, multilingual) ----

// Strip URLs and phone numbers before extraction to avoid false positives
function cleanTextForOTP(text) {
	return text
		.replace(/https?:\/\/[^\s]+/g, '')
		.replace(/\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '')
		.replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '');
}

// Keyword-anchored patterns (high confidence)
const OTP_PATTERNS = [
	/(?:G-|Google-)(\d{4,8})\b/,
	/(?:code|código|codice|Code|コード)[:\s：]+(\d{3,8})\b/i,
	/(?:验证码|認證碼)[:\s：]*(\d{3,8})\b/,
	/(?:verification|verify|confirma|Einmalcode)[:\s]+(\d{3,8})\b/i,
	/(?:OTP|otp|pin|PIN|passcode|パスワード)[:\s：]+(\d{3,8})\b/i,
	/\b(\d{3,8})\s+(?:is your|est votre|ist Ihr|è il tuo)/i,
	/\b(\d{3,8})\s+(?:code|Code|código)/i,
	/(?:enter|use|saisir|eingeben|inserisci)\s+(?:code\s+)?(\d{3,8})\b/i,
	/\b(\d{6})\b(?=.*(?:expire|valid|minute|min))/i,
	// Portuguese patterns
	/(?:Código de Autorização|O seu código)[:\s]+(\d{4,8})\b/i,
	/(?:Codigo de Autorizacao|O seu codigo)[:\s]+(\d{4,8})\b/i,
];

// Dashed codes: "719-839" → "719839"
const DASHED_CODE = /\b(\d{3,4})-(\d{3,4})\b/;

// Alphanumeric codes: "5WGU8G", "CWGUG8", "7645W453" (must have both letters and digits)
const ALPHANUM_CODE = /\b([A-Z0-9]{4,8})\b/g;
function isAlphanumericCode(s) {
	return /[A-Z]/i.test(s) && /\d/.test(s) && /^[A-Z0-9]+$/i.test(s);
}

function extractOTP(text) {
	if (!text) return null;
	const cleaned = cleanTextForOTP(text);

	// 1. Try keyword-anchored patterns (highest confidence)
	for (const pat of OTP_PATTERNS) {
		const m = cleaned.match(pat);
		if (m) return m[1];
	}

	// 2. Try dashed codes
	const dashed = cleaned.match(DASHED_CODE);
	if (dashed) return dashed[1] + dashed[2];

	// 3. Try alphanumeric codes (last match preferred per Raycast)
	const alphaMatches = [...cleaned.matchAll(ALPHANUM_CODE)].map(m => m[1]).filter(isAlphanumericCode);
	if (alphaMatches.length) return alphaMatches[alphaMatches.length - 1];

	// 4. Fallback: any 4-8 digit number, prefer 6-digit
	const allNums = [...cleaned.matchAll(/\b(\d{4,8})\b/g)].map(m => m[1]);
	const sixDigit = allNums.find(n => n.length === 6);
	if (sixDigit) return sixDigit;
	return allNums[0] || null;
}

function runShell(cmd, timeout = 8000) {
	return new Promise((resolve) => {
		exec(cmd, { timeout, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
			if (err) return resolve({ ok: false, output: stderr || err.message });
			resolve({ ok: true, output: stdout.trim() });
		});
	});
}

// Read recent iMessage/SMS from the Messages SQLite database
async function readMessages(maxAgeSeconds = 300) {
	const dbPath = path.join(os.homedir(), 'Library/Messages/chat.db');
	// Query messages from the last N seconds
	// Messages.app date epoch: 2001-01-01 (Core Data), stored as nanoseconds since that epoch
	const sql = `
		SELECT m.text, m.attributedBody, m.date, h.id as sender
		FROM message m
		LEFT JOIN handle h ON m.handle_id = h.ROWID
		WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
		  AND m.date > (strftime('%s','now') - 978307200 - ${maxAgeSeconds}) * 1000000000
		ORDER BY m.date DESC
		LIMIT 30;
	`;
	const cmd = `sqlite3 -separator '|||' "${dbPath}" "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
	const result = await runShell(cmd);
	if (!result.ok) {
		log.warn('Auth', 'Messages DB read failed:', result.output);
		return [];
	}
	return result.output.split('\n').filter(Boolean).map(line => {
		const parts = line.split('|||');
		const plainText = parts[0] || '';
		const binaryBody = parts[1] || '';
		// Use plain text if available, otherwise decode NSArchiver binary data
		const text = plainText || extractTextFromBinaryData(binaryBody);
		return { text, sender: parts[3] || 'unknown' };
	});
}

// Read recent emails from Mail.app via AppleScript
async function readMail(maxAgeSeconds = 300) {
	const script = `
tell application "Mail"
	set cutoff to (current date) - ${maxAgeSeconds}
	set results to ""
	repeat with acct in accounts
		repeat with mbox in mailboxes of acct
			if name of mbox is "INBOX" then
				set msgs to (messages of mbox whose date received > cutoff)
				repeat with msg in msgs
					set results to results & subject of msg & " | " & (content of msg) & "\\n---\\n"
				end repeat
			end if
		end repeat
	end repeat
	return results
end tell`;
	const cmd = `osascript -e '${script.replace(/'/g, "'\\''")}'`;
	const result = await runShell(cmd, 15000);
	if (!result.ok) {
		log.warn('Auth', 'Mail.app read failed:', result.output);
		return [];
	}
	return result.output.split('---').filter(Boolean).map(chunk => ({
		text: stripHtmlTags(chunk.trim()),
		sender: 'mail',
	}));
}

// Read recent notifications from Notification Center via AppleScript
async function readNotifications() {
	// Grab notification text that's currently visible (recent banners)
	const script = `
tell application "System Events"
	set notifTexts to ""
	try
		set notifGroup to group 1 of UI element 1 of scroll area 1 of window "Notification Center" of application process "NotificationCenter"
		repeat with n in (every UI element of notifGroup)
			set notifTexts to notifTexts & (value of static text 1 of n) & " "
		end repeat
	end try
	return notifTexts
end tell`;
	const result = await runShell(`osascript -e '${script.replace(/'/g, "'\\''")}'`, 5000);
	if (!result.ok || !result.output) return [];
	return [{ text: result.output, sender: 'notification' }];
}

// ---- Fresh scan (used by get_codes when cache is empty) ----

async function freshScan(maxAge = 300) {
	const allMessages = [];
	const [msgs, mails, notifs] = await Promise.allSettled([
		readMessages(maxAge),
		readMail(maxAge),
		readNotifications(),
	]);
	if (msgs.status === 'fulfilled') allMessages.push(...msgs.value.map(m => ({ ...m, source: 'messages' })));
	if (mails.status === 'fulfilled') allMessages.push(...mails.value.map(m => ({ ...m, source: 'mail' })));
	if (notifs.status === 'fulfilled') allMessages.push(...notifs.value.map(m => ({ ...m, source: 'notifications' })));

	const codes = [];
	for (const msg of allMessages) {
		const code = extractOTP(msg.text);
		if (code) {
			codes.push({ code, source: msg.source, sender: msg.sender, text: msg.text, timestamp: Date.now() });
		}
	}
	return codes;
}

// ---- Tool: get_codes — list available 2FA codes (masked) ----

async function get_codes(args) {
	try {
		const twoFA = require('../two-fa');

		// Check cache first
		let codes = twoFA.getRecentCodes(args.limit || 5);

		// If cache empty or refresh requested, do fresh scan and populate cache
		if (!codes.length || args.refresh) {
			const maxAge = parseInt(args.max_age_seconds) || 300;
			const fresh = await freshScan(maxAge);
			for (const c of fresh) {
				// Add to cache via orchestrator (if available)
				// For direct tool use, just return fresh results
				codes.push({
					maskedCode: c.code.slice(0, 2) + '*'.repeat(Math.max(0, c.code.length - 2)),
					source: c.source,
					sender: c.sender,
					snippet: (c.text || '').replace(c.code, '').replace(/\s+/g, ' ').trim().slice(0, 80),
					age: 'just now',
				});
			}
		}

		if (!codes.length) {
			return { ok: true, result: 'No verification codes found in recent messages, email, or notifications.' };
		}

		const lines = codes.map((c, i) => `${i + 1}. [${c.maskedCode}] from ${c.source} (${c.sender || 'unknown'}) — ${c.age}${c.snippet ? ': ' + c.snippet : ''}`);
		return { ok: true, result: `Found ${codes.length} code(s):\n${lines.join('\n')}` };
	} catch (err) {
		log.error('Auth', 'get_codes error:', err.message);
		return { ok: false, result: `Error: ${err.message}` };
	}
}

// ---- Tool: paste_code — paste a specific code into the focused field ----

async function paste_code(args) {
	try {
		const twoFA = require('../two-fa');
		const keyword = (args.source || args.keyword || 'latest').toLowerCase();

		// Look up full code from cache
		let fullCode = twoFA.getFullCode(keyword);

		// If not in cache, do a fresh scan
		if (!fullCode) {
			const fresh = await freshScan(parseInt(args.max_age_seconds) || 300);
			if (fresh.length) {
				// Try keyword match on fresh results
				const match = fresh.find(c =>
					(c.sender || '').toLowerCase().includes(keyword) ||
					(c.source || '').toLowerCase().includes(keyword) ||
					(c.text || '').toLowerCase().includes(keyword)
				) || fresh[0]; // fallback to most recent
				fullCode = match?.code;
			}
		}

		if (!fullCode) {
			return { ok: false, result: `No code found matching "${keyword}". Try get_codes first to see available codes.` };
		}

		const masked = fullCode.slice(0, 2) + '*'.repeat(Math.max(0, fullCode.length - 2));
		log.info('Auth', `Pasting code ${masked} for "${keyword}"`);

		const typeResult = await runHelper({ action: 'type_text', text: fullCode });
		if (!typeResult.ok) {
			return { ok: false, result: `Found code ${masked} but failed to type it: ${typeResult.result}` };
		}
		return { ok: true, result: `Pasted ${fullCode.length}-digit code (${masked}) into the focused field.` };
	} catch (err) {
		log.error('Auth', 'paste_code error:', err.message);
		return { ok: false, result: `Error: ${err.message}` };
	}
}

// Legacy tool — kept for backward compatibility, delegates to new tools
async function auto_2fa(args) {
	if (args.auto_type === false) {
		return get_codes(args);
	}
	return paste_code({ source: args.source || 'latest', max_age_seconds: args.max_age_seconds });
}

module.exports = { auto_2fa, get_codes, paste_code, readMessages, readMail, readNotifications, extractOTP, freshScan, stripHtmlTags, extractTextFromBinaryData, extractVerificationLink };
