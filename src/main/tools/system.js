const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runHelper } = require('../native-helper');
const { getCaptureHealth, getScreenPermissionStatus } = require('../screen-capture');
const workspace = require('../workspace');
const log = require('../logger');
const settings = require('../settings');
const { createCommandEnv } = require('../path-env');

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

function parsePatchInput(value) {
	if (!value) return null;
	if (typeof value === 'object' && !Array.isArray(value)) return value;
	if (typeof value !== 'string') return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function parsePrimitive(rawValue) {
	if (typeof rawValue !== 'string') return rawValue;
	const trimmed = rawValue.trim();
	if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
	const numeric = Number(trimmed);
	if (Number.isFinite(numeric) && trimmed !== '') return numeric;
	return trimmed;
}

function setPath(target, keyPath, rawValue) {
	const segments = String(keyPath || '').split('.').filter(Boolean);
	if (!segments.length) return false;
	let cursor = target;
	for (let index = 0; index < segments.length - 1; index += 1) {
		const segment = segments[index];
		if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
			cursor[segment] = {};
		}
		cursor = cursor[segment];
	}
	cursor[segments[segments.length - 1]] = parsePrimitive(rawValue);
	return true;
}

function derivePatchFromRequest(request = '') {
	const text = String(request || '').trim();
	if (!text) return null;
	const patch = {};
	const voiceMatch = text.match(/\bvoice(?: name)?\s+(?:to|is)\s+["']?([a-z0-9 _-]+)["']?/i);
	if (voiceMatch) {
		setPath(patch, 'voice.modelVoiceName', voiceMatch[1].trim());
	}
	const avatarMatch = text.match(/\bavatar\s+(?:to|is)\s+(original|tripo3d)\b/i);
	if (avatarMatch) {
		setPath(patch, 'avatar.current', avatarMatch[1].toLowerCase());
	}
	const modeMatch = text.match(/\bmode\s+(?:to|is)\s+(silent|attentive|autonomous)\b/i);
	if (modeMatch) {
		setPath(patch, 'behavior.mode', modeMatch[1].toLowerCase());
	}
	if (/\bdirect mode\b.*\bon\b/i.test(text)) setPath(patch, 'behavior.directMode', true);
	if (/\bdirect mode\b.*\boff\b/i.test(text)) setPath(patch, 'behavior.directMode', false);
	const keyValueMatch = text.match(/\b([a-z]+(?:\.[a-zA-Z0-9_]+)+)\s*=\s*([^\n]+)$/);
	if (keyValueMatch) {
		setPath(patch, keyValueMatch[1], keyValueMatch[2].trim());
	}
	return Object.keys(patch).length ? patch : null;
}

async function groqPatchFromRequest(request = '') {
	if (!process.env.GROQ_API_KEY || !String(request || '').trim() || typeof fetch !== 'function') return null;
	const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${process.env.GROQ_API_KEY}`,
		},
		body: JSON.stringify({
			model: 'llama-3.3-70b-versatile',
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: 'Translate the user request into a JSON patch for ~/.iris/settings.json. Return only JSON with a top-level "patch" object. Allowed namespaces: voice, avatar, behavior, logging. Never include any keys outside those namespaces.',
				},
				{ role: 'user', content: String(request || '') },
			],
		}),
	});
	if (!response.ok) {
		throw new Error(`Groq patch translation failed (${response.status})`);
	}
	const data = await response.json();
	const content = data?.choices?.[0]?.message?.content;
	const parsed = parsePatchInput(content);
	if (parsed?.patch && typeof parsed.patch === 'object') return parsed.patch;
	return null;
}

async function update_settings(args = {}) {
	const explicitPatch = parsePatchInput(args.patch);
	let patch = explicitPatch;
	let translator = 'none';
	if (!patch && args.key && Object.prototype.hasOwnProperty.call(args, 'value')) {
		patch = {};
		setPath(patch, args.key, args.value);
		translator = 'kv';
	}
	if (!patch && args.request) {
		try {
			patch = await groqPatchFromRequest(args.request);
			if (patch) translator = 'groq';
		} catch (err) {
			log.warn('Settings', `Groq settings translation failed: ${err.message}`);
		}
	}
	if (!patch && args.request) {
		patch = derivePatchFromRequest(args.request);
		if (patch) translator = 'deterministic';
	}
	if (!patch) {
		return { ok: false, result: 'No valid settings patch provided. Pass patch JSON, key/value, or a supported request string.' };
	}
	const result = settings.updateSettings(patch, { source: 'tool:update_settings', translator });
	return {
		ok: true,
		applied: result.applied,
		restartRequired: result.restartRequired,
		changedKeys: result.changedKeys,
		result: JSON.stringify({
			path: settings.SETTINGS_PATH,
			applied: result.applied,
			restartRequired: result.restartRequired,
			changedKeys: result.changedKeys,
			namespaceStatuses: result.namespaceStatuses,
		}),
	};
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
			cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: createCommandEnv(),
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
		exec(wrapped, { timeout: 60000, maxBuffer: 1024 * 512, cwd, env: createCommandEnv() }, (err, stdout, stderr) => {
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

module.exports = { set_volume, notify, run_terminal_command, check_permissions, update_settings };
