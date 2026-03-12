const READY_STATUSES = new Set(['queued', 'resuming', 'blocked']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.replace(/[`"'.,:;!?()[\]{}]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function getTaskIdentifier(task = {}) {
	return String(task._id || task.id || '');
}

function getTaskTitle(task = {}) {
	return String(task.title || task.rawPrompt || '').split('\n')[0].trim();
}

function tokenize(text = '') {
	return normalizeText(text).split(' ').filter((token) => token.length >= 3);
}

function explicitDependencies(task = {}) {
	return Array.isArray(task.dependencies) ? task.dependencies.filter(Boolean) : [];
}

function referencedByPrompt(task, candidate) {
	const prompt = normalizeText(task.enrichedPrompt || task.rawPrompt || '');
	if (!prompt) return false;
	const candidateId = getTaskIdentifier(candidate).toLowerCase();
	if (candidateId && candidateId.length >= 4 && prompt.includes(candidateId)) return true;
	const candidateTitle = normalizeText(getTaskTitle(candidate));
	if (candidateTitle && candidateTitle.length >= 8 && prompt.includes(candidateTitle)) return true;
	const titleTokens = tokenize(getTaskTitle(candidate));
	return titleTokens.length >= 2 && titleTokens.every((token) => prompt.includes(token));
}

function overlapsImpactedFiles(task, candidate) {
	const current = new Set(Array.isArray(task.impactedFiles) ? task.impactedFiles : []);
	const prior = Array.isArray(candidate.impactedFiles) ? candidate.impactedFiles : [];
	if (!current.size || !prior.length) return false;
	return prior.some((file) => current.has(file));
}

function hasOrderingLanguage(task, candidate) {
	const prompt = normalizeText(task.enrichedPrompt || task.rawPrompt || '');
	if (!prompt) return false;
	const title = normalizeText(getTaskTitle(candidate));
	if (!title) return false;
	return [
		`after ${title}`,
		`once ${title}`,
		`follow up to ${title}`,
		`use the result of ${title}`,
		`depends on ${title}`,
		`then ${title}`,
	].some((phrase) => prompt.includes(phrase));
}

function inferDependencies(task, allTasks = []) {
	const currentId = getTaskIdentifier(task);
	const inferred = new Set();
	for (const candidate of allTasks) {
		const candidateId = getTaskIdentifier(candidate);
		if (!candidateId || candidateId === currentId) continue;
		if (Number(candidate.createdAt || 0) > Number(task.createdAt || 0)) continue;
		if (TERMINAL_STATUSES.has(String(candidate.status || '').toLowerCase()) && !referencedByPrompt(task, candidate) && !overlapsImpactedFiles(task, candidate)) {
			continue;
		}
		if (
			referencedByPrompt(task, candidate)
			|| overlapsImpactedFiles(task, candidate)
			|| hasOrderingLanguage(task, candidate)
		) {
			inferred.add(candidateId);
		}
	}
	return Array.from(inferred);
}

function unresolvedDependencies(task, taskMap) {
	const dependencies = new Set([
		...explicitDependencies(task),
		...(Array.isArray(task.inferredDependencies) ? task.inferredDependencies : []),
	]);
	const unresolved = [];
	for (const dependencyId of dependencies) {
		const dependency = taskMap.get(String(dependencyId));
		if (!dependency) continue;
		const status = String(dependency.status || '').toLowerCase();
		if (!TERMINAL_STATUSES.has(status) || status === 'failed' || status === 'cancelled') {
			if (status !== 'completed') unresolved.push(String(dependencyId));
		}
	}
	return unresolved;
}

function classifyDependencyState(task, taskMap) {
	const blockedBy = unresolvedDependencies(task, taskMap);
	return {
		blockedBy,
		dependencyState: blockedBy.length ? 'blocked' : 'ready',
	};
}

module.exports = {
	READY_STATUSES,
	TERMINAL_STATUSES,
	classifyDependencyState,
	explicitDependencies,
	getTaskIdentifier,
	inferDependencies,
};
