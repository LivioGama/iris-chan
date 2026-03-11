const log = require('../logger');
const { startCodingTask } = require('../coding/runner');

async function executeTask(taskId, prompt, projectPath, onLog) {
	log.info('TaskQueue', `Starting execution for ${taskId} in ${projectPath}`);
	const handle = startCodingTask({
		taskId,
		prompt,
		cwd: projectPath,
		onLog: (line) => {
			if (onLog) onLog(line);
		},
	});
	return handle.completion;
}

module.exports = { executeTask };
