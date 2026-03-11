const { normalizeText } = require('./memory-store');

function containsAny(text, patterns) {
	const normalized = normalizeText(text);
	return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
}

class LearningClassifier {
	classifyConversation(text = '', context = {}) {
		const normalized = normalizeText(text);
		if (!normalized) return null;
		if (containsAny(normalized, ['default browser', 'default mail', 'default app'])) {
			return {
				type: 'memory',
				key: 'policy.default_app_resolution',
				reason: 'default-app guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.default_app_resolution',
					value: {
						preferNativeMacOS: true,
						message: 'Prefer native macOS system-resolution before random app guesses for default-app requests.',
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (containsAny(normalized, ['check system settings', 'native macos', 'do not ask me this again', "don't ask me this again"])) {
			return {
				type: 'memory',
				key: 'policy.native_resolution_before_guess',
				reason: 'fallback preference guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'user',
					key: 'policy.native_resolution_before_guess',
					value: { enabled: true, message: text.trim() },
					source: 'user_correction',
					confidence: 0.92,
					evidence: text,
				},
			};
		}
		return {
			type: 'core-gap',
			key: `issue:${normalized}`,
			reason: 'generic user correction',
			payload: {
				issueSignature: `issue:${normalized}`,
				description: `User correction suggests a structural gap: ${text.trim()}`,
				evidence: text,
			},
		};
	}

	classifyRecovery({ failedTools = [], successfulTools = [], latestUserText = '' } = {}) {
		if (!failedTools.length || !successfulTools.length) return null;
		const failedNames = failedTools.map((item) => item.name).filter(Boolean);
		const successNames = successfulTools.map((item) => item.name).filter(Boolean);
		const userText = normalizeText(latestUserText);

		if (containsAny(userText, ['default browser']) && successNames.includes('open_app')) {
			return {
				type: 'memory',
				key: 'environment.default_browser',
				reason: 'resolved default browser after correction',
			};
		}

		const pointerHeavy = successfulTools.some((item) => ['click_at', 'double_click', 'mouse_move', 'drag'].includes(item.name));
		if (pointerHeavy) {
			return {
				type: 'stabilization_candidate',
				key: `stabilize:${userText}`,
				reason: 'pointer-based recovery needs stabilization',
				payload: {
					issueSignature: `stabilize:${userText}`,
					description: `Pointer-based recovery should be converted into a semantic/native strategy: ${latestUserText}`,
					evidence: latestUserText,
				},
			};
		}

		if (!successNames.includes('run_ui_task') && successfulTools.length >= 1 && latestUserText) {
			return {
				type: 'skill',
				key: `skill:${successNames.join(',')}:${userText}`,
				reason: 'recovered via reusable tool sequence',
			};
		}

		if (failedNames.some((name) => name === 'run_ui_task') && successNames.some((name) => name === 'open_app')) {
			return {
				type: 'core-gap',
				key: `recovery:${failedNames.join(',')}->${successNames.join(',')}`,
				reason: 'cross-tool recovery indicates missing planner/tooling capability',
				payload: {
					issueSignature: `recovery:${failedNames.join(',')}->${successNames.join(',')}:${userText}`,
					description: `Recovered from ${failedNames.join(', ')} to ${successNames.join(', ')} after user guidance: ${latestUserText}`,
					evidence: latestUserText,
				},
			};
		}

		return null;
	}
}

module.exports = {
	LearningClassifier,
};
