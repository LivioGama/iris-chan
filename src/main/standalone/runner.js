// StandaloneRunner — spawn and manage standalone Node scripts from within Iris
//
// Usage from bootstrap:
//   const runner = new StandaloneRunner({ eventBus });
//   runner.launch('chess', 'src/main/chess/index.js');
//   runner.stop('chess');
//   runner.stopAll();
//
// Each module runs as a detached child process — no extra Electron instance.

const { spawn } = require('child_process');
const path = require('path');
const log = require('../logger');

const TAG = 'Standalone';

class StandaloneRunner {
	constructor({ eventBus } = {}) {
		this.eventBus = eventBus;
		/** @type {Map<string, { proc: ChildProcess, scriptPath: string, args: string[], startedAt: number }>} */
		this.running = new Map();
	}

	/**
	 * Launch a standalone script by name.
	 * @param {string} name — unique identifier (e.g. 'chess')
	 * @param {string} scriptPath — path relative to project root
	 * @param {string[]} [args] — CLI arguments
	 * @param {object} [opts] — { restart: true } to kill existing first
	 * @returns {{ ok: boolean, pid?: number, error?: string }}
	 */
	launch(name, scriptPath, args = [], opts = {}) {
		if (this.running.has(name) && !opts.restart) {
			return { ok: false, error: `"${name}" is already running (pid ${this.running.get(name).proc.pid})` };
		}
		if (this.running.has(name)) {
			this.stop(name);
		}

		const resolved = path.isAbsolute(scriptPath)
			? scriptPath
			: path.resolve(process.cwd(), scriptPath);

		const proc = spawn(process.execPath, [resolved, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, IRIS_STANDALONE: '1', IRIS_MODULE: name },
		});

		const entry = { proc, scriptPath: resolved, args, startedAt: Date.now() };
		this.running.set(name, entry);

		proc.stdout.on('data', (chunk) => {
			const line = chunk.toString().trimEnd();
			log.info(`${TAG}:${name}`, line);
		});

		proc.stderr.on('data', (chunk) => {
			const line = chunk.toString().trimEnd();
			log.warn(`${TAG}:${name}`, line);
		});

		proc.on('close', (code) => {
			log.info(TAG, `"${name}" exited (code ${code})`);
			this.running.delete(name);
			if (this.eventBus) {
				this.eventBus.emitEvent('STANDALONE_EXIT', { name, code }, 'standalone');
			}
		});

		proc.on('error', (err) => {
			log.error(TAG, `"${name}" spawn error: ${err.message}`);
			this.running.delete(name);
		});

		log.info(TAG, `Launched "${name}" (pid ${proc.pid}) → ${resolved}`);
		if (this.eventBus) {
			this.eventBus.emitEvent('STANDALONE_LAUNCH', { name, pid: proc.pid, scriptPath: resolved }, 'standalone');
		}

		return { ok: true, pid: proc.pid };
	}

	/**
	 * Stop a running standalone module.
	 */
	stop(name) {
		const entry = this.running.get(name);
		if (!entry) return { ok: false, error: `"${name}" is not running` };

		entry.proc.kill('SIGTERM');
		this.running.delete(name);
		log.info(TAG, `Stopped "${name}"`);
		return { ok: true };
	}

	/**
	 * Stop all running standalone modules.
	 */
	stopAll() {
		for (const name of [...this.running.keys()]) {
			this.stop(name);
		}
	}

	/**
	 * List all running modules.
	 */
	list() {
		return [...this.running.entries()].map(([name, entry]) => ({
			name,
			pid: entry.proc.pid,
			scriptPath: entry.scriptPath,
			uptimeMs: Date.now() - entry.startedAt,
		}));
	}

	/**
	 * Check if a module is running.
	 */
	isRunning(name) {
		return this.running.has(name);
	}
}

module.exports = { StandaloneRunner };
