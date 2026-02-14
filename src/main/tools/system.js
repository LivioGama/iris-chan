// Tool handlers: set_volume, notify, run_terminal_command
const { exec } = require('child_process');
const { runHelper } = require('../native-helper');

async function set_volume(args) {
	return runHelper({ action: 'set_volume', level: parseFloat(args.level || 0.5) });
}

async function notify(args) {
	return runHelper({ action: 'notify', text: args.text || 'Notification from Iris' });
}

async function run_terminal_command(args) {
	const command = args.command || '';
	if (!command) return { ok: false, result: 'No command provided' };
	return new Promise((resolve) => {
		exec(command, { timeout: 10000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
			if (err && !stdout && !stderr) {
				return resolve({ ok: false, result: err.message });
			}
			const output = (stdout || '') + (stderr ? '\n' + stderr : '');
			resolve({ ok: !err, result: output.trim().slice(0, 2000) || '(no output)' });
		});
	});
}

module.exports = { set_volume, notify, run_terminal_command };
