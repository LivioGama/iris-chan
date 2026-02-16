// Dynamic skill loader: discovers SKILL.md files from ~/.iris/skills/
// Format: SKILL.md (description + system prompt) + optional tools.json + scripts/
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const config = require('../shared/config');
const log = require('./logger');
const workspace = require('./workspace');

const skillsDir = path.join(config.paths.irisDir, 'skills');
const SKILL_LOG = path.join(config.paths.irisDir, 'skill_log.txt');

// Track active long-running skill processes
let activeSkillProcess = null;
let activeSkillName = null;

function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: content };
	const meta = {};
	for (const line of match[1].split('\n')) {
		const kv = line.match(/^([\w-]+):\s*(.+)$/);
		if (kv) meta[kv[1]] = kv[2].trim();
	}
	return { meta, body: match[2].trim() };
}

// Scan skills directory — called dynamically each time, no restart needed
function scan() {
	const skills = [];
	try { fs.mkdirSync(skillsDir, { recursive: true }); } catch {}

	let entries;
	try {
		entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	} catch {
		return skills;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillDir = path.join(skillsDir, entry.name);
		const mdPath = path.join(skillDir, 'SKILL.md');

		if (!fs.existsSync(mdPath)) continue;

		try {
			const content = fs.readFileSync(mdPath, 'utf-8');
			const { meta, body } = parseFrontmatter(content);
			const name = meta.name || entry.name;

			// Tool declarations from tools.json (Gemini format, no parsing ambiguity)
			const tools = [];
			const toolsJsonPath = path.join(skillDir, 'tools.json');
			if (fs.existsSync(toolsJsonPath)) {
				const toolsData = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
				const arr = Array.isArray(toolsData) ? toolsData : toolsData.tools || [];
				tools.push(...arr.filter(t => t.name));
			}

			// Detect script handlers in scripts/ directory
			const scriptsPath = path.join(skillDir, 'scripts');
			const scriptMap = {};
			if (fs.existsSync(scriptsPath)) {
				for (const f of fs.readdirSync(scriptsPath)) {
					scriptMap[path.parse(f).name] = path.join(scriptsPath, f);
				}
			}

			skills.push({
				name,
				description: meta.description || '',
				dir: skillDir,
				tools,
				scriptMap,
				systemPrompt: body || null,
			});
		} catch (err) {
			log.error('Skills', `Error loading ${entry.name}: ${err.message}`);
		}
	}

	return skills;
}

function getDeclarations() {
	const decls = [];
	for (const skill of scan()) decls.push(...skill.tools);
	return decls;
}

function getSystemPrompts() {
	// Only inject prompts from skills that declare tools (active skills)
	// Skills without tools.json are passive reference docs, not injected
	return scan()
		.filter(s => s.systemPrompt && s.tools.length > 0)
		.map(s => `[Skill: ${s.name}]\n${s.systemPrompt}`);
}

