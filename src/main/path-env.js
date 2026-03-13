const fs = require('fs');
const os = require('os');
const path = require('path');

const PATH_SEPARATOR = path.delimiter;

function expandHome(value, homeDir = os.homedir()) {
	if (!value) return '';
	if (value === '~') return homeDir;
	if (value.startsWith('~/')) return path.join(homeDir, value.slice(2));
	if (value.startsWith('$HOME/')) return path.join(homeDir, value.slice('$HOME/'.length));
	return value;
}

function normalizePathEntry(value, homeDir = os.homedir()) {
	const trimmed = String(value || '').trim().replace(/^['"]|['"]$/g, '');
	if (!trimmed || trimmed.startsWith('$')) return '';
	return expandHome(trimmed, homeDir);
}

function parseFishConfig(content, homeDir = os.homedir()) {
	const entries = [];
	for (const rawLine of String(content || '').split(/\r?\n/)) {
		const line = rawLine.replace(/#.*/, '').trim();
		if (!line) continue;

		const fishAddPath = line.match(/^fish_add_path(?:\s+-[A-Za-z]+\s+|\s+)(.+)$/);
		if (fishAddPath) {
			const values = fishAddPath[1].split(/\s+/).map((part) => normalizePathEntry(part, homeDir)).filter(Boolean);
			entries.push(...values);
			continue;
		}

		const fishUserPaths = line.match(/^set\s+-U[a-zA-Z\s]*\s+fish_user_paths\s+(.+)$/);
		if (fishUserPaths) {
			const values = fishUserPaths[1]
				.split(/\s+/)
				.map((part) => normalizePathEntry(part, homeDir))
				.filter(Boolean);
			entries.push(...values);
		}
	}
	return entries;
}

function decodeFishVariableSegment(segment) {
	return segment.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseFishVariables(content, homeDir = os.homedir()) {
	const line = String(content || '')
		.split(/\r?\n/)
		.find((entry) => entry.startsWith('SETUVAR fish_user_paths:'));
	if (!line) return [];
	const raw = line.slice('SETUVAR fish_user_paths:'.length);
	return decodeFishVariableSegment(raw)
		.split('\x1e')
		.map((part) => normalizePathEntry(part, homeDir))
		.filter(Boolean);
}

function getFishUserPaths(homeDir = os.homedir()) {
	const fishDir = path.join(homeDir, '.config', 'fish');
	const entries = [];

	const configPath = path.join(fishDir, 'config.fish');
	if (fs.existsSync(configPath)) {
		try {
			entries.push(...parseFishConfig(fs.readFileSync(configPath, 'utf8'), homeDir));
		} catch {}
	}

	const variablesPath = path.join(fishDir, 'fish_variables');
	if (fs.existsSync(variablesPath)) {
		try {
			entries.push(...parseFishVariables(fs.readFileSync(variablesPath, 'utf8'), homeDir));
		} catch {}
	}

	return entries;
}

function dedupePaths(entries) {
	const seen = new Set();
	const result = [];
	for (const entry of entries) {
		const normalized = String(entry || '').trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function buildAugmentedPath(basePath = process.env.PATH || '', options = {}) {
	const homeDir = options.homeDir || os.homedir();
	const extraEntries = [
		path.join(homeDir, 'local', 'bin'),
		path.join(homeDir, '.local', 'bin'),
		...getFishUserPaths(homeDir),
	];
	const combined = dedupePaths([
		...extraEntries,
		...String(basePath || '').split(PATH_SEPARATOR),
		'/opt/homebrew/bin',
		'/usr/local/bin',
	]);
	return combined.join(PATH_SEPARATOR);
}

function createCommandEnv(overrides = {}, options = {}) {
	return {
		...process.env,
		...overrides,
		PATH: buildAugmentedPath(overrides.PATH ?? process.env.PATH ?? '', options),
	};
}

module.exports = {
	buildAugmentedPath,
	createCommandEnv,
	getFishUserPaths,
	parseFishConfig,
	parseFishVariables,
};
