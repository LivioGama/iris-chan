const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('Running kanban queue merge tests...');

const kanbanPath = path.join(process.cwd(), 'src/renderer/kanban.html');
const source = fs.readFileSync(kanbanPath, 'utf8');

function extractBetween(startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	if (start < 0) throw new Error(`Missing marker: ${startMarker}`);
	const end = source.indexOf(endMarker, start);
	if (end < 0) throw new Error(`Missing end marker after: ${startMarker}`);
	return source.slice(start, end);
}

const snippet = [
	extractBetween('function queueTaskIdOf', 'function kanbanTaskIdForQueue'),
	extractBetween('function kanbanTaskIdForQueue', 'function isQueueTask'),
	extractBetween('function isQueueTask', 'function inferQueueTaskTitle'),
	extractBetween('function inferQueueTaskTitle', 'function normalizeQueueTask'),
	extractBetween('function normalizeComparableTaskText', 'function normalizeQueueTask'),
	extractBetween('function normalizeQueueTask', 'function upsertQueueTask'),
	extractBetween('function upsertQueueTask', 'function removeQueueTask'),
].join('\n');

const context = {
	tasks: [
		{
			id: 'task-7',
			title: 'get the performance benchmarks of Iris',
			description: '',
			status: 'TODO',
			originalStatus: 'queued',
			origin: 'kanban',
		},
	],
	dismissedQueueTaskIds: new Set(),
	mapTaskStatus(status) {
		const raw = String(status || '').toUpperCase();
		if (['RUNNING', 'IN_PROGRESS', 'RESUMING'].includes(raw)) return 'IN_PROGRESS';
		if (['DONE', 'COMPLETED'].includes(raw)) return 'DONE';
		return 'TODO';
	},
};

vm.createContext(context);
vm.runInContext(snippet, context);

const normalized = context.upsertQueueTask({
	_id: 'queue-42',
	rawPrompt: 'get the performance benchmarks of Iris',
	status: 'running',
	projectPath: '/tmp/project',
});

assert.ok(normalized, 'queue task should normalize');
assert.strictEqual(context.tasks.length, 1, 'matching plain TODO should be replaced instead of duplicated');
assert.strictEqual(context.tasks[0].queueTaskId, 'queue-42', 'merged task should adopt the queue id');
assert.strictEqual(context.tasks[0].origin, 'queue', 'merged task should become queue-backed');
assert.strictEqual(context.tasks[0].status, 'IN_PROGRESS', 'merged task should reflect live queue status');
assert.strictEqual(context.tasks[0].id, 'task-7', 'existing card identity should be preserved when replacing plain task');

console.log('Kanban queue merge tests passed.');
