const { EventEmitter } = require('node:events');

class RuntimeEventBus extends EventEmitter {
	emitEvent(type, payload, source = 'runtime') {
		const event = {
			type,
			timestamp: Date.now(),
			payload,
			source,
		};
		this.emit('event', event);
		return event;
	}
}

module.exports = { RuntimeEventBus };
