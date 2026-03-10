const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running UI task rendering tests...');

const appInit = fs.readFileSync(path.join(process.cwd(), 'src/renderer/app-init.js'), 'utf8');

assert.ok(
	appInit.includes("evt.payload?.taskKind === 'ui'"),
	'app-init should recognize UI task events'
);

assert.ok(
	appInit.includes("evt.type === 'TASK_MILESTONE'") && appInit.includes("evt.type === 'TASK_DONE'"),
	'app-init should filter UI task milestone/done events from user-facing rendering'
);

console.log('UI task rendering tests passed.');
