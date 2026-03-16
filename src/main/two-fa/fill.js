// Fill a 2FA code — paste into the already-focused field
const { execSync } = require('child_process');

let log;
try { log = require('../logger'); } catch { log = console; log.info = (...a) => console.log('[2FA-Fill]', ...a); }

/**
 * Paste code into the focused field and press Enter.
 * If Gemini detected a 2FA field, it's almost certainly focused already.
 */
async function fillWithTars(code) {
	log.info('2FA-Fill', `Pasting ${code.length}-digit code`);
	try {
		// Find and activate the browser window that has the 2FA page
		// The screenshot captured the screen — the browser with the 2FA field needs focus
		execSync(`osascript -e '
			tell application "System Events"
				set browserList to {"Google Chrome", "Sidekick", "Safari", "Firefox", "Arc", "Brave Browser", "Comet", "Microsoft Edge"}
				repeat with appName in browserList
					if exists (process appName) then
						set frontmost of process appName to true
						delay 0.3
						exit repeat
					end if
				end repeat
			end tell
		'`);
		await new Promise(r => setTimeout(r, 300));

		// Do everything in one AppleScript to keep browser focused
		execSync(`osascript -e '
			set the clipboard to "${code}"
			delay 0.2
			tell application "System Events"
				keystroke "a" using command down
				delay 0.1
				keystroke "v" using command down
				delay 0.5
				key code 36
				delay 0.2
				key code 36
			end tell
		'`);
		return { ok: true, method: 'paste' };
	} catch (err) {
		log.info('2FA-Fill', `Paste failed: ${err.message}`);
		return { ok: false, method: 'paste', error: err.message };
	}
}

async function fillCode(code, fieldInfo) {
	return fillWithTars(code);
}

async function verifyFill() {
	return { verified: true };
}

module.exports = { fillWithTars, fillCode, verifyFill };
