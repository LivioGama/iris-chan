// Tool handlers: game interaction, move execution, state recognition
const { runHelper } = require('../native-helper');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse board state from visual description
// Expected format: "a1:♙,a2:empty,b1:♖,..." or similar
function parseBoard(boardDescription) {
	const squares = {};
	const pairs = boardDescription.split(',');
	for (const pair of pairs) {
		const [pos, piece] = pair.split(':');
		if (pos && piece) {
			squares[pos.trim()] = piece.trim();
		}
	}
	return squares;
}

// Validate chess move (basic validation)
function isValidChessMove(from, to) {
	const validSquares = new Set();
	for (let file = 97; file <= 104; file++) { // a-h
		for (let rank = 1; rank <= 8; rank++) {
			validSquares.add(String.fromCharCode(file) + rank);
		}
	}
	return validSquares.has(from) && validSquares.has(to) && from !== to;
}

// Convert chess notation (a1) to screen coordinates (requires board analysis)
async function getSquareCoordinates(square, boardInfo) {
	// boardInfo should contain: boardX, boardY, squareSize, or full boardLayout
	if (!boardInfo) {
		return { ok: false, result: 'Board information not provided' };
	}

	const file = square.charCodeAt(0) - 97; // a=0, h=7
	const rank = parseInt(square[1]) - 1; // 1=0, 8=7

	// Assuming board is displayed with a1 at bottom-left
	const x = boardInfo.boardX + (file * boardInfo.squareSize) + (boardInfo.squareSize / 2);
	const y = boardInfo.boardY + ((7 - rank) * boardInfo.squareSize) + (boardInfo.squareSize / 2);

	return { x, y };
}

// Execute a chess move via drag and drop
async function make_game_move(args) {
	const moveFrom = (args.from || '').toLowerCase();
	const moveTo = (args.to || '').toLowerCase();

	if (!moveFrom || !moveTo) {
		return { ok: false, result: 'Missing "from" or "to" square (e.g., "a2", "e4")' };
	}

	// Validate move notation
	if (!isValidChessMove(moveFrom, moveTo)) {
		return { ok: false, result: `Invalid move: ${moveFrom} to ${moveTo}` };
	}

	try {
		// Get board layout from args or auto-detect
		const boardInfo = args.boardInfo || {};

		if (!boardInfo.boardX || !boardInfo.squareSize) {
			// Auto-detect board (simplified: assumes 8x8 grid starting at typical position)
			// In real usage, this should analyze a screenshot
			boardInfo.boardX = boardInfo.boardX || 100;
			boardInfo.boardY = boardInfo.boardY || 100;
			boardInfo.squareSize = boardInfo.squareSize || 60;
		}

		// Get the target app name (Chess app, or specified app)
		const targetApp = args.target_app || 'Chess';

		// Calculate pixel coordinates for from and to squares
		const file1 = moveFrom.charCodeAt(0) - 97;
		const rank1 = parseInt(moveFrom[1]) - 1;
		const fromX = boardInfo.boardX + (file1 * boardInfo.squareSize) + (boardInfo.squareSize / 2);
		const fromY = boardInfo.boardY + ((7 - rank1) * boardInfo.squareSize) + (boardInfo.squareSize / 2);

		const file2 = moveTo.charCodeAt(0) - 97;
		const rank2 = parseInt(moveTo[1]) - 1;
		const toX = boardInfo.boardX + (file2 * boardInfo.squareSize) + (boardInfo.squareSize / 2);
		const toY = boardInfo.boardY + ((7 - rank2) * boardInfo.squareSize) + (boardInfo.squareSize / 2);

		// CRITICAL: Ensure the target app is focused BEFORE the drag to prevent focus switching
		await runHelper({
			action: 'activate_app',
			name: targetApp,
		});

		// Small delay to ensure the app is fully focused before drag starts
		await new Promise(r => setTimeout(r, 150));

		// Execute drag operation while target app is focused
		const dragResult = await runHelper({
			action: 'drag',
			x: fromX,
			y: fromY,
			x2: toX,
			y2: toY,
		});

		if (!dragResult.ok) {
			return dragResult;
		}

		return {
			ok: true,
			result: `Moved piece from ${moveFrom} to ${moveTo} at pixels (${Math.round(fromX)},${Math.round(fromY)}) → (${Math.round(toX)},${Math.round(toY)})`,
		};
	} catch (err) {
		return { ok: false, result: `Move error: ${err.message}` };
	}
}

