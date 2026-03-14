const assert = require('node:assert');
const { describe, it } = require('node:test');

const {
	isFrustrationOrFeatureRequest,
	extractFrustrationSummary,
	classifyFrustrationSignals,
	LearningClassifier,
} = require('../src/main/automation/learning-classifier');

describe('isFrustrationOrFeatureRequest', () => {
	describe('wishes and feature requests', () => {
		it('detects "I wish you could ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('I wish you could schedule meetings for me'));
		});
		it('detects "I wish Iris could ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('I wish Iris could remember my preferences'));
		});
		it('detects "it would be nice if ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('It would be nice if you could read PDFs'));
		});
		it('detects "it\'d be nice if ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest("It'd be nice if you supported dark mode"));
		});
		it('detects "if only you could ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('If only you could handle multiple windows'));
		});
		it('detects "I need you to be able to ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('I need you to be able to parse spreadsheets'));
		});
		it('detects "you should be able to ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('You should be able to remember this across sessions'));
		});
		it('detects "can you learn to ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('Can you learn to handle drag and drop'));
		});
		it('detects "you should learn to ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('You should learn to do this automatically'));
		});
		it('detects "it would help if you could ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('It would help if you could summarize long pages'));
		});
	});

	describe('why-cant patterns', () => {
		it('detects "why can\'t you ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest("Why can't you read PDFs?"));
		});
		it('detects "why dont you ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest("Why don't you remember what I told you"));
		});
	});

	describe('complaint patterns', () => {
		it('detects "you can\'t even ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest("You can't even open a simple file"));
		});
		it('detects "you still can\'t ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest("You still can't handle multiple monitors"));
		});
		it('detects "you always fail to ..."', () => {
			assert.ok(isFrustrationOrFeatureRequest('You always fail to click the right button'));
		});
	});

	describe('explicit frustration', () => {
		it('detects "this is frustrating"', () => {
			assert.ok(isFrustrationOrFeatureRequest('This is frustrating when you miss clicks'));
		});
		it('detects "this is so frustrating"', () => {
			assert.ok(isFrustrationOrFeatureRequest('This is so frustrating every time'));
		});
		it('detects "I\'m frustrated"', () => {
			assert.ok(isFrustrationOrFeatureRequest("I'm frustrated with this workflow"));
		});
		it('detects "why is this so hard"', () => {
			assert.ok(isFrustrationOrFeatureRequest('Why is this so hard to do'));
		});
	});

	describe('transliterated patterns', () => {
		it('detects Hindi kaash tum (wish you could)', () => {
			assert.ok(isFrustrationOrFeatureRequest('काश तुम मीटिंग शेड्यूल कर सकते'));
		});
		it('detects Nepali kina garna sakdainau (why can\'t you)', () => {
			assert.ok(isFrustrationOrFeatureRequest('किन गर्न सक्दैनौ यो काम'));
		});
	});

	describe('exclusions — should NOT match', () => {
		it('rejects short utterances (< 4 words)', () => {
			assert.ok(!isFrustrationOrFeatureRequest('this is frustrating'));
		});
		it('rejects empty text', () => {
			assert.ok(!isFrustrationOrFeatureRequest(''));
		});
		it('rejects null', () => {
			assert.ok(!isFrustrationOrFeatureRequest(null));
		});
		it('rejects normal commands', () => {
			assert.ok(!isFrustrationOrFeatureRequest('Open Safari and go to Google'));
		});
		it('rejects pointer corrections', () => {
			assert.ok(!isFrustrationOrFeatureRequest('Click there on that button'));
		});
		it('rejects progress queries', () => {
			assert.ok(!isFrustrationOrFeatureRequest('What are you doing right now'));
		});
	});
});

describe('extractFrustrationSummary', () => {
	it('extracts from "I wish you could ..."', () => {
		assert.strictEqual(
			extractFrustrationSummary('I wish you could schedule meetings for me'),
			'schedule meetings for me'
		);
	});
	it('extracts from "why can\'t you ..."', () => {
		assert.strictEqual(
			extractFrustrationSummary("Why can't you read PDF files?"),
			'read pdf files?'
		);
	});
	it('extracts from "you should be able to ..."', () => {
		assert.strictEqual(
			extractFrustrationSummary('You should be able to remember this'),
			'remember this'
		);
	});
	it('extracts from "I\'m frustrated with ..."', () => {
		assert.strictEqual(
			extractFrustrationSummary("I'm frustrated with the clipboard handling"),
			'the clipboard handling'
		);
	});
	it('returns full text for unmatched patterns', () => {
		assert.strictEqual(
			extractFrustrationSummary('Why is this so hard to do'),
			'Why is this so hard to do'
		);
	});
});

describe('classifyFrustrationSignals', () => {
	it('returns wish signal for wish patterns', () => {
		const signals = classifyFrustrationSignals('I wish you could do this thing');
		assert.ok(signals.includes('wish'));
	});
	it('returns why-cant signal', () => {
		const signals = classifyFrustrationSignals("Why can't you handle this");
		assert.ok(signals.includes('why-cant'));
	});
	it('returns complaint signal', () => {
		const signals = classifyFrustrationSignals("You can't even open a file");
		assert.ok(signals.includes('complaint'));
	});
	it('returns explicit-frustration signal', () => {
		const signals = classifyFrustrationSignals('This is so frustrating every time');
		assert.ok(signals.includes('explicit-frustration'));
	});
	it('returns general for unclassified', () => {
		const signals = classifyFrustrationSignals('something else entirely');
		assert.deepStrictEqual(signals, ['general']);
	});
});

describe('LearningClassifier frustration integration', () => {
	const classifier = new LearningClassifier();

	it('classifies frustration as type=frustration', () => {
		const result = classifier.classifyConversation('I wish you could schedule meetings for me');
		assert.ok(result, 'should return a classification');
		assert.strictEqual(result.type, 'frustration');
		assert.strictEqual(result.key, 'frustration:missing-feature');
		assert.ok(result.payload.summary.includes('schedule meetings'));
		assert.ok(result.payload.signals.includes('wish'));
		assert.strictEqual(result.payload.confidence, 0.85);
	});

	it('does not classify pointer corrections as frustration', () => {
		const result = classifier.classifyConversation('click there on the screen', {
			recentToolExecutions: [{ name: 'click_at', success: false }],
			recentTurns: [],
		});
		assert.ok(result === null || result.type !== 'frustration', 'pointer corrections should not be frustration');
	});

	it('does not classify progress queries as frustration', () => {
		const result = classifier.classifyConversation('What are you doing right now');
		assert.ok(result);
		assert.strictEqual(result.type, 'memory', 'progress queries should be memory type');
	});
});
