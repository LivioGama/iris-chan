const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const workspace = require('../workspace');

async function read_file(args) {
	const filePath = args.path || '';
	if (!filePath) return { ok: false, result: 'No path provided' };
	try {
		const content = fs.readFileSync(workspace.resolve(filePath), 'utf-8');
		return { ok: true, result: content.slice(0, 4000) };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

async function write_file(args) {
	const writePath = args.path || '';
	const writeContent = args.content || '';
	if (!writePath) return { ok: false, result: 'No path provided' };
	try {
		const resolved = workspace.resolve(writePath);
		fs.writeFileSync(resolved, writeContent, 'utf-8');
		return { ok: true, result: `Wrote ${writeContent.length} bytes to ${resolved}` };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

async function list_directory(args) {
	const dirPath = args.path || '.';
	try {
		const entries = fs.readdirSync(workspace.resolve(dirPath), { withFileTypes: true });
		const list = entries.map(e => (e.isDirectory() ? '\u{1F4C1} ' : '  ') + e.name).join('\n');
		return { ok: true, result: list || '(empty)' };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

async function move_file(args) {
	const source = workspace.resolve(args.source || args.from || '');
	const destination = workspace.resolve(args.destination || args.to || '');
	if (!args.source && !args.from) return { ok: false, result: 'No source path provided' };
	if (!args.destination && !args.to) return { ok: false, result: 'No destination path provided' };
	try {
		let finalDest = destination;
		try {
			if (fs.statSync(destination).isDirectory()) {
				finalDest = path.join(destination, path.basename(source));
			}
		} catch {}
		// Use rename for same-device, fallback to cp+rm for cross-device
		try {
			fs.renameSync(source, finalDest);
		} catch (renameErr) {
			if (renameErr.code === 'EXDEV') {
				execSync(`cp -R "${source}" "${finalDest}"`);
				execSync(`rm -rf "${source}"`);
			} else {
				throw renameErr;
			}
		}
		return { ok: true, result: `Moved ${source} → ${finalDest}` };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

async function get_finder_selection() {
	try {
		const script = `
			tell application "Finder"
				set sel to selection
				if (count of sel) is 0 then
					set cwd to (target of front Finder window) as alias
					return POSIX path of cwd
				end if
				set paths to {}
				repeat with item_ in sel
					set end of paths to POSIX path of (item_ as alias)
				end repeat
				return paths as text
			end tell
		`;
		const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
		// Split by ", " in case multiple items selected (AppleScript list coercion)
		const items = result.split(', ').filter(Boolean);
		return { ok: true, result: items.length === 1 ? items[0] : items.join('\n') };
	} catch (err) {
		return { ok: false, result: 'Error getting Finder selection: ' + err.message };
	}
}

function runFinderAppleScript(script, timeout = 5000) {
	const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
	return result;
}

async function finder_select_item(args) {
	const name = String(args?.name || '').trim();
	if (!name) return { ok: false, result: 'No Finder item name provided' };
	try {
		const result = runFinderAppleScript(`
			tell application "Finder"
				activate
				if (count of windows) is 0 then error "No Finder window open"
				set targetFolder to target of front window
				set matches to every item of targetFolder whose name is "${name.replace(/"/g, '\\"')}"
				if (count of matches) is 0 then error "No Finder item matched ${name.replace(/"/g, '\\"')}"
				select item 1 of matches
				return POSIX path of ((item 1 of matches) as alias)
			end tell
		`);
		return { ok: true, result: `Selected Finder item "${name}"`, path: result };
	} catch (err) {
		return { ok: false, result: `Error selecting Finder item: ${err.message}` };
	}
}

async function finder_open_item(args) {
	const name = String(args?.name || '').trim();
	if (!name) return { ok: false, result: 'No Finder item name provided' };
	try {
		const result = runFinderAppleScript(`
			tell application "Finder"
				activate
				if (count of windows) is 0 then error "No Finder window open"
				set targetFolder to target of front window
				set matches to every item of targetFolder whose name is "${name.replace(/"/g, '\\"')}"
				if (count of matches) is 0 then error "No Finder item matched ${name.replace(/"/g, '\\"')}"
				open item 1 of matches
				return POSIX path of ((item 1 of matches) as alias)
			end tell
		`);
		return { ok: true, result: `Opened Finder item "${name}"`, path: result };
	} catch (err) {
		return { ok: false, result: `Error opening Finder item: ${err.message}` };
	}
}

const BROWSER_JS = `
(function() {
	var imgs = Array.from(document.querySelectorAll('img'));
	if (!imgs.length) return JSON.stringify({error: 'No images found'});
	var best = imgs.reduce(function(a, b) {
		var aArea = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
		var bArea = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
		return bArea > aArea ? b : a;
	});
	var src = best.src || best.currentSrc;
	if (!src || src.startsWith('data:')) return JSON.stringify({error: 'No downloadable image URL'});
	return JSON.stringify({url: src, w: best.naturalWidth || best.width, h: best.naturalHeight || best.height});
})()
`.trim().replace(/\n/g, ' ');

function _runAppleScript(script, timeout = 5000) {
	const r = spawnSync('osascript', ['-e', script], { timeout, encoding: 'utf-8' });
	if (r.status !== 0 || r.error) throw new Error(r.stderr || r.error?.message || 'AppleScript failed');
	return r.stdout.trim();
}

function _getBrowserUrl(appName) {
	const strategies = [
		`tell application "${appName}" to get URL of active tab of front window`,
		`tell application "${appName}" to get URL of front document`,
		`tell application "${appName}" to get URL of current tab of front window`,
	];
	for (const script of strategies) {
		try { return _runAppleScript(script, 3000); } catch {}
	}
	return null;
}

function _downloadViaUrlFallback(appName, savePath) {
	const pageUrl = _getBrowserUrl(appName);
	if (!pageUrl || !pageUrl.startsWith('http')) {
		return { ok: false, result: `"${appName}" does not support JS execution or URL retrieval via AppleScript` };
	}
	try {
		const html = execSync(`curl -sL "${pageUrl}"`, { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }).toString();
		const imgs = [];
		const re = /<img[^>]+src=["']([^"']+)["'][^>]*/gi;
		let m;
		while ((m = re.exec(html)) !== null) {
			const src = m[1];
			if (src.startsWith('data:')) continue;
			const wm = m[0].match(/width=["']?(\d+)/);
			const hm = m[0].match(/height=["']?(\d+)/);
			const w = wm ? parseInt(wm[1]) : 0;
			const h = hm ? parseInt(hm[1]) : 0;
			imgs.push({ src, w, h, area: w * h });
		}
		if (!imgs.length) return { ok: false, result: 'No images found on page' };
		imgs.sort((a, b) => b.area - a.area);
		const best = imgs[0];
		let imgUrl = best.src;
		if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
		else if (imgUrl.startsWith('/')) {
			const base = new URL(pageUrl);
			imgUrl = base.origin + imgUrl;
		}
		execSync(`curl -sL -o "${savePath}" "${imgUrl}"`, { timeout: 15000 });
		if (!fs.existsSync(savePath)) return { ok: false, result: 'Download failed' };
		return { ok: true, result: `Image saved to: ${savePath} (${best.w || '?'}×${best.h || '?'}, URL fallback from ${appName})` };
	} catch (err) {
		return { ok: false, result: `Fallback download failed: ${err.message}` };
	}
}

async function download_browser_image(args) {
	const savePath = args.path || path.join(os.homedir(), 'Desktop', 'browser_image.png');
	try {
		const appResult = _runAppleScript(
			'tell application "System Events" to get name of first application process whose frontmost is true', 3000
		);

		let jsResult;
		const jsCode = BROWSER_JS.replace(/"/g, '\\"');
		if (appResult === 'Safari') {
			jsResult = _runAppleScript(
				`tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`
			);
		} else {
			try {
				jsResult = _runAppleScript(
					`tell application "${appResult}" to execute front window's active tab javascript "${jsCode}"`
				);
			} catch {
				return _downloadViaUrlFallback(appResult, savePath);
			}
		}

		const parsed = JSON.parse(jsResult);
		if (parsed.error) return { ok: false, result: parsed.error };

		execSync(`curl -sL -o "${savePath}" "${parsed.url}"`, { timeout: 15000 });

		if (!fs.existsSync(savePath)) return { ok: false, result: 'Download failed' };
		return { ok: true, result: `Image saved to: ${savePath} (${parsed.w}×${parsed.h})` };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

module.exports = { read_file, write_file, list_directory, move_file, get_finder_selection, finder_select_item, finder_open_item, download_browser_image };
