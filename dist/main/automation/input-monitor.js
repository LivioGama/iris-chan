"use strict";
const { spawn } = require('child_process');
const config = require('../../shared/config').default;
const { ensureCompiled } = require('../native-helper');
const log = require('../logger');
class InputMonitor {
    constructor({ onInput } = {}) {
        this.onInput = typeof onInput === 'function' ? onInput : () => { };
        this.child = null;
    }
    async start() {
        if (this.child)
            return;
        await ensureCompiled();
        this.child = spawn(config.paths.helperBin, ['--monitor-input'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let buffer = '';
        this.child.stdout.setEncoding('utf-8');
        this.child.stdout.on('data', (chunk) => {
            buffer += chunk;
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line) {
                    try {
                        this.onInput(JSON.parse(line));
                    }
                    catch (err) {
                        log.warn('InputMonitor', `Ignored invalid input event: ${err.message}`);
                    }
                }
                newline = buffer.indexOf('\n');
            }
        });
        this.child.stderr.setEncoding('utf-8');
        this.child.stderr.on('data', (chunk) => {
            const text = String(chunk || '').trim();
            if (text)
                log.warn('InputMonitor', text);
        });
        this.child.once('exit', () => {
            this.child = null;
        });
    }
    stop() {
        if (!this.child)
            return;
        this.child.kill('SIGTERM');
        this.child = null;
    }
}
module.exports = {
    InputMonitor,
};
