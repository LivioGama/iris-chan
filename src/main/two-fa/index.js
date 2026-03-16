// 2FA module — can run standalone or be launched by Iris
//
// Standalone:  node src/main/two-fa/index.js
// From Iris:   const twoFA = require('./two-fa'); twoFA.init({ eventBus });

const { TwoFAOrchestrator } = require('./orchestrator');
const log = require('../logger');

let instance = null;

function init({ eventBus, behaviorEngine, settings = {} } = {}) {
	if (instance) {
		log.warn('2FA', 'Already initialized, ignoring duplicate init');
		return instance;
	}
	instance = new TwoFAOrchestrator({ eventBus, behaviorEngine, settings });
	instance.start();
	log.info('2FA', 'Proactive 2FA system initialized');
	return instance;
}

function shutdown() {
	if (instance) {
		instance.stop();
		instance = null;
		log.info('2FA', 'Proactive 2FA system shut down');
	}
}

function getStatus() {
	return instance ? instance.getStatus() : { enabled: false, running: false };
}

function updateSettings(settings) {
	if (instance) instance.updateSettings(settings);
}

function getRecentCodes(limit = 5) {
	return instance ? instance.getRecentCodes(limit) : [];
}

function getCodeByKeyword(keyword) {
	return instance ? instance.getCodeByKeyword(keyword) : null;
}

function getFullCode(keywordOrMasked) {
	return instance ? instance.getFullCode(keywordOrMasked) : null;
}

module.exports = { init, shutdown, getStatus, updateSettings, getRecentCodes, getCodeByKeyword, getFullCode };

// ---- Standalone entry point ----
if (require.main === module) {
	const args = process.argv.slice(2);

	if (args[0] === 'scan') {
		// One-shot scan: node src/main/two-fa/index.js scan
		const { freshScan, extractOTP } = require('../tools/auth');
		const maxAge = parseInt(args[1]) || 300;
		console.log(`Scanning for 2FA codes (last ${maxAge}s)...`);
		freshScan(maxAge).then(codes => {
			if (!codes.length) {
				console.log('No codes found.');
			} else {
				for (const c of codes) {
					console.log(`  [${c.code}] from ${c.source} (${c.sender}) — ${(c.text || '').slice(0, 80)}`);
				}
			}
		}).catch(e => console.error('Error:', e.message));
	} else {
		// Continuous mode: node src/main/two-fa/index.js
		console.log('2FA module starting (Ctrl+C to stop)...');

		const mockEventBus = {
			emitEvent: (type, payload) => console.log(`[${type}]`, JSON.stringify(payload).slice(0, 120)),
		};

		const engine = init({
			eventBus: mockEventBus,
			settings: {
				pollIntervalMs: parseInt(args[0]) || 5000,
				confidenceThreshold: 0.5,
				enabled: true,
			},
		});

		process.on('SIGINT', () => {
			console.log('\nStopping...');
			shutdown();
			process.exit(0);
		});
	}
}
