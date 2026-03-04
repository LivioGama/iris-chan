export function buildSelfFixDescription(input = {}) {
	const files = Array.isArray(input.files) ? input.files : [];
	return [
		`PROBLEM: ${input.problem || 'Not provided'}`,
		`DESIRED BEHAVIOR: ${input.desiredBehavior || 'Not provided'}`,
		`FILES: ${files.length ? files.join(', ') : 'Not provided'}`,
		`IMPLEMENTATION: ${input.implementation || 'Not provided'}`,
		`CONTEXT: ${input.context || 'Not provided'}`,
		`VERIFICATION: ${input.verification || 'Add tests and visual validation.'}`,
	].join(' ');
}
