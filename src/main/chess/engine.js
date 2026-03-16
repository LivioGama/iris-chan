// Chess engine — continuous loop that watches the board and plays moves
const { analyzeBoard, parseMove } = require('./vision');
const { makeMove } = require('./board');

const log = (() => { try { return require('../logger'); } catch { return null; } })();
function info(...args) { log ? log.info('Chess', ...args) : console.log('[Chess]', ...args); }
function warn(...args) { log ? log.warn('Chess', ...args) : console.warn('[Chess]', ...args); }

class ChessEngine {
	constructor({ eventBus, settings = {} } = {}) {
		this._eventBus = eventBus || null;
		this._pollMs = settings.pollMs || 8000;
		this._timer = null;
		this._playing = false;
		this._enabled = settings.enabled !== false;
		this._moveCount = 0;
		this._moveHistory = []; // tracks all moves played to avoid repeats
	}

	start() {
		if (this._timer) return;
		info(`Starting chess engine (poll: ${this._pollMs}ms)`);
		this._timer = setInterval(() => this._tick(), this._pollMs);
		this._emit('CHESS_ENGINE_STARTED', {});
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		info('Chess engine stopped');
		this._emit('CHESS_ENGINE_STOPPED', {});
	}

	getStatus() {
		return {
			enabled: this._enabled,
			running: !!this._timer,
			moveCount: this._moveCount,
			moveHistory: this._moveHistory,
		};
	}

	async _tick() {
		if (this._playing) return;
		this._playing = true;
		try {
			info('Analyzing board...');
			const result = await analyzeBoard(this._moveHistory);
			if (!result.ok) {
				warn('Vision failed:', result.error);
				return;
			}

			const response = result.text.replace(/\n/g, ' ').slice(0, 200);
			info(`Gemini: ${response}`);
			const move = parseMove(result.text);

			if (!move) {
				info('No move parsed');
				return;
			}

			if (move.wait) {
				info('Waiting (not our turn)');
				return;
			}

			// Check if this exact move was already played
			const moveStr = `${move.from} to ${move.to}`;
			if (this._moveHistory.includes(moveStr)) {
				info(`Skipping already-played move: ${moveStr}`);
				return;
			}

			info(`Playing: ${move.from} → ${move.to}`);
			this._emit('CHESS_MOVE_START', { from: move.from, to: move.to });

			makeMove(move.from, move.to);
			this._moveCount++;
			this._moveHistory.push(moveStr);

			info(`Move #${this._moveCount}: ${moveStr}`);
			this._emit('CHESS_MOVE_DONE', { from: move.from, to: move.to, moveCount: this._moveCount });

			// Wait for computer to respond before next tick
			info('Waiting for computer response...');
			await new Promise(r => setTimeout(r, 5000));
		} catch (err) {
			warn('Tick error:', err.message);
		} finally {
			this._playing = false;
		}
	}

	_emit(type, payload) {
		try { this._eventBus?.emitEvent?.(type, payload, 'chess'); } catch {}
	}
}

module.exports = { ChessEngine };
