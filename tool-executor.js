// Tool executor: dispatches Gemini tool calls to native helper or Node APIs
const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const HELPER_SRC = path.join(__dirname, 'helpers', 'iris-helper.swift');
const HELPER_BIN = path.join(__dirname, 'helpers', 'iris-helper');

let compiled = false;

function ensureCompiled() {
	return new Promise((resolve, reject) => {
		if (compiled || fs.existsSync(HELPER_BIN)) {
			compiled = true;
			return resolve();
		}
		console.log('[ToolExecutor] Compiling Swift helper...');
		exec(`swiftc -O -o "${HELPER_BIN}" "${HELPER_SRC}"`, (err, stdout, stderr) => {
			if (err) {
				console.error('[ToolExecutor] Compile error:', stderr);
				return reject(new Error('Swift compile failed: ' + stderr));
			}
			console.log('[ToolExecutor] Helper compiled successfully');
			compiled = true;
			resolve();
		});
	});
}

async function runHelper(actionObj) {
	try {
		await ensureCompiled();
	} catch (e) {
		return { ok: false, result: e.message };
	}

	const arg = JSON.stringify(actionObj);
	return new Promise((resolve) => {
		execFile(HELPER_BIN, [arg], { timeout: 10000 }, (err, stdout, stderr) => {
			if (err) return resolve({ ok: false, result: stderr || err.message });
			try {
				resolve(JSON.parse(stdout.trim()));
			} catch {
				resolve({ ok: true, result: stdout.trim() });
			}
		});
	});
}

async function execute(name, args) {
	switch (name) {
		case 'type_text':
			return runHelper({ action: 'type_text', text: args.text || '' });

		case 'press_key':
			return runHelper({ action: 'press_key', key: args.key || '' });

		case 'scroll':
			return runHelper({
				action: 'scroll',
				direction: args.direction || 'down',
				amount: args.amount != null ? parseInt(args.amount) : 3,
			});

		case 'click_at':
			return runHelper({
				action: 'click_at',
				x: parseFloat(args.x || 0),
				y: parseFloat(args.y || 0),
			});

		case 'open_app':
			return runHelper({ action: 'open_app', name: args.name || '' });

		case 'run_terminal_command': {
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

		case 'propose_reply':
			return runHelper({ action: 'type_text', text: args.reply || '' });

		default:
			return { ok: false, result: `Unknown tool: ${name}` };
	}
}

module.exports = { execute };
