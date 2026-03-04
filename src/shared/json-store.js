'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEBOUNCE_MS = 300;

function createJsonStore(filePath, defaults = {}) {
	let cache = null;
	let timer = null;

	async function flush(data) {
		const dir = path.dirname(filePath);
		fs.mkdirSync(dir, { recursive: true });
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	function scheduleFlush() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			flush(cache).catch(() => {});
		}, DEBOUNCE_MS);
	}

	async function read() {
		if (cache !== null) return cache;
		try {
			const raw = await fsp.readFile(filePath, 'utf-8');
			cache = { ...defaults, ...JSON.parse(raw) };
		} catch {
			cache = { ...defaults };
		}
		return cache;
	}

	async function get(key) {
		const data = await read();
		return data[key];
	}

	async function set(key, val) {
		await read();
		cache[key] = val;
		scheduleFlush();
	}

	async function write(data) {
		await read();
		Object.assign(cache, data);
		if (timer) clearTimeout(timer);
		timer = null;
		await flush(cache);
	}

	return { read, get, set, write };
}

module.exports = { createJsonStore };
