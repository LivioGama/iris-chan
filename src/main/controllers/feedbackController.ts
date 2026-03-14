import { ipcMain } from 'electron';
const { getFeedbackStore } = require('../automation/service-ref');

const FB_CHANNELS = {
	ADD: 'feedback:add',
	GET_ALL: 'feedback:get-all',
	GET_PENDING: 'feedback:get-pending',
	APPROVE: 'feedback:approve',
	DISMISS: 'feedback:dismiss',
	REMOVE: 'feedback:remove',
	CLEAR: 'feedback:clear',
	PENDING_COUNT: 'feedback:pending-count',
};

export function register() {
	ipcMain.handle(FB_CHANNELS.ADD, (_, text: string, metadata?: any) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		const item = store.addItem({ text, metadata });
		return { ok: true, item };
	});

	ipcMain.handle(FB_CHANNELS.GET_ALL, (_, filter?: any) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		return { ok: true, items: store.getItems(filter || {}) };
	});

	ipcMain.handle(FB_CHANNELS.GET_PENDING, () => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		return { ok: true, items: store.getItems({ status: 'pending' }) };
	});

	ipcMain.handle(FB_CHANNELS.APPROVE, (_, id: string) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		const item = store.approveItem(id);
		if (!item) return { ok: false, error: 'Item not found' };
		return { ok: true, item };
	});

	ipcMain.handle(FB_CHANNELS.DISMISS, (_, id: string) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		const item = store.dismissItem(id);
		if (!item) return { ok: false, error: 'Item not found' };
		return { ok: true, item };
	});

	ipcMain.handle(FB_CHANNELS.REMOVE, (_, id: string) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		const removed = store.removeItem(id);
		return { ok: removed };
	});

	ipcMain.handle(FB_CHANNELS.CLEAR, (_, filter?: any) => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		return store.clear(filter || {});
	});

	ipcMain.handle(FB_CHANNELS.PENDING_COUNT, () => {
		const store = getFeedbackStore();
		if (!store) return { ok: false, error: 'FeedbackStore not initialized' };
		return { ok: true, count: store.getPendingCount() };
	});
}

export { FB_CHANNELS };
