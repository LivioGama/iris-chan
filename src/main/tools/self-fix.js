async function self_fix(args) {
	const fixProject = require('./fix-project');
	return fixProject.fix_project({
		description: args.description || '',
		target: 'iris',
	});
}

module.exports = { self_fix };
