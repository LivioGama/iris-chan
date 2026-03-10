let uiTaskServiceRef = null;

function setUiTaskService(service) {
	uiTaskServiceRef = service || null;
}

function getUiTaskService() {
	return uiTaskServiceRef;
}

module.exports = {
	setUiTaskService,
	getUiTaskService,
};
