"use strict";
class BehaviorModeState {
    constructor() {
        this.state = {
            mode: 'silent',
            directMode: false,
            feedbackEnabled: false,
            introversionEnabled: false,
        };
    }
    getMode() {
        return this.state.mode;
    }
    setMode(mode) {
        if (!['silent', 'passive', 'proactive'].includes(mode)) {
            return { ok: false, error: 'Invalid mode' };
        }
        this.state.mode = mode;
        return { ok: true, mode };
    }
    getDirectMode() {
        return this.state.directMode;
    }
    setDirectMode(enabled) {
        this.state.directMode = !!enabled;
        return { ok: true, directMode: this.state.directMode };
    }
    getState() {
        return { ...this.state };
    }
    setState(nextState = {}) {
        if (!nextState || typeof nextState !== 'object') {
            return { ok: false, error: 'Invalid state' };
        }
        if (!['silent', 'passive', 'proactive'].includes(nextState.mode)) {
            return { ok: false, error: 'Invalid mode' };
        }
        this.state = {
            mode: nextState.mode,
            directMode: !!nextState.directMode,
            feedbackEnabled: !!nextState.feedbackEnabled,
            introversionEnabled: !!nextState.introversionEnabled,
        };
        return { ok: true, state: this.getState() };
    }
}
module.exports = { BehaviorModeState };
