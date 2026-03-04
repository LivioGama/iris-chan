'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_ENV = path.resolve(__dirname, '..', '..', '.env');

function loadEnv(filePath = ROOT_ENV) {
	let content;
	try {
		content = fs.readFileSync(filePath, 'utf-8');
	} catch {
		return;
	}

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eqIdx = trimmed.indexOf('=');
		if (eqIdx < 0) continue;

		const key = trimmed.slice(0, eqIdx).trim();
		if (!key) continue;

		let val = trimmed.slice(eqIdx + 1);

		// Strip inline comment (only outside quoted value)
		const firstChar = val.trim()[0];
		if (firstChar !== '"' && firstChar !== "'") {
			const commentIdx = val.indexOf(' #');
			if (commentIdx >= 0) val = val.slice(0, commentIdx);
		}

		val = val.trim();

		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}

		process.env[key] = val;
	}
}

function getEnvVar(key, fallback) {
	const val = process.env[key];
	return val !== undefined ? val : fallback;
}

module.exports = { loadEnv, getEnvVar };
