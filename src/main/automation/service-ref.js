let uiTaskServiceRef = null;
let selfImprovementManagerRef = null;
let memoryStoreRef = null;
let learningManagerRef = null;
let nativeFallbackManagerRef = null;
let episodeRecorderRef = null;

function setUiTaskService(service) {
	uiTaskServiceRef = service || null;
}

function getUiTaskService() {
	return uiTaskServiceRef;
}

function setSelfImprovementManager(manager) {
	selfImprovementManagerRef = manager || null;
}

function getSelfImprovementManager() {
	return selfImprovementManagerRef;
}

function setMemoryStore(store) {
	memoryStoreRef = store || null;
}

function getMemoryStore() {
	return memoryStoreRef;
}

function setLearningManager(manager) {
	learningManagerRef = manager || null;
}

function getLearningManager() {
	return learningManagerRef;
}

function setNativeFallbackManager(manager) {
	nativeFallbackManagerRef = manager || null;
}

function getNativeFallbackManager() {
	return nativeFallbackManagerRef;
}

function setEpisodeRecorder(recorder) {
	episodeRecorderRef = recorder || null;
}

function getEpisodeRecorder() {
	return episodeRecorderRef;
}

module.exports = {
	setUiTaskService,
	getUiTaskService,
	setSelfImprovementManager,
	getSelfImprovementManager,
	setMemoryStore,
	getMemoryStore,
	setLearningManager,
	getLearningManager,
	setNativeFallbackManager,
	getNativeFallbackManager,
	setEpisodeRecorder,
	getEpisodeRecorder,
};
