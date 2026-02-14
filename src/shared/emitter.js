// Reusable EventEmitter mixin — replaces copy-paste pattern across renderer classes

export class Emitter {
	constructor() {
		this._listeners = {};
	}

	on(event, fn) {
		(this._listeners[event] ||= []).push(fn);
	}

	emit(event, ...args) {
		(this._listeners[event] || []).forEach(fn => fn(...args));
	}
}
