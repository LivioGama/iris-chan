// Long-lived notification observer via iris-helper --monitor-notifications
const { spawn } = require('child_process');
const config = require('../../shared/config').default;
const { ensureCompiled } = require('../native-helper');
const log = require('../logger');

class NotificationMonitor {
	constructor({ onNotification } = {}) {
		this.onNotification = typeof onNotification === 'function' ? onNotification : () => {};
		this.child = null;
	}

	async start() {
		if (this.child) return;
		await ensureCompiled();
		this.child = spawn(config.paths.helperBin, ['--monitor-notifications'], {
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
						const evt = JSON.parse(line);
						if (evt.type === 'notification') {
							this.onNotification(evt);
						} else if (evt.type === 'ready') {
							log.info('NotifMonitor', `Watching NotificationCenter (pid: ${evt.pid})`);
						} else if (evt.type === 'error') {
							log.warn('NotifMonitor', `Helper error: ${evt.message}`);
						}
					} catch (err) {
						log.warn('NotifMonitor', `Ignored invalid event: ${err.message}`);
					}
				}
				newline = buffer.indexOf('\n');
			}
		});

		this.child.stderr.setEncoding('utf-8');
		this.child.stderr.on('data', (chunk) => {
			const text = String(chunk || '').trim();
			if (text) log.warn('NotifMonitor', text);
		});

		this.child.once('exit', (code) => {
			this.child = null;
			if (code && code !== 0) {
				log.warn('NotifMonitor', `Helper exited with code ${code}`);
			}
		});

		log.info('NotifMonitor', 'Started notification observer');
	}

	stop() {
		if (!this.child) return;
		this.child.kill('SIGTERM');
		this.child = null;
		log.info('NotifMonitor', 'Stopped notification observer');
	}
}

module.exports = { NotificationMonitor };
