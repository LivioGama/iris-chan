const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running tool declaration default-app tests...');

const declarations = fs.readFileSync(path.join(process.cwd(), 'src/renderer/gemini/tool-declarations.js'), 'utf8');
const prompt = fs.readFileSync(path.join(process.cwd(), 'src/renderer/gemini/system-prompt.js'), 'utf8');

assert.match(declarations, /name:\s*'get_default_app'/, 'tool declarations should expose get_default_app');
assert.match(prompt, /get_default_app/, 'system prompt should list get_default_app');

console.log('Tool declaration default-app tests passed.');
