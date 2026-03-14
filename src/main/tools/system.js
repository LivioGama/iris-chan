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

function hasVoiceKeyword(text = '') {
	return /\bvoice\b|\bpreset\b|\bpitch\b|\bplayback(?: rate)?\b|\bwarm(?:er|th)?\b|\bbrighter\b|\bdarker\b|\beq\b|\bcompress(?:ed|ion)?\b/i.test(text)
		|| /(वॉइस|भोइस|आवाज|भ्वाइस|ভয়েস|ভয়েস|আওয়াজ)/i.test(text);
}

function chooseVoicePresetByIntent({ text = '', lower = '', currentVoiceName = '' } = {}) {
	const presets = settings.getVoicePresets();
	if (!presets.length) return null;
	const currentPresetIndex = presets.findIndex((preset) => String(preset.modelVoiceName || '').toLowerCase() === currentVoiceName);
	const currentPreset = currentPresetIndex >= 0 ? presets[currentPresetIndex] : null;
	const intentMatchers = [
		{
			pattern: /\b(deeper|deep|lower|low(?:er)? pitch|dark(?:er)?|warm(?:er)?|intimate|husky)\b/i,
			nonAsciiPattern: /(डीप|डिप|लोअर|लो\s*पिच|डार्क|वार्म|गहिरो|गहिरो\s*आवाज|भारी)/i,
			presetName: 'velvet dusk',
		},
		{
			pattern: /\b(soft(?:er)?|gentle|bloom|airy|feminine|lighter)\b/i,
			nonAsciiPattern: /(सफ्ट|सफ्टर|जेन्टल|ब्लुम|एयरी|फेमिनिन|हल्का)/i,
			presetName: 'soft bloom',
		},
		{
			pattern: /\b(clear(?:er)?|neutral|guide|balanced)\b/i,
			nonAsciiPattern: /(क्लियर|न्यूट्रल|गाइड|ब्यालेन्स्ड)/i,
			presetName: 'clear guide',
		},
		{
			pattern: /\b(bright(?:er)?|spark|energetic|faster)\b/i,
			nonAsciiPattern: /(ब्राइट|स्पार्क|एनर्जेटिक|फास्टर|छिटो)/i,
			presetName: 'bright spark',
		},
	];
	for (const matcher of intentMatchers) {
		if (matcher.pattern.test(text) || matcher.nonAsciiPattern.test(text)) {
			const matched = presets.find((preset) => String(preset.name || '').trim().toLowerCase() === matcher.presetName);
			if (matched) return matched;
		}
	}

	const asksForAlternate = /\b(different|another|new|else|change)\b/i.test(text)
		|| /(डिफरेंट|डिफ्रेण्ट|अर्को|फरक|नयाँ|चेंज|चेन्ज)/i.test(text);
	if (!asksForAlternate) return null;
	if (!currentPreset) return presets[0];
	return presets[(currentPresetIndex + 1) % presets.length];
}

