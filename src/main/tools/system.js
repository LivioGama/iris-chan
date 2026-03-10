const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runHelper } = require('../native-helper');
const { getCaptureHealth, getScreenPermissionStatus } = require('../screen-capture');
const workspace = require('../workspace');
const log = require('../logger');

const SKILL_LOG = path.join(os.homedir(), '.iris', 'skill_log.txt');

function logSkillOutput(label, command, stdout, stderr, err) {
	const ts = new Date().toISOString();
	const lines = [
		`\n=== [${ts}] ${label} ===`,
		`CMD: ${command}`,
		stdout ? `STDOUT:\n${stdout}` : 'STDOUT: (empty)',
		stderr ? `STDERR:\n${stderr}` : 'STDERR: (empty)',
		err ? `ERROR: ${err.message}` : 'EXIT: ok',
		'---',
	];
	try { fs.appendFileSync(SKILL_LOG, lines.join('\n') + '\n'); } catch {}
}

async function set_volume(args) {
	return runHelper({ action: 'set_volume', level: parseFloat(args.level || 0.5) });
}

async function notify(args) {
	return runHelper({ action: 'notify', text: args.text || 'Notification from Iris' });
}

async function check_permissions() {
	const accessibility = await runHelper({ action: 'check_accessibility' });
	const captureHealth = getCaptureHealth();
	const payload = {
		screenRecording: {
			status: getScreenPermissionStatus(),
			lastCaptureAt: captureHealth.lastCaptureAt || null,
			lastError: captureHealth.lastError || null,
		},
		accessibility: accessibility.ok ? accessibility.result : (accessibility.result || 'unknown'),
	};
	return { ok: true, result: JSON.stringify(payload) };
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff']);

function autoOpenGeneratedImage(stdout) {
	const match = (stdout || '').match(/(?:saved to|wrote|output)[:\s]+([^\n]+)/i);
	if (!match) return;
	const filePath = match[1].trim().replace(/['"]/g, '');
	if (IMAGE_EXTS.has(path.extname(filePath).toLowerCase()) && fs.existsSync(filePath)) {
		exec(`open "${filePath}"`);
	}
}

// Detect commands that start long-running servers/processes
const LONG_RUNNING = /\b(serve|server|dashboard|watch|dev|start|listen|uvicorn|gunicorn|flask run|http\.server)\b/i;

async function run_terminal_command(args) {
	const command = args.command || '';
	if (!command) return { ok: false, result: 'No command provided' };
	const cwd = workspace.get();

	// Long-running commands: spawn detached and return immediately
	if (LONG_RUNNING.test(command)) {
		log.info('Tools', `Detaching long-running command: ${command.slice(0, 100)}`);
		const child = spawn('/bin/zsh', ['-l', '-c', `unset CLAUDECODE; cd "${cwd.replace(/"/g, '\\"')}" && ${command}`], {
			cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		child.stdout.on('data', (d) => { stdout += d; });
		child.stderr.on('data', (d) => { stdout += d; });
		child.unref();
		// Wait up to 3s for initial output
		return new Promise((resolve) => {
			const done = () => resolve({ ok: true, result: stdout.trim().slice(0, 500) || `Launched in background (pid ${child.pid})` });
			const timer = setTimeout(done, 3000);
			child.stdout.once('data', () => { clearTimeout(timer); setTimeout(done, 500); });
			child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, result: err.message }); });
		});
	}

	const wrapped = `/bin/zsh -l -c 'unset CLAUDECODE; cd "${cwd.replace(/"/g, '\\"')}" && ${command.replace(/'/g, "'\\''")}'`;
	return new Promise((resolve) => {
		exec(wrapped, { timeout: 60000, maxBuffer: 1024 * 512, cwd }, (err, stdout, stderr) => {
			logSkillOutput('run_terminal_command', command, stdout, stderr, err);
			if (!err) autoOpenGeneratedImage(stdout);
			if (err && !stdout && !stderr) {
				return resolve({ ok: false, result: err.message });
			}
			const output = (stdout || '') + (stderr ? '\n' + stderr : '');
			resolve({ ok: !err, result: output.trim().slice(0, 2000) || '(no output)' });
		});
	});
}

module.exports = { set_volume, notify, run_terminal_command, check_permissions };
