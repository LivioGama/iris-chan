import { Emitter } from './emitter.js';

const bus = new Emitter();

export const eventBusWeb = {
	emit(type, payload) {
		bus.emit('event', { type, timestamp: Date.now(), payload });
	},
	on(type, handler) {
		const wrapper = (evt) => { if (evt.type === type) handler(evt); };
		wrapper._type = type;
		wrapper._handler = handler;
		bus.on('event', wrapper);
	},
	onAny(handler) {
		bus.on('event', handler);
	},
	off(type, handler) {
		const listeners = bus._listeners['event'] || [];
		const match = listeners.find((fn) => fn._type === type && fn._handler === handler);
		if (match) bus.off('event', match);
	},
};
