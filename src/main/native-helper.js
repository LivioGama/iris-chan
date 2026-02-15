// Swift helper compilation + execution wrapper
const { execFile, exec } = require('child_process');
const fs = require('fs');
const config = require('../shared/config');
const log = require('./logger');

let compiled = false;

function ensureCompiled() {
	return new Promise((resolve, reject) => {
		if (compiled || fs.existsSync(config.paths.helperBin)) {
			compiled = true;
			return resolve();
		}
		log.info('NativeHelper', 'Compiling Swift helper...');
		exec(`swiftc -O -o "${config.paths.helperBin}" "${config.paths.helperSrc}"`, (err, stdout, stderr) => {
			if (err) {
				log.error('NativeHelper', 'Compile error:', stderr);
				return reject(new Error('Swift compile failed: ' + stderr));
			}
			log.info('NativeHelper', 'Helper compiled successfully');
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
		execFile(config.paths.helperBin, [arg], { timeout: 10000 }, (err, stdout, stderr) => {
			if (err) return resolve({ ok: false, result: stderr || err.message });
			try {
				resolve(JSON.parse(stdout.trim()));
			} catch {
				resolve({ ok: true, result: stdout.trim() });
			}
		});
	});
}

module.exports = { runHelper };
