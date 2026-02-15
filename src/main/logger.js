// Unified logger — writes to ~/Desktop/consolidated_messages.log + console
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PATH = path.join(os.homedir(), 'Desktop', 'consolidated_messages.log');
const MAX_SIZE = 2 * 1024 * 1024; // 2MB — truncate when exceeded

// Detect broken stdout/stderr pipe — skip console calls entirely when broken
let stdoutOk = true;
let stderrOk = true;
if (process.stdout) process.stdout.on('error', () => { stdoutOk = false; });
if (process.stderr) process.stderr.on('error', () => { stderrOk = false; });

function _ts() {
	return new Date().toISOString();
}

function _truncateIfNeeded() {
	try {
		const stat = fs.statSync(LOG_PATH);
		if (stat.size > MAX_SIZE) {
			const content = fs.readFileSync(LOG_PATH, 'utf-8');
			const half = content.slice(content.length - MAX_SIZE / 2);
			const firstNewline = half.indexOf('\n');
			fs.writeFileSync(LOG_PATH, '[...truncated...]\n' + half.slice(firstNewline + 1));
		}
	} catch {}
}

function _write(level, tag, args) {
	const msg = args.map(a => {
		if (a instanceof Error) return a.stack || a.message;
		if (typeof a === 'object') {
			try { return JSON.stringify(a); } catch { return String(a); }
		}
		return String(a);
	}).join(' ');

	const line = `${_ts()} [${level}] [${tag}] ${msg}\n`;
	try {
		fs.appendFileSync(LOG_PATH, line);
	} catch {}
}

// Truncate check every 100 writes
let writeCount = 0;
function write(level, tag, args) {
	_write(level, tag, args);
	if (++writeCount % 100 === 0) _truncateIfNeeded();
}

function info(tag, ...args) {
	if (stdoutOk) try { console.log(`[${tag}]`, ...args); } catch {}
	write('INFO', tag, args);
}

function error(tag, ...args) {
	if (stderrOk) try { console.error(`[${tag}]`, ...args); } catch {}
	write('ERROR', tag, args);
}

function warn(tag, ...args) {
	if (stderrOk) try { console.warn(`[${tag}]`, ...args); } catch {}
	write('WARN', tag, args);
}

// Write a session start marker
try {
	fs.appendFileSync(LOG_PATH, `\n${'='.repeat(60)}\n${_ts()} [SESSION] Iris started\n${'='.repeat(60)}\n`);
} catch {}

module.exports = { info, error, warn, LOG_PATH };
