// Tool executor: dispatches Gemini tool calls to native helper or Node APIs
const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HELPER_SRC = path.join(__dirname, 'helpers', 'iris-helper.swift');
const HELPER_BIN = path.join(__dirname, 'helpers', 'iris-helper');

let compiled = false;

function ensureCompiled() {
	return new Promise((resolve, reject) => {
		if (compiled || fs.existsSync(HELPER_BIN)) {
			compiled = true;
			return resolve();
		}
		console.log('[ToolExecutor] Compiling Swift helper...');
		exec(`swiftc -O -o "${HELPER_BIN}" "${HELPER_SRC}"`, (err, stdout, stderr) => {
			if (err) {
				console.error('[ToolExecutor] Compile error:', stderr);
				return reject(new Error('Swift compile failed: ' + stderr));
			}
			console.log('[ToolExecutor] Helper compiled successfully');
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
		execFile(HELPER_BIN, [arg], { timeout: 10000 }, (err, stdout, stderr) => {
			if (err) return resolve({ ok: false, result: stderr || err.message });
			try {
				resolve(JSON.parse(stdout.trim()));
			} catch {
				resolve({ ok: true, result: stdout.trim() });
			}
		});
	});
}

async function execute(name, args) {
	switch (name) {
		case 'type_text':
			return runHelper({ action: 'type_text', text: args.text || '' });

		case 'press_key':
			return runHelper({ action: 'press_key', key: args.key || '' });

		case 'scroll':
			return runHelper({
				action: 'scroll',
				direction: args.direction || 'down',
				amount: args.amount != null ? parseInt(args.amount) : 3,
			});

		case 'click_at':
			return runHelper({
				action: 'click_at',
				x: parseFloat(args.x || 0),
				y: parseFloat(args.y || 0),
				button: args.button || 'left',
			});

		case 'double_click':
			return runHelper({
				action: 'double_click',
				x: parseFloat(args.x || 0),
				y: parseFloat(args.y || 0),
			});

		case 'mouse_move':
			return runHelper({
				action: 'mouse_move',
				x: parseFloat(args.x || 0),
				y: parseFloat(args.y || 0),
			});

		case 'drag':
			return runHelper({
				action: 'drag',
				x: parseFloat(args.x || 0),
				y: parseFloat(args.y || 0),
				x2: parseFloat(args.x2 || 0),
				y2: parseFloat(args.y2 || 0),
			});

		case 'get_mouse_position':
			return runHelper({ action: 'get_mouse_position' });

		case 'clipboard_read':
			return runHelper({ action: 'clipboard_read' });

		case 'clipboard_write':
			return runHelper({ action: 'clipboard_write', text: args.text || '' });

		case 'notify':
			return runHelper({ action: 'notify', text: args.text || 'Notification from Iris' });

		case 'ask_chatgpt': {
			const prompt = args.prompt || '';
			if (!prompt) return { ok: false, result: 'No prompt provided' };

			// 1. Focus ChatGPT app
			await new Promise((resolve) => {
				exec(`osascript -e 'tell application "ChatGPT" to activate'`, { timeout: 3000 }, resolve);
			});
			await new Promise(r => setTimeout(r, 800));

			// 2. Start a new chat (Cmd+N) to avoid context pollution
			await runHelper({ action: 'press_key', key: 'cmd+n' });
			await new Promise(r => setTimeout(r, 500));

			// 3. Type the prompt and send
			await runHelper({ action: 'type_text', text: prompt });
			await new Promise(r => setTimeout(r, 300));
			await runHelper({ action: 'press_key', key: 'return' });

			// 4. Wait for response to generate
			await new Promise(r => setTimeout(r, 8000));

			// 5. Select all and copy the response
			await runHelper({ action: 'press_key', key: 'cmd+shift+c' });
			await new Promise(r => setTimeout(r, 300));

			// 6. Read clipboard
			const clipResult = await runHelper({ action: 'clipboard_read' });
			const response = clipResult?.result || '(no response captured)';

			return { ok: true, result: response.slice(0, 4000) };
		}

		case 'open_app':
			return runHelper({ action: 'open_app', name: args.name || '' });

		case 'run_terminal_command': {
			const command = args.command || '';
			if (!command) return { ok: false, result: 'No command provided' };
			return new Promise((resolve) => {
				exec(command, { timeout: 10000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
					if (err && !stdout && !stderr) {
						return resolve({ ok: false, result: err.message });
					}
					const output = (stdout || '') + (stderr ? '\n' + stderr : '');
					resolve({ ok: !err, result: output.trim().slice(0, 2000) || '(no output)' });
				});
			});
		}

		case 'propose_reply':
			return runHelper({ action: 'type_text', text: args.reply || '' });

		case 'set_volume':
			return runHelper({ action: 'set_volume', level: parseFloat(args.level || 0.5) });

		case 'get_frontmost_app':
			return runHelper({ action: 'get_frontmost_app' });

		case 'window_manage':
			return runHelper({ action: 'window_manage', position: args.position || 'maximize' });

		case 'read_file': {
			const filePath = args.path || '';
			if (!filePath) return { ok: false, result: 'No path provided' };
			try {
				const content = fs.readFileSync(filePath, 'utf-8');
				return { ok: true, result: content.slice(0, 4000) };
			} catch (err) {
				return { ok: false, result: 'Error: ' + err.message };
			}
		}

		case 'write_file': {
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

		case 'list_directory': {
			const dirPath = args.path || '.';
			try {
				const entries = fs.readdirSync(dirPath, { withFileTypes: true });
				const list = entries.map(e => (e.isDirectory() ? '📁 ' : '  ') + e.name).join('\n');
				return { ok: true, result: list || '(empty)' };
			} catch (err) {
				return { ok: false, result: 'Error: ' + err.message };
			}
		}

		case 'web_search': {
			const query = args.query || '';
			if (!query) return { ok: false, result: 'No query provided' };

			const OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';
			if (!OLLAMA_KEY) return { ok: false, result: 'OLLAMA_API_KEY not configured' };

			const OLLAMA_HOST = 'https://ollama.com';
			const headers = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${OLLAMA_KEY}`,
			};

			try {
				const searchResp = await fetch(`${OLLAMA_HOST}/api/web_search`, {
					method: 'POST', headers,
					body: JSON.stringify({ query, max_results: 5 }),
					signal: AbortSignal.timeout(15000),
				});
				if (!searchResp.ok) {
					return { ok: false, result: 'Search API error: ' + searchResp.status };
				}
				const searchData = await searchResp.json();
				const results = searchData.results || [];

				if (!results.length) return { ok: true, result: 'No search results found.' };

				const rawResults = results
					.map(r => `## ${r.title}\nURL: ${r.url}\n${(r.content || r.snippet || '').slice(0, 1500)}`)
					.join('\n\n---\n\n')
					.slice(0, 8000);

				const synthResp = await fetch(`${OLLAMA_HOST}/api/chat`, {
					method: 'POST', headers,
					body: JSON.stringify({
						model: 'gpt-oss:120b-cloud',
						messages: [
							{ role: 'system', content: 'You are a search-result synthesizer. Your output feeds directly into another LLM — not a human. Rules: Return ONLY factual data. No greetings, disclaimers, or filler. Use compact bullet points. Include source URLs as [title](url). Max 400 words.' },
							{ role: 'user', content: `Query: ${query}\n\nSearch results:\n${rawResults}\n\nSynthesize these results into a concise, structured answer.` },
						],
						stream: false,
						think: false,
					}),
					signal: AbortSignal.timeout(30000),
				});

				if (!synthResp.ok) {
					return { ok: true, result: rawResults.slice(0, 4000) };
				}

				const synthData = await synthResp.json();
				const answer = synthData.message?.content || '';

				if (answer.length < 20) {
					return { ok: true, result: rawResults.slice(0, 4000) };
				}

				return { ok: true, result: answer.slice(0, 4000) };
			} catch (err) {
				return { ok: false, result: 'Search error: ' + err.message };
			}
		}

		case 'manage_vocabulary': {
			const action = args.action || 'list';
			const irisDir = path.join(os.homedir(), '.iris');
			const vocabPath = path.join(irisDir, 'vocabulary.json');
			let vocab;
			try {
				vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
			} catch {
				vocab = { terms: [] };
			}

			if (action === 'add' && args.term) {
				const term = args.term.trim();
				if (!vocab.terms.includes(term)) {
					vocab.terms.push(term);
					fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
					return { ok: true, result: `Added "${term}". Applied live.` };
				}
				return { ok: true, result: `"${term}" already in vocabulary.` };
			} else if (action === 'remove' && args.term) {
				const idx = vocab.terms.indexOf(args.term.trim());
				if (idx !== -1) {
					vocab.terms.splice(idx, 1);
					fs.writeFileSync(vocabPath, JSON.stringify(vocab, null, '\t') + '\n', 'utf-8');
					return { ok: true, result: `Removed "${args.term}". Applied live.` };
				}
				return { ok: true, result: `"${args.term}" not found in vocabulary.` };
			} else if (action === 'stats') {
				const statsPath = path.join(irisDir, 'vocabulary-stats.json');
				let stats;
				try { stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')); } catch { stats = {}; }
				const entries = Object.entries(stats).sort((a, b) => b[1].count - a[1].count);
				if (entries.length === 0) return { ok: true, result: 'No vocabulary usage recorded yet.' };
				const top = entries.slice(0, 30).map(([term, s]) => `${term}: ${s.count}x (last: ${s.lastUsed?.slice(0, 10) || '?'})`).join('\n');
				return { ok: true, result: `Vocabulary usage (${entries.length} terms used):\n${top}` };
			} else {
				return { ok: true, result: `Vocabulary (${vocab.terms.length} terms): ${vocab.terms.join(', ') || '(empty)'}` };
			}
		}

		case 'self_fix': {
			const desc = args.description || '';
			const files = args.files_to_touch || '';
			if (!desc) return { ok: false, result: 'No description provided' };

			const fileList = [
				'main.js', 'index.html', 'voice-pipeline.js', 'gemini-client.js',
				'audio-capture.js', 'audio-playback.js', 'tool-executor.js',
				'screen-capture.js', 'helpers/iris-helper.swift',
			];

			// Build context: file sizes so Claude knows the codebase
			const fileInfo = fileList.map(f => {
				try {
					const stat = fs.statSync(path.join(__dirname, f));
					return `  - ${f} (${stat.size} bytes)`;
				} catch { return `  - ${f} (not found)`; }
			}).join('\n');

			const prompt = [
				`[IRIS SELF-FIX REQUEST]`,
				``,
				`Iris (the AI assistant whose code is in this directory) is asking you to modify her own source code.`,
				``,
				`## What to do`,
				desc,
				``,
				files ? `## Files likely involved\n${files}\n` : '',
				`## Project files`,
				fileInfo,
				``,
				`## Rules`,
				`- Edit files in place, don't recreate them`,
				`- Don't touch audio-playback.js scheduling unless explicitly asked`,
				`- After changes, the app needs a manual restart (no hot-reload)`,
				`- Keep changes minimal and focused`,
			].filter(Boolean).join('\n');

			// Focus the terminal running Claude Code before typing
			await new Promise((resolve) => {
				exec(`osascript -e 'tell application "Warp" to activate'`, { timeout: 3000 }, resolve);
			});
			await new Promise(r => setTimeout(r, 500));

			// Type the prompt into Claude Code and submit
			await runHelper({ action: 'type_text', text: prompt });
			await new Promise(r => setTimeout(r, 300));
			await runHelper({ action: 'press_key', key: 'return' });

			return { ok: true, result: 'Self-fix prompt submitted to Claude Code' };
		}

		default:
			return { ok: false, result: `Unknown tool: ${name}` };
	}
}

module.exports = { execute };
