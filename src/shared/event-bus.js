const { EventEmitter } = require('node:events');

class RuntimeEventBus extends EventEmitter {
	emitEvent(type, payload, source = 'runtime') {
		this.emit('event', {
			type,
			timestamp: Date.now(),
			payload,
			source,
		});
	}
}

module.exports = { RuntimeEventBus };
