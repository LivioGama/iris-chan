// Renderer-side logger — forwards to main process via IPC for file writing

function _fmt(args) {
	return args.map(a => {
		if (a instanceof Error) return a.stack || a.message;
		if (typeof a === 'object') {
			try { return JSON.stringify(a); } catch { return String(a); }
		}
		return String(a);
	}).join(' ');
}

export function info(tag, ...args) {
	console.log(`[${tag}]`, ...args);
	window.electronAPI?.logToFile('info', tag, _fmt(args));
}

export function error(tag, ...args) {
	console.error(`[${tag}]`, ...args);
	window.electronAPI?.logToFile('error', tag, _fmt(args));
}

export function warn(tag, ...args) {
	console.warn(`[${tag}]`, ...args);
	window.electronAPI?.logToFile('warn', tag, _fmt(args));
}