function getHandler(toolName) {
	for (const skill of scan()) {
		if (!skill.tools.some(t => t.name === toolName)) continue;

		const scriptPath = skill.scriptMap[toolName];
		if (!scriptPath) {
			return () => ({ ok: true, result: `Skill "${skill.name}" handled "${toolName}" (prompt-only)` });
		}

		return (args) => new Promise((resolve) => {
			const homedir = os.homedir();
			const extraPaths = [`${homedir}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin'];
			const wsDir = (args && args.workspace) || workspace.get();
			const env = { ...process.env, CLAUDECODE: '1', IRIS_WORKSPACE: wsDir, PATH: extraPaths.join(':') + ':' + (process.env.PATH || '') };
			const child = spawn(scriptPath, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });

			activeSkillProcess = child;
			activeSkillName = toolName;
			log.info(`Skill:${toolName}`, `Started (pid ${child.pid})`);

			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (d) => {
				stdout += d;
			});
			child.stderr.on('data', (d) => {
				stderr += d;
				// Stream progress lines to the logger in real-time
				const lines = d.toString().split('\n').filter(l => l.trim());
				for (const line of lines) {
					log.info(`Skill:${toolName}`, line.trim());
				}
			});

			child.on('close', (code, signal) => {
				activeSkillProcess = null;
				activeSkillName = null;
				const ts = new Date().toISOString();
				const logLines = [`\n=== [${ts}] skill_script: ${toolName} ===`, `PATH: ${scriptPath}`, `ARGS: ${JSON.stringify(args || {})}`, stdout ? `STDOUT:\n${stdout.slice(0, 2000)}` : 'STDOUT: (empty)', stderr ? `STDERR:\n${stderr.slice(0, 2000)}` : 'STDERR: (empty)', signal ? `SIGNAL: ${signal}` : `EXIT: ${code}`, '---'];
				try { fs.appendFileSync(SKILL_LOG, logLines.join('\n') + '\n'); } catch {}

				if (signal === 'SIGTERM' || signal === 'SIGKILL') {
					resolve({ ok: false, result: `Skill "${toolName}" was killed` });
					return;
				}
				if (code !== 0) {
					resolve({ ok: false, result: `Script error (exit ${code})${stderr ? '\n' + stderr.slice(0, 500) : ''}` });
					return;
				}
				try { resolve(JSON.parse(stdout)); }
				catch { resolve({ ok: true, result: stdout.trim().slice(0, 500) }); }
			});

			child.on('error', (err) => {
				activeSkillProcess = null;
				activeSkillName = null;
				resolve({ ok: false, result: `Script error: ${err.message}` });
			});

			if (child.stdin) {
				child.stdin.write(JSON.stringify(args || {}));
				child.stdin.end();
			}
		});
	}
	return null;
}

function killSkill() {
	if (!activeSkillProcess) {
		return { ok: false, result: 'No skill process running' };
	}
	const name = activeSkillName || 'unknown';
	log.info('Skills', `Killing skill process: ${name} (pid ${activeSkillProcess.pid})`);
	activeSkillProcess.kill('SIGTERM');
	return { ok: true, result: `Sent SIGTERM to "${name}"` };
}

// Lightweight catalog: name + description for all skills (injected into system prompt)
function getCatalog() {
	return scan().map(s => ({
		name: s.name,
		description: s.description || '(no description)',
	}));
}

// Return full SKILL.md content + available scripts for on-demand use
function getSkillContent(name) {
	const all = scan();
	const skill = all.find(s => s.name === name || s.dir.endsWith('/' + name));
	if (!skill) return { ok: false, result: `Skill "${name}" not found. Available: ${all.map(s => s.name).join(', ')}` };

	const scripts = Object.keys(skill.scriptMap);
	return {
		ok: true,
		result: [
			`# Skill: ${skill.name}`,
			`Location: ${skill.dir}`,
			skill.description ? `Description: ${skill.description}` : '',
			scripts.length ? `Available scripts: ${scripts.join(', ')}` : '',
			'',
			'--- Instructions ---',
			skill.systemPrompt || '(no instructions)',
		].filter(Boolean).join('\n'),
	};
}

function getLoaded() {
	return scan().map(s => ({
		name: s.name,
		description: s.description,
		tools: s.tools.length,
		hasPrompt: !!s.systemPrompt,
	}));
}

// Run a skill by name (looks for first available script)
function runSkillByName(skillName, args) {
	return new Promise((resolve) => {
		const allSkills = scan();
		const skill = allSkills.find(s => s.name === skillName);
		
		if (!skill) {
			resolve({ ok: false, result: `Skill "${skillName}" not found. Available: ${allSkills.map(s => s.name).join(', ')}` });
			return;
		}

		// Get first available script
		const scriptNames = Object.keys(skill.scriptMap);
		if (scriptNames.length === 0) {
			resolve({ ok: false, result: `Skill "${skillName}" has no scripts` });
			return;
		}

		const scriptName = scriptNames[0];
		const scriptPath = skill.scriptMap[scriptName];

		const homedir = os.homedir();
		const extraPaths = [`${homedir}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin'];
		const wsDir = (args && args.workspace) || workspace.get();
		const env = { ...process.env, CLAUDECODE: '1', IRIS_WORKSPACE: wsDir, PATH: extraPaths.join(':') + ':' + (process.env.PATH || '') };
		const child = spawn(scriptPath, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });

		activeSkillProcess = child;
		activeSkillName = skillName;
		log.info(`Skill:${skillName}`, `Started (pid ${child.pid})`);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (d) => {
			stdout += d;
		});
		child.stderr.on('data', (d) => {
			stderr += d;
			const lines = d.toString().split('\n').filter(l => l.trim());
			for (const line of lines) {
				log.info(`Skill:${skillName}`, line.trim());
			}
		});

		child.on('close', (code, signal) => {
			activeSkillProcess = null;
			activeSkillName = null;
			const ts = new Date().toISOString();
			const logLines = [`\n=== [${ts}] skill: ${skillName} ===`, `SCRIPT: ${scriptName}`, `PATH: ${scriptPath}`, `ARGS: ${JSON.stringify(args || {})}`, stdout ? `STDOUT:\n${stdout.slice(0, 2000)}` : 'STDOUT: (empty)', stderr ? `STDERR:\n${stderr.slice(0, 2000)}` : 'STDERR: (empty)', signal ? `SIGNAL: ${signal}` : `EXIT: ${code}`, '---'];
			try { fs.appendFileSync(SKILL_LOG, logLines.join('\n') + '\n'); } catch {}

			if (signal === 'SIGTERM' || signal === 'SIGKILL') {
				resolve({ ok: false, result: `Skill "${skillName}" was killed` });
				return;
			}
			if (code !== 0) {
				resolve({ ok: false, result: `Script error (exit ${code})${stderr ? '\n' + stderr.slice(0, 500) : ''}` });
				return;
			}
			try { resolve(JSON.parse(stdout)); }
			catch { resolve({ ok: true, result: stdout.trim().slice(0, 500) }); }
		});

		child.on('error', (err) => {
			activeSkillProcess = null;
			activeSkillName = null;
			resolve({ ok: false, result: `Script error: ${err.message}` });
		});

		if (child.stdin) {
			child.stdin.write(JSON.stringify(args || {}));
			child.stdin.end();
		}
	});
}

module.exports = { scan, getDeclarations, getSystemPrompts, getHandler, getLoaded, getCatalog, getSkillContent, killSkill, runSkillByName };