function derivePatchFromRequest(request = '') {
	const text = String(request || '').trim();
	if (!text) return null;
	const lower = text.toLowerCase();
	const patch = {};
	const currentVoice = settings.getSettings()?.voice || settings.DEFAULT_SETTINGS.voice;

	const tweakPatch = { voice: { speechProfile: {} } };
	let hasTweak = false;
	const applyTweak = (key, value) => {
		tweakPatch.voice.speechProfile[key] = value;
		hasTweak = true;
	};

	if (/\bwarmer\b/i.test(text)) {
		applyTweak('warmthGainDb', Number(currentVoice.speechProfile.warmthGainDb || 0) + 0.8);
		applyTweak('lowShelfGainDb', Number(currentVoice.speechProfile.lowShelfGainDb || 0) + 0.4);
	}
	if (/\bbrighter\b/i.test(text)) {
		applyTweak('presenceGainDb', Number(currentVoice.speechProfile.presenceGainDb || 0) + 0.7);
		applyTweak('highShelfGainDb', Number(currentVoice.speechProfile.highShelfGainDb || 0) + 0.6);
	}
	if (/\bdarker\b/i.test(text)) {
		applyTweak('presenceGainDb', Number(currentVoice.speechProfile.presenceGainDb || 0) - 0.7);
		applyTweak('highShelfGainDb', Number(currentVoice.speechProfile.highShelfGainDb || 0) - 0.6);
	}
	if (/\bslower\b/i.test(text)) {
		applyTweak('playbackRate', Number(currentVoice.speechProfile.playbackRate || 1) - 0.03);
	}
	if (/\bfaster\b/i.test(text)) {
		applyTweak('playbackRate', Number(currentVoice.speechProfile.playbackRate || 1) + 0.03);
	}
	if (/\bhigher pitch\b|\braise(?: the)? pitch\b|\bmore feminine\b/i.test(text)) {
		applyTweak('pitchSemitones', Number(currentVoice.speechProfile.pitchSemitones || 0) + 1);
	}
	if (/\blower pitch\b|\bdeeper\b/i.test(text)) {
		applyTweak('pitchSemitones', Number(currentVoice.speechProfile.pitchSemitones || 0) - 1);
	}
	if (/\bless compressed\b|\bless compression\b/i.test(text)) {
		applyTweak('compressorRatio', Number(currentVoice.speechProfile.compressorRatio || 2.2) - 0.3);
		applyTweak('compressorThresholdDb', Number(currentVoice.speechProfile.compressorThresholdDb || -24) + 1);
	}
	if (/\bmore compressed\b|\bmore compression\b/i.test(text)) {
		applyTweak('compressorRatio', Number(currentVoice.speechProfile.compressorRatio || 2.2) + 0.3);
		applyTweak('compressorThresholdDb', Number(currentVoice.speechProfile.compressorThresholdDb || -24) - 1);
	}

	const presetCandidates = settings.getVoicePresets();
	const matchedPreset = presetCandidates.find((preset) => {
		const names = [preset.name].concat(Array.isArray(preset.aliases) ? preset.aliases : []);
		return names.some((name) => lower.includes(String(name).toLowerCase()));
	});
	if (matchedPreset && /\b(?:preset|switch to|use|try)\b/i.test(text)) {
		const presetPatch = settings.buildVoicePresetPatch(matchedPreset.name);
		if (presetPatch) {
			Object.assign(patch, presetPatch);
		}
	}
	if (!matchedPreset && hasVoiceKeyword(text)) {
		const inferredPreset = chooseVoicePresetByIntent({
			text,
			lower,
			currentVoiceName: String(currentVoice.modelVoiceName || '').toLowerCase(),
		});
		if (inferredPreset) {
			const presetPatch = settings.buildVoicePresetPatch(inferredPreset.name);
			if (presetPatch) {
				Object.assign(patch, presetPatch);
			}
		}
	}

	const voiceMatch = text.match(/\bvoice(?: name)?\s+(?:to|is)\s+["']?([a-z0-9 _-]+)["']?/i);
	if (voiceMatch && !matchedPreset && !patch.voice?.modelVoiceName) {
		setPath(patch, 'voice.modelVoiceName', voiceMatch[1].trim());
	}
	const avatarMatch = text.match(/\bavatar\s+(?:to|is)\s+(original|tripo3d)\b/i);
	if (avatarMatch) {
		setPath(patch, 'avatar.current', avatarMatch[1].toLowerCase());
	}
	const modeMatch = text.match(/\bmode\s+(?:to|is)\s+(silent|attentive|passive|autonomous|proactive)\b/i);
	if (modeMatch) {
		setPath(patch, 'behavior.mode', modeMatch[1].toLowerCase());
	}
	if (/\bdirect mode\b.*\bon\b/i.test(text)) setPath(patch, 'behavior.directMode', true);
	if (/\bdirect mode\b.*\boff\b/i.test(text)) setPath(patch, 'behavior.directMode', false);
	if (/\bfeedback mode\b.*\bon\b/i.test(text)) setPath(patch, 'behavior.feedbackEnabled', true);
	if (/\bfeedback mode\b.*\boff\b/i.test(text)) setPath(patch, 'behavior.feedbackEnabled', false);
	if (/\bintroversion mode\b.*\bon\b/i.test(text)) setPath(patch, 'behavior.introversionEnabled', true);
	if (/\bintroversion mode\b.*\boff\b/i.test(text)) setPath(patch, 'behavior.introversionEnabled', false);
	const keyValueMatch = text.match(/\b([a-z]+(?:\.[a-zA-Z0-9_]+)+)\s*=\s*([^\n]+)$/);
	if (keyValueMatch) {
		setPath(patch, keyValueMatch[1], keyValueMatch[2].trim());
	}
	if (hasTweak) {
		patch.voice = patch.voice || {};
		patch.voice.speechProfile = {
			...(patch.voice.speechProfile || {}),
			...tweakPatch.voice.speechProfile,
		};
	}
	return Object.keys(patch).length ? patch : null;
}

function isVoiceRequest(request = '') {
	const text = String(request || '');
	if (hasVoiceKeyword(text)) {
		return true;
	}
	const lower = text.toLowerCase();
	return settings.getVoicePresets().some((preset) => {
		const names = [preset.name].concat(Array.isArray(preset.aliases) ? preset.aliases : []);
		return names.some((name) => lower.includes(String(name).toLowerCase()));
	});
}

function summarizePatch(patch = {}) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return [];
	const changed = [];
	const walk = (value, prefix = '') => {
		for (const [key, nested] of Object.entries(value || {})) {
			const fullKey = prefix ? `${prefix}.${key}` : key;
			if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
				walk(nested, fullKey);
				continue;
			}
			changed.push(fullKey);
		}
	};
	walk(patch);
	return changed;
}

