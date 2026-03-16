// Vision-based 2FA field detection via screencapture + Gemini Flash
// Standalone — no Electron imports
const { execSync } = require('child_process');
const fs = require('fs');

let log;
try { log = require('../logger'); } catch { log = console; }

const TAG = '2FA-Detector';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_PROMPT = 'Is there a 2FA, OTP, verification code, or MFA input field visible on screen? Reply YES or NO only.';
const SCREENSHOT_PATH = '/tmp/iris-2fa-screenshot.jpg';

function getApiKey() {
	if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
	try { return require('../../shared/config').default.gemini.apiKey; } catch {}
	return null;
}

/**
 * Capture the main display as a JPEG, resize to 800px wide.
 * @returns {string} base64-encoded JPEG
 */
function captureScreen() {
	execSync(`screencapture -x -D1 -t jpg "${SCREENSHOT_PATH}"`);

	const sizeOut = execSync(`sips -g pixelWidth "${SCREENSHOT_PATH}" 2>/dev/null`).toString();
	const pw = parseInt(sizeOut.match(/pixelWidth:\s*(\d+)/)?.[1] || '1920');
	if (pw > 800) {
		execSync(`sips --resampleWidth 800 "${SCREENSHOT_PATH}" --out "${SCREENSHOT_PATH}" >/dev/null 2>&1`);
	}

	return fs.readFileSync(SCREENSHOT_PATH).toString('base64');
}

/**
 * Detect whether a 2FA / OTP input field is visible on screen.
 * @returns {Promise<{ detected: boolean, screenshot: string }>}
 */
async function detect2FAField() {
	const nil = { detected: false, screenshot: '' };

	let screenshot;
	try {
		screenshot = captureScreen();
		log.info?.(TAG, 'Screenshot captured, asking Gemini…') ?? log.log?.(`[${TAG}] Screenshot captured, asking Gemini…`);
	} catch (err) {
		(log.warn ?? log.error)?.(TAG, `Screenshot failed: ${err.message}`);
		return nil;
	}

	const apiKey = getApiKey();
	if (!apiKey) {
		(log.warn ?? log.error)?.(TAG, 'No GEMINI_API_KEY available');
		return { detected: false, screenshot };
	}

	const body = {
		contents: [{
			parts: [
				{ text: GEMINI_PROMPT },
				{ inlineData: { mimeType: 'image/jpeg', data: screenshot } },
			],
		}],
		generationConfig: { temperature: 0, maxOutputTokens: 16 },
	};

	try {
		const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(8000),
		});

		if (!resp.ok) {
			const errBody = await resp.text().catch(() => '');
			(log.warn ?? log.error)?.(TAG, `Gemini API ${resp.status}: ${errBody.slice(0, 200)}`);
			return { detected: false, screenshot };
		}

		const data = await resp.json();
		const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase();
		log.info?.(TAG, `Gemini response: ${text}`) ?? log.log?.(`[${TAG}] Gemini response: ${text}`);

		const detected = text.includes('yes');
		return { detected, screenshot };
	} catch (err) {
		(log.warn ?? log.error)?.(TAG, `Gemini request failed: ${err.message}`);
		return { detected: false, screenshot };
	}
}

module.exports = { detect2FAField, captureScreen };
