// Tool handlers: read_file, write_file, list_directory
const fs = require('fs');

async function read_file(args) {
	const filePath = args.path || '';
	if (!filePath) return { ok: false, result: 'No path provided' };
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
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
		fs.writeFileSync(writePath, writeContent, 'utf-8');
		return { ok: true, result: `Wrote ${writeContent.length} bytes to ${writePath}` };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

async function list_directory(args) {
	const dirPath = args.path || '.';
	try {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });
		const list = entries.map(e => (e.isDirectory() ? '\u{1F4C1} ' : '  ') + e.name).join('\n');
		return { ok: true, result: list || '(empty)' };
	} catch (err) {
		return { ok: false, result: 'Error: ' + err.message };
	}
}

module.exports = { read_file, write_file, list_directory };
