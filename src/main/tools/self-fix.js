// Patterns that indicate the user announced intent but hasn't given specifics yet
const VAGUE_INTENT_PATTERNS = [
	/^(the )?user (wants?|is going|said|asked) to (change|modify|fix|update|improve) (me|iris|myself|herself)/i,
	/^(i'm going to|je vais|attends|wait|hold on|let me)/i,
	/^(change|modify|fix) (requested|incoming|expected)/i,
	/^awaiting (change|modification|instruction)/i,
	/^user (will|wants to) (change|modify)/i,
];

async function self_fix(args) {
	const description = (args.description || '').trim();

	// Reject vague intent announcements that lack specifics
	if (!description || description.length < 30) {
		return {
			ok: false,
			result: 'Description too vague. Wait for the user to specify WHAT they want to change, then call self_fix with a detailed description including: problem, desired behavior, files involved, and implementation approach.',
		};
	}

	// Check for preamble-style descriptions that lack actionable content
	if (VAGUE_INTENT_PATTERNS.some(p => p.test(description))) {
		return {
			ok: false,
			result: 'This looks like an intent announcement, not a specific change request. Wait for the user to describe the exact change they want, then call self_fix with those details.',
		};
	}

	const fixProject = require('./fix-project');
	return fixProject.fix_project({
		description: args.description || '',
		target: 'iris',
		_runSDK: args._runSDK,
	});
}

module.exports = { self_fix };
