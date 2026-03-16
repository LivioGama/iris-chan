#!/usr/bin/env node
// Standalone chess module — TARS for game vision, calibrated grid for clicks
// Usage: node scripts/chess-tars.js          (auto-play next move)
//        node scripts/chess-tars.js "e2 e4"  (manual move)

const { execSync } = require('child_process');
const fs = require('fs');

const TARS_URL = 'https://ts.onyxden.com/action';
const TARS_API_KEY = '3a5130687c176c5fb3a26d09e407dfe7d178d9cf0e81ee4a867172f8223499d8';

// ---- Board grid (calibrated: b1=815,730  h1=1210,738  d5=965,530) ----
// a1 = (749, 726), col step = 66px, row step = 50px
// Small y-skew per column due to 3D perspective

const BOARD = {
	a1x: 749, a1y: 726,
	colStep: 66,
	rowStep: 50,
	ySkewPerCol: 1.3, // y increases ~1.3px per column (3D tilt)
};

function squareToScreen(square) {
	const col = square.charCodeAt(0) - 97; // a=0, h=7
	const row = parseInt(square[1]) - 1;   // 1=0, 8=7
	return {
		x: Math.round(BOARD.a1x + col * BOARD.colStep),
		y: Math.round(BOARD.a1y + col * BOARD.ySkewPerCol - row * BOARD.rowStep),
	};
}

// ---- Click helpers ----

function click(x, y) {
	execSync(`cliclick dd:${x},${y} du:${x},${y}`);
}

function focusChess() {
	execSync('osascript -e \'tell application "Chess" to activate\'');
	execSync('sleep 0.3');
	// First click to focus the window
	const center = squareToScreen('d5');
	click(center.x, center.y);
	execSync('sleep 0.3');
}

function makeMove(from, to) {
	const src = squareToScreen(from);
	const dst = squareToScreen(to);
	console.log(`Moving ${from}(${src.x},${src.y}) → ${to}(${dst.x},${dst.y})`);
	focusChess();
	click(src.x, src.y);
	execSync('sleep 0.5');
	click(dst.x, dst.y);
}

// ---- Screen capture ----

function captureScreen() {
	const tmpPath = '/tmp/chess-tars-screenshot.jpg';
	execSync(`screencapture -x -D1 -t jpg "${tmpPath}"`);
	const sizeOut = execSync(`sips -g pixelWidth -g pixelHeight "${tmpPath}" 2>/dev/null`).toString();
	const pw = parseInt(sizeOut.match(/pixelWidth:\s*(\d+)/)?.[1] || '1920');
	const scale = pw > 2560 ? 2 : 1;
	const w = Math.round(pw / scale);
	if (scale > 1) execSync(`sips --resampleWidth ${w} "${tmpPath}" --out "${tmpPath}" >/dev/null 2>&1`);
	return fs.readFileSync(tmpPath).toString('base64');
}

// ---- Ask TARS what move to make ----

async function askTarsForMove() {
	const screenshot = captureScreen();
	const resp = await fetch(TARS_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-API-Key': TARS_API_KEY },
		body: JSON.stringify({
			screenshot_base64: screenshot,
			instruction: 'Look at the chess board. What is the best next move for white? Reply with the source and destination squares, like "e2 to e4" or "g1 to f3". Only give one move.',
			screen_width: 1800,
			screen_height: 1169,
		}),
		signal: AbortSignal.timeout(15000),
	});
	return resp.json();
}

// ---- Parse move from TARS response ----

function parseMove(thought) {
	if (!thought) return null;
	// "e2 to e4", "e2-e4", "e2 → e4"
	const m = thought.match(/([a-h][1-8])\s*(?:to|-|→)\s*([a-h][1-8])/i);
	if (m) return { from: m[1].toLowerCase(), to: m[2].toLowerCase() };
	// "from e2 to e4"
	const fromTo = thought.match(/from\s+([a-h][1-8])\s+to\s+([a-h][1-8])/i);
	if (fromTo) return { from: fromTo[1].toLowerCase(), to: fromTo[2].toLowerCase() };
	// "move to e4" / "can move to e4" with earlier mention of source
	const moveToMatch = thought.match(/([a-h][1-8]).*?(?:can\s+)?move\s+to\s+([a-h][1-8])/i);
	if (moveToMatch) return { from: moveToMatch[1].toLowerCase(), to: moveToMatch[2].toLowerCase() };
	// Find all unique squares mentioned, take first two distinct ones
	const allSquares = [...new Set((thought.match(/[a-h][1-8]/g) || []).map(s => s.toLowerCase()))];
	if (allSquares.length >= 2) return { from: allSquares[0], to: allSquares[1] };
	return null;
}

// ---- Main ----

async function run() {
	const manualMove = process.argv.slice(2).join(' ');
	if (manualMove && manualMove.match(/[a-h][1-8]/)) {
		const squares = manualMove.match(/[a-h][1-8]/g);
		if (squares?.length >= 2) {
			makeMove(squares[0], squares[1]);
			console.log('Done.');
			return;
		}
	}

	// Auto: ask TARS
	console.log('Asking TARS for best move...');
	const result = await askTarsForMove();
	console.log(`TARS: ${result.thought}`);

	const move = parseMove(result.thought);
	if (move) {
		makeMove(move.from, move.to);
		console.log('Done.');
	} else {
		console.log('Could not parse move. Try: node chess-tars.js "e2 e4"');
	}
}

run().catch(err => { console.error('Error:', err.message); process.exit(1); });
