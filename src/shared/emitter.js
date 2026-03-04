export class Emitter {
	constructor() {
		this._listeners = {};
	}

	on(event, fn) {
		(this._listeners[event] ||= []).push(fn);
		return this; // chainable
	}

	once(event, fn) {
		const wrapped = (...args) => {
			this.off(event, wrapped);
			fn(...args);
		};
		wrapped._original = fn;
		return this.on(event, wrapped);
	}

	off(event, fn) {
		const list = this._listeners[event];
		if (!list) return this;
		if (!fn) {
			delete this._listeners[event];
		} else {
			this._listeners[event] = list.filter(f => f !== fn && f._original !== fn);
		}
		return this;
	}

	emit(event, ...args) {
		const list = this._listeners[event];
		if (!list) return;
		for (const fn of list) {
			try {
				fn(...args);
			} catch (err) {
				console.error(`[Emitter] Error in "${event}" listener:`, err);
			}
		}
	}

	removeAllListeners() {
		this._listeners = {};
		return this;
	}
}