function buildQueryResponse(queryKind, summary, data = {}) {
	return {
		ok: true,
		queryKind,
		summary,
		data,
		result: JSON.stringify({
			queryKind,
			summary,
			data,
		}),
	};
}

function listVoicePresets() {
	const presets = settings.getVoicePresets().map((preset) => ({
		name: preset.name,
		description: preset.description,
		modelVoiceName: preset.modelVoiceName,
	}));
	const summary = presets.length
		? `Available voice presets: ${presets.map((preset) => `${preset.name} — ${preset.description}`).join('; ')}.`
		: 'No voice presets are currently available.';
	return buildQueryResponse('voice_preset_list', summary, { presets });
}

function findCurrentVoicePreset(voiceSettings = {}) {
	const currentVoiceName = String(voiceSettings?.modelVoiceName || '').trim().toLowerCase();
	if (!currentVoiceName) return null;
	return settings.getVoicePresets().find((preset) => String(preset.modelVoiceName || '').trim().toLowerCase() === currentVoiceName) || null;
}

function isSettingsQueryRequest(request = '') {
	const text = String(request || '').trim();
	if (!text) return false;
	return [
		/\blist\b.*\bvoice preset(s)?\b/i,
		/\bwhat voice presets\b/i,
		/\bwhat voice options\b/i,
		/\bwhat voice are you using\b/i,
		/\bwhich voice\b/i,
		/\bwhat avatar is selected\b/i,
		/\bwhich avatar\b/i,
		/\bwhat mode are you in\b/i,
		/\bis direct mode on\b/i,
		/\bis feedback mode on\b/i,
		/\bis introversion mode on\b/i,
		/\bwhat logging level are you using\b/i,
	].some((pattern) => pattern.test(text));
}

async function query_settings(args = {}) {
	const requestText = String(args.request || '').trim();
	if (!requestText) {
		return { ok: false, result: 'No settings query provided.' };
	}
	if (/\blist\b.*\bvoice preset(s)?\b/i.test(requestText) || /\bwhat voice presets\b/i.test(requestText) || /\bwhat voice options\b/i.test(requestText)) {
		return listVoicePresets();
	}

	const currentSettings = settings.getSettings();
	if (/\bwhat voice are you using\b/i.test(requestText) || /\bwhich voice\b/i.test(requestText)) {
		const preset = findCurrentVoicePreset(currentSettings.voice);
		if (preset) {
			return buildQueryResponse(
				'voice_current',
				`Current voice preset: ${preset.name} (${preset.modelVoiceName}).`,
				{
					preset: {
						name: preset.name,
						description: preset.description,
						modelVoiceName: preset.modelVoiceName,
					},
				},
			);
		}
		const modelVoiceName = String(currentSettings?.voice?.modelVoiceName || '').trim() || 'unknown';
		return buildQueryResponse('voice_current', `Current voice model: ${modelVoiceName}.`, {
			modelVoiceName,
		});
	}
	if (/\bwhat avatar is selected\b/i.test(requestText) || /\bwhich avatar\b/i.test(requestText)) {
		const avatar = String(currentSettings?.avatar?.current || 'unknown');
		return buildQueryResponse('avatar_current', `Current avatar: ${avatar}.`, { avatar });
	}
	if (/\bwhat mode are you in\b/i.test(requestText)) {
		const mode = String(currentSettings?.behavior?.mode || 'unknown');
		return buildQueryResponse('behavior_mode', `Current behavior mode: ${mode}.`, { mode });
	}
	if (/\bis direct mode on\b/i.test(requestText)) {
		const enabled = !!currentSettings?.behavior?.directMode;
		return buildQueryResponse('behavior_direct_mode', `Direct mode is ${enabled ? 'on' : 'off'}.`, { enabled });
	}
	if (/\bis feedback mode on\b/i.test(requestText)) {
		const enabled = !!currentSettings?.behavior?.feedbackEnabled;
		return buildQueryResponse('behavior_feedback_mode', `Feedback mode is ${enabled ? 'on' : 'off'}.`, { enabled });
	}
	if (/\bis introversion mode on\b/i.test(requestText)) {
		const enabled = !!currentSettings?.behavior?.introversionEnabled;
		return buildQueryResponse('behavior_introversion_mode', `Introversion mode is ${enabled ? 'on' : 'off'}.`, { enabled });
	}
	if (/\bwhat logging level are you using\b/i.test(requestText)) {
		const consoleLevel = String(currentSettings?.logging?.console?.level || 'info');
		const persistLevel = String(currentSettings?.logging?.persist?.level || 'info');
		return buildQueryResponse(
			'logging_level',
			`Logging levels: console ${consoleLevel}, file ${persistLevel}.`,
			{ consoleLevel, persistLevel },
		);
	}

	return { ok: false, result: 'Unsupported settings query.' };
}

