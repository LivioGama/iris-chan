// All ipcMain handler registrations (thin dispatch layer)
import * as systemController from './controllers/systemController';
import * as toolController from './controllers/toolController';
import * as vocabularyController from './controllers/vocabularyController';
import * as searchController from './controllers/searchController';
import * as skillController from './controllers/skillController';
import * as convexController from './controllers/convexController';
import * as kanbanController from './controllers/kanbanController';
import * as taskQueueController from './controllers/taskQueueController';
import * as feedbackController from './controllers/feedbackController';

export function register(apiKey: string) {
	systemController.register(apiKey);
	toolController.register();
	vocabularyController.register();
	searchController.register();
	skillController.register();
	convexController.register();
	kanbanController.register();
	taskQueueController.register();
	feedbackController.register();
}
