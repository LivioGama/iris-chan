// Chess module — can run standalone or be launched by Iris
//
// Standalone:  node src/main/chess/index.js
// From Iris:   const chess = require('./chess'); chess.init({ eventBus });
// Manual move: node src/main/chess/index.js e2 e4

const { ChessEngine } = require('./engine');
const { makeMove } = require('./board');

let instance = null;

function init({ eventBus, settings = {} } = {}) {
	if (instance) return instance;
	instance = new ChessEngine({ eventBus, settings });
	instance.start();
	return instance;
}

function shutdown() {
	if (instance) {
		instance.stop();
		instance = null;
	}
}

function getStatus() {
	return instance ? instance.getStatus() : { enabled: false, running: false };
}

module.exports = { init, shutdown, getStatus, makeMove };

// ---- Standalone entry point ----
if (require.main === module) {
	const args = process.argv.slice(2).join(' ');
	const squares = args.match(/[a-h][1-8]/g);

	if (squares?.length >= 2) {
		// Manual move: node src/main/chess/index.js e2 e4
		console.log(`Moving ${squares[0]} → ${squares[1]}`);
		makeMove(squares[0], squares[1]).then(() => console.log('Done.')).catch(e => console.error(e.message));
	} else {
		// Continuous play: node src/main/chess/index.js
		console.log('Chess engine starting (Ctrl+C to stop)...');
		const engine = init({ settings: { pollMs: 8000 } });

		process.on('SIGINT', () => {
			console.log('\nStopping...');
			shutdown();
			process.exit(0);
		});
	}
}