function buildRoutingRegistrySummary() {
	const metadata = settings.getMetadata();
	return Object.fromEntries(
		Object.entries(metadata.registry || {}).map(([namespace, value]) => [
			namespace,
			{
				liveApply: !!value.liveApply,
				restartRequired: !!value.restartRequired,
				queryIntents: value.capabilities?.queryIntents || [],
				mutationIntents: value.capabilities?.mutationIntents || [],
				examples: value.capabilities?.examples || [],
				keyPaths: value.capabilities?.keyPaths || [],
			},
		]),
	);
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

function validateRoutePayload(payload) {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
	const route = String(payload.route || '').trim();
	if (!['settings_query', 'settings_mutation', 'self_fix', 'ui_task', 'project_fix', 'answer_only'].includes(route)) {
		return null;
	}
	return {
		route,
		settingsNamespace: String(payload.settingsNamespace || '').trim(),
		settingsCapable: payload.settingsCapable === true,
	};
}

async function route_request(args = {}) {
	const request = String(args.request || '').trim();
	if (!request) return { ok: false, result: 'Routing unavailable right now: empty request.' };
	if (!process.env.GROQ_API_KEY || typeof fetch !== 'function') {
		return { ok: false, result: 'Routing unavailable right now.' };
	}
	const registrySummary = buildRoutingRegistrySummary();
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
					content: 'Route the user request into one of these routes only: settings_query, settings_mutation, self_fix, ui_task, project_fix, answer_only. Use the provided settings registry to decide whether the request is already satisfiable through settings. Return only JSON with keys: route, settingsNamespace, settingsCapable.',
				},
				{
					role: 'user',
					content: JSON.stringify({
						request,
						settingsRegistry: registrySummary,
					}),
				},
			],
		}),
	});
	if (!response.ok) {
		throw new Error(`Groq route translation failed (${response.status})`);
	}
	const data = await response.json();
	const content = data?.choices?.[0]?.message?.content;
	const parsed = parsePatchInput(content);
	const validated = validateRoutePayload(parsed);
	if (!validated) {
		return { ok: false, result: 'Routing unavailable right now: invalid Groq route output.' };
	}
	return {
		ok: true,
		result: JSON.stringify(validated),
		route: validated,
	};
}

async function update_settings(args = {}) {
	const requestText = String(args.request || '').trim();
	if (isSettingsQueryRequest(requestText)) {
		return { ok: false, result: 'This is a read-only settings query. Use query_settings instead.' };
	}
	const requestedPresetIntent = /\b(?:voice preset|preset)\b/i.test(requestText) || /\b(?:switch to|use|try)\b.+\b(?:voice|preset)\b/i.test(requestText);
	const explicitPatch = parsePatchInput(args.patch);
	let patch = explicitPatch;
	let translator = 'none';
	if (!patch && args.key && Object.prototype.hasOwnProperty.call(args, 'value')) {
		patch = {};
		setPath(patch, args.key, args.value);
		translator = 'kv';
	}
	if (!patch && args.request && isVoiceRequest(args.request)) {
		patch = derivePatchFromRequest(args.request);
		if (patch) translator = 'deterministic';
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
		if (requestedPresetIntent) {
			const available = settings.getVoicePresets().map((preset) => preset.name).join(', ');
			return { ok: false, result: `Unknown voice preset. Available presets: ${available}` };
		}
		return { ok: false, result: 'No valid settings patch provided. Pass patch JSON, key/value, or a supported request string.' };
	}
	const result = settings.updateSettings(patch, { source: 'tool:update_settings', translator });
	const patchSummary = summarizePatch(patch);
	const noChangeReason = result.changedKeys.length
		? null
		: (patchSummary.length ? 'requested_settings_already_match_current_state' : 'request_did_not_resolve_to_supported_setting_changes');
	return {
		ok: true,
		applied: result.applied,
		restartRequired: result.restartRequired,
		changedKeys: result.changedKeys,
		translator,
		patchSummary,
		noChangeReason,
		result: JSON.stringify({
			path: settings.SETTINGS_PATH,
			applied: result.applied,
			restartRequired: result.restartRequired,
			changedKeys: result.changedKeys,
			namespaceStatuses: result.namespaceStatuses,
			translator,
			patchSummary,
			noChangeReason,
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

module.exports = { set_volume, notify, run_terminal_command, check_permissions, query_settings, update_settings, route_request };
