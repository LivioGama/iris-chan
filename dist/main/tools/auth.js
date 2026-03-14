"use strict";
// Tool handler: auto_2fa — retrieve 2FA codes from Messages or Mail and auto-type them
const { exec } = require('child_process');
const { runHelper } = require('../native-helper');
const log = require('../logger');
const os = require('os');
const path = require('path');
// Common OTP regex patterns (4-8 digit codes with surrounding context)
const OTP_PATTERNS = [
    /(?:code|código|codice|Code)[:\s]+(\d{4,8})\b/i,
    /(?:verification|verify|confirma)[:\s]+(\d{4,8})\b/i,
    /(?:OTP|otp|pin|PIN)[:\s]+(\d{4,8})\b/i,
    /\b(\d{4,8})\s+(?:is your|est votre|ist Ihr|è il tuo)/i,
    /\b(\d{4,8})\s+(?:code|Code|código)/i,
    /(?:enter|use|saisir|eingeben|inserisci)\s+(\d{4,8})\b/i,
    /(?:G-|Google-)(\d{4,8})\b/,
    /\b(\d{6})\b(?=.*(?:expire|valid|minute|min))/i,
];
// Fallback: standalone 4-8 digit number (less precise)
const FALLBACK_OTP = /\b(\d{4,8})\b/;
function extractOTP(text) {
    for (const pat of OTP_PATTERNS) {
        const m = text.match(pat);
        if (m)
            return m[1];
    }
    // Fallback: find any 4-8 digit number, prefer 6-digit
    const allNums = [...text.matchAll(/\b(\d{4,8})\b/g)].map(m => m[1]);
    const sixDigit = allNums.find(n => n.length === 6);
    if (sixDigit)
        return sixDigit;
    return allNums[0] || null;
}
function runShell(cmd, timeout = 8000) {
    return new Promise((resolve) => {
        exec(cmd, { timeout, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
            if (err)
                return resolve({ ok: false, output: stderr || err.message });
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
		SELECT m.text, m.date, h.id as sender
		FROM message m
		LEFT JOIN handle h ON m.handle_id = h.ROWID
		WHERE m.text IS NOT NULL
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
        return { text: parts[0] || '', sender: parts[2] || 'unknown' };
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
        text: chunk.trim(),
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
    if (!result.ok || !result.output)
        return [];
    return [{ text: result.output, sender: 'notification' }];
}
async function auto_2fa(args) {
    const source = (args.source || 'auto').toLowerCase();
    const autoType = args.auto_type !== false; // default true
    const maxAge = parseInt(args.max_age_seconds) || 300; // default 5 minutes
    let allMessages = [];
    try {
        // Gather messages from requested sources
        if (source === 'messages' || source === 'auto') {
            const msgs = await readMessages(maxAge);
            allMessages.push(...msgs);
        }
        if (source === 'mail' || source === 'auto') {
            const mails = await readMail(maxAge);
            allMessages.push(...mails);
        }
        if (source === 'notifications' || source === 'auto') {
            const notifs = await readNotifications();
            allMessages.push(...notifs);
        }
        if (allMessages.length === 0) {
            return { ok: false, result: `No recent messages found (checked ${source}, last ${maxAge}s)` };
        }
        // Scan all messages for OTP codes
        for (const msg of allMessages) {
            const code = extractOTP(msg.text);
            if (code) {
                log.info('Auth', `Found 2FA code: ${'*'.repeat(code.length)} from ${msg.sender}`);
                if (autoType) {
                    // Type the code into the focused field
                    const typeResult = await runHelper({ action: 'type_text', text: code });
                    if (!typeResult.ok) {
                        return { ok: true, result: `Found code ${code} from ${msg.sender}, but failed to type it: ${typeResult.result}` };
                    }
                    return { ok: true, result: `Found and typed ${code.length}-digit code from ${msg.sender}` };
                }
                return { ok: true, result: `Found ${code.length}-digit code: ${code} (from ${msg.sender})` };
            }
        }
        return { ok: false, result: `Checked ${allMessages.length} recent messages but found no verification code` };
    }
    catch (err) {
        log.error('Auth', 'auto_2fa error:', err.message);
        return { ok: false, result: `Error: ${err.message}` };
    }
}
module.exports = { auto_2fa };
