const assert = require('node:assert');
const {
	analyzeReplyOpportunity,
} = require('../src/main/automation/reply-assistant');

console.log('Running reply assistant heuristics tests...');

const chatSnapshot = {
	appName: 'Slack',
	windowTitle: 'general',
	elements: [
		{ role: 'AXStaticText', detail: 'Alice' },
		{ role: 'AXStaticText', detail: 'Can you review the latest copy?' },
		{ role: 'AXStaticText', detail: 'Unread messages' },
		{ role: 'AXStaticText', detail: 'Bob' },
		{ role: 'AXStaticText', detail: 'Need a reply today.' },
		{ role: 'AXTextArea', detail: 'Write a message' },
		{ role: 'AXButton', detail: 'Send' },
	],
};

const docSnapshot = {
	appName: 'TextEdit',
	windowTitle: 'notes.txt',
	elements: [
		{ role: 'AXTextArea', detail: 'Project meeting notes\nconst foo = 1;\nhttps://example.com\nfunction bar() {}' },
		{ role: 'AXStaticText', detail: 'Chapter 1' },
		{ role: 'AXStaticText', detail: 'These are long notes about the plan and next steps for the project.' },
	],
};

const browserChatSnapshot = {
	appName: 'Google Chrome',
	windowTitle: 'Discord',
	elements: [
		{ role: 'AXStaticText', detail: 'Theo' },
		{ role: 'AXStaticText', detail: 'Are you joining the call?' },
		{ role: 'AXStaticText', detail: 'You: sounds good' },
		{ role: 'AXStaticText', detail: 'Ping me when ready' },
		{ role: 'AXTextField', detail: 'Message #general' },
		{ role: 'AXButton', detail: 'Send message' },
	],
};

{
	const analysis = analyzeReplyOpportunity({
		frontmostApp: { name: 'Slack', windows: ['general'] },
		axSnapshot: chatSnapshot,
	});
	assert.strictEqual(analysis.shouldOffer, true, 'chat snapshot should offer reply suggestions');
	assert.strictEqual(analysis.needsReply, true, 'unread signal should mark thread as needing reply');
	assert.ok(analysis.composerQueries.length > 0, 'composer queries should be generated');
	assert.ok(analysis.sendQueries.length > 0, 'send queries should be generated');
}

{
	const analysis = analyzeReplyOpportunity({
		frontmostApp: { name: 'TextEdit', windows: ['notes.txt'] },
		axSnapshot: docSnapshot,
	});
	assert.strictEqual(analysis.shouldOffer, false, 'document-like snapshot should not offer reply suggestions');
	assert.strictEqual(analysis.askToHelp, false, 'document-like snapshot should not prompt for reply help');
}

{
	const analysis = analyzeReplyOpportunity({
		frontmostApp: { name: 'Google Chrome', windows: ['Discord'] },
		axSnapshot: browserChatSnapshot,
	});
	assert.ok(analysis.confidence >= 0.5, 'browser chat should still look conversation-like');
	assert.strictEqual(analysis.needsReply, true, 'latest visible non-self message should need a reply');
}

console.log('Reply assistant heuristics tests passed.');
