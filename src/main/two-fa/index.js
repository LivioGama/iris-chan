// Public API for the proactive 2FA detection and autofill system
const { TwoFAOrchestrator } = require('./orchestrator');
const log = require('../logger');

let instance = null;

function init({ eventBus, behaviorEngine, settings = {} }) {
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

module.exports = { init, shutdown, getStatus, updateSettings };
