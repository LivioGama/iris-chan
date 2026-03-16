// Chess board interaction — auto-calibrates from window position
// Falls back to UI-TARS when available for higher precision
const { execSync } = require('child_process');
const fs = require('fs');

const TARS_URL = 'https://ts.onyxden.com/action';
const TARS_API_KEY = '3a5130687c176c5fb3a26d09e407dfe7d178d9cf0e81ee4a867172f8223499d8';

const log = (() => { try { return require('../logger'); } catch { return null; } })();
function info(...args) { log ? log.info('Chess-Board', ...args) : console.log('[Chess-Board]', ...args); }

// ---- Grid-based clicking (auto-calibrated from window position) ----

function getWindowBounds() {
	const out = execSync(`osascript -e 'tell application "System Events" to tell process "Chess" to get {position, size} of window 1'`).toString().trim();
	const nums = out.split(',').map(s => parseInt(s.trim()));
	return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
}

function squareToScreen(square) {
	const win = getWindowBounds();
	const boardLeft = win.x + win.w * 0.295;
	const boardRight = win.x + win.w * 0.735;
	const boardTop = win.y + win.h * 0.12;
	const boardBottom = win.y + win.h * 0.77;
	const colStep = (boardRight - boardLeft) / 8;
	const rowStep = (boardBottom - boardTop) / 8;

	const col = square.charCodeAt(0) - 97;
	const row = parseInt(square[1]) - 1;
	return {
		x: Math.round(boardLeft + (col + 0.5) * colStep),
		y: Math.round(boardBottom - (row + 0.5) * rowStep),
	};
}

// ---- Click helpers ----

function click(x, y) {
	execSync(`cliclick dd:${x},${y} du:${x},${y}`);
}

function focusApp() {
	execSync('osascript -e \'tell application "Chess" to activate\'');
	execSync('sleep 0.3');
	const center = squareToScreen('d5');
	click(center.x, center.y);
	execSync('sleep 0.3');
}

async function makeMove(from, to) {
	focusApp();

	const src = squareToScreen(from);
	const dst = squareToScreen(to);
	info(`${from}(${src.x},${src.y}) → ${to}(${dst.x},${dst.y})`);

	click(src.x, src.y);
	await new Promise(r => setTimeout(r, 500));
	click(dst.x, dst.y);

	return { ok: true, from, to };
}

module.exports = { squareToScreen, makeMove, focusApp, click };