// Analyze board state from screenshot and identify pieces
async function analyze_board_state(args) {
	try {
		// Expected args: screenshot path or region (x, y, width, height)
		const region = args.region || 'fullscreen';

		// Take screenshot of the board area
		// This would integrate with screen-capture.js in a real implementation
		return {
			ok: true,
			result: 'Board analysis requires screenshot integration. Provide board state manually or use OCR tool.',
			suggestion: 'Use click_at to interact with pieces, or provide board configuration via make_game_move boardInfo parameter',
		};
	} catch (err) {
		return { ok: false, result: `Board analysis error: ${err.message}` };
	}
}

// Highlight legal moves for the selected piece (visual feedback)
async function highlight_moves(args) {
	const square = (args.square || '').toLowerCase();
	const moves = args.legal_moves || []; // Array of valid destination squares

	if (!square) {
		return { ok: false, result: 'Missing "square" parameter' };
	}

	if (!Array.isArray(moves) || moves.length === 0) {
		return { ok: false, result: 'No legal moves provided' };
	}

	try {
		// In a web-based game, this would click the piece and highlight moves
		// For now, just track the highlighted moves for reference
		return {
			ok: true,
			result: `Would highlight ${moves.length} legal moves for ${square}: ${moves.join(', ')}`,
			moves: moves,
		};
	} catch (err) {
		return { ok: false, result: `Highlight error: ${err.message}` };
	}
}

// Click on a specific piece or square
async function click_piece(args) {
	const square = (args.square || '').toLowerCase();
	const boardInfo = args.boardInfo || {};

	if (!square) {
		return { ok: false, result: 'Missing "square" parameter' };
	}

	if (!boardInfo.boardX || !boardInfo.squareSize) {
		boardInfo.boardX = boardInfo.boardX || 100;
		boardInfo.boardY = boardInfo.boardY || 100;
		boardInfo.squareSize = boardInfo.squareSize || 60;
	}

	try {
		const file = square.charCodeAt(0) - 97;
		const rank = parseInt(square[1]) - 1;
		const x = boardInfo.boardX + (file * boardInfo.squareSize) + (boardInfo.squareSize / 2);
		const y = boardInfo.boardY + ((7 - rank) * boardInfo.squareSize) + (boardInfo.squareSize / 2);

		const result = await runHelper({
			action: 'click_at',
			x,
			y,
			button: args.button || 'left',
		});

		return {
			ok: result.ok,
			result: `Clicked ${square} at (${Math.round(x)}, ${Math.round(y)})`,
		};
	} catch (err) {
		return { ok: false, result: `Click error: ${err.message}` };
	}
}

// Detect board layout from screenshot (AI-assisted)
async function detect_board_layout(args) {
	try {
		// This should use visual detection to find:
		// - Board position on screen
		// - Square size
		// - Piece positions

		// Simplified implementation for now
		return {
			ok: true,
			result: 'Board layout detection requires vision API integration. Use manual boardInfo for now.',
			recommendation: 'Provide boardInfo with boardX, boardY, and squareSize to make_game_move',
		};
	} catch (err) {
		return { ok: false, result: `Detection error: ${err.message}` };
	}
}

module.exports = {
	make_game_move,
	analyze_board_state,
	highlight_moves,
	click_piece,
	detect_board_layout,
};
