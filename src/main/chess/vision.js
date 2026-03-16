// Chess vision — uses Gemini Flash to analyze the board and suggest moves
const { execSync } = require('child_process');
const fs = require('fs');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent';

function getApiKey() {
	try {
		const config = require('../../shared/config').default;
		return config.gemini?.apiKey || process.env.GEMINI_API_KEY;
	} catch {
		return process.env.GEMINI_API_KEY;
	}
}

function captureBoard() {
	const tmpPath = '/tmp/iris-chess-screenshot.jpg';
	execSync(`screencapture -x -D1 -t jpg "${tmpPath}"`);
	const sizeOut = execSync(`sips -g pixelWidth -g pixelHeight "${tmpPath}" 2>/dev/null`).toString();
	const pw = parseInt(sizeOut.match(/pixelWidth:\s*(\d+)/)?.[1] || '1920');
	const scale = pw > 2560 ? 2 : 1;
	if (scale > 1) {
		const w = Math.round(pw / scale);
		try { execSync(`sips --resampleWidth ${w} "${tmpPath}" --out "${tmpPath}" >/dev/null 2>&1`); } catch {}
	}
	return fs.readFileSync(tmpPath).toString('base64');
}

function buildPrompt(moveHistory) {
	const historyText = moveHistory.length
		? `\nMoves already played this game:\n${moveHistory.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nDo NOT suggest any move already in this list.`
		: '';

	return `You are a chess grandmaster analyzing a macOS Chess.app screenshot. The board is 3D rendered.

IMPORTANT: Look carefully at the ACTUAL piece positions. Do NOT assume it's the starting position — pieces may have moved. Check each rank carefully.

Steps:
1. Read the title bar — it tells you whose turn it is ("White to Move" or "Black to Move")
2. If it says "Black to Move", reply exactly: WAIT
3. If it says "White to Move", look at all white pieces and find the best move
4. Reply with exactly one line: MOVE: [from] to [to] (e.g., MOVE: e2 to e4)
${historyText}

Think about: controlling the center, developing pieces (knights and bishops early), castling for king safety, not moving the same piece twice in the opening.`;
}

async function analyzeBoard(moveHistory = []) {
	const apiKey = getApiKey();
	if (!apiKey) return { ok: false, error: 'No GEMINI_API_KEY' };

	const base64 = captureBoard();
	const prompt = buildPrompt(moveHistory);

	const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			contents: [{
				parts: [
					{ text: prompt },
					{ inlineData: { mimeType: 'image/jpeg', data: base64 } },
				],
			}],
			generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
		}),
		signal: AbortSignal.timeout(15000),
	});

	if (!resp.ok) {
		const body = await resp.text().catch(() => '');
		return { ok: false, error: `Gemini API error: ${resp.status} — ${body.slice(0, 200)}` };
	}

	const data = await resp.json();
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
	return { ok: true, text };
}

function parseMove(text) {
	if (!text) return null;
	if (/\bWAIT\b/i.test(text)) return { wait: true };

	const m = text.match(/MOVE:\s*([a-h][1-8])\s*(?:to|-|→)\s*([a-h][1-8])/i);
	if (m) return { from: m[1].toLowerCase(), to: m[2].toLowerCase() };

	const squares = [...new Set((text.match(/[a-h][1-8]/g) || []).map(s => s.toLowerCase()))];
	if (squares.length >= 2) return { from: squares[0], to: squares[1] };

	return null;
}

module.exports = { analyzeBoard, parseMove, captureBoard };
