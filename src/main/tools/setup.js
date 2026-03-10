// Tool handler: execute_setup — read and execute setup instruction files from ~/.iris/setups/
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('../logger');

const SETUPS_DIR = path.join(os.homedir(), '.iris', 'setups');

async function execute_setup(args) {
	const name = (args.name || '').trim();

	// Ensure setups directory exists
	if (!fs.existsSync(SETUPS_DIR)) {
		fs.mkdirSync(SETUPS_DIR, { recursive: true });
	}

	// No name → list available setups
	if (!name) {
		const files = fs.readdirSync(SETUPS_DIR).filter(f => f.endsWith('.md'));
		if (!files.length) {
			return { ok: false, result: `No setups found in ${SETUPS_DIR}. Create a .md file there with numbered instructions.` };
		}
		const list = files.map(f => {
			const content = fs.readFileSync(path.join(SETUPS_DIR, f), 'utf8');
			const firstLine = content.split('\n').find(l => l.trim()) || '(empty)';
			return `• ${f.replace('.md', '')}: ${firstLine.replace(/^#+\s*/, '')}`;
		}).join('\n');
		return { ok: true, result: `Available setups:\n${list}\n\nCall execute_setup with a name to load one.` };
	}

	// Load specific setup
	const filePath = path.join(SETUPS_DIR, name.endsWith('.md') ? name : `${name}.md`);
	if (!fs.existsSync(filePath)) {
		return { ok: false, result: `Setup "${name}" not found at ${filePath}` };
	}

	const content = fs.readFileSync(filePath, 'utf8');
	if (!content.trim()) {
		return { ok: false, result: `Setup "${name}" is empty.` };
	}

	log.info('Setup', `Loaded setup: ${name} (${content.length} chars)`);

	return {
		ok: true,
		result: `SETUP INSTRUCTIONS — execute these step by step using your tools (run_terminal_command, write_file, etc.). Follow the SCREEN-INSTRUCTION EXECUTION RULES: summarize what you'll do in two sentences, ask for confirmation, then execute step by step.\n\n${content}`,
	};
}

module.exports = { execute_setup };
