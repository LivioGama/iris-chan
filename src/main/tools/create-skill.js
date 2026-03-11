const { getSelfImprovementManager } = require('../automation/service-ref');

async function create_skill(args) {
	const manager = getSelfImprovementManager();
	if (!manager) return { ok: false, result: 'Self-improvement manager is not available' };
	return manager.createSkill(args || {});
}

module.exports = {
	create_skill,
};
