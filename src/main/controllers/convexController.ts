import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as convexStore from '../convex-store';

export function register() {
    ipcMain.on(ch.NEW_CONVEX_SESSION, () => {
        convexStore.newSession();
    });

    ipcMain.on(ch.END_CONVEX_SESSION, () => {
        convexStore.endSession();
    });

    ipcMain.on(ch.SAVE_CONVERSATION_TURN, (_, role: string, text: string) => {
        convexStore.saveTurn(role, text);
    });

    ipcMain.handle(ch.SEMANTIC_SEARCH, (_, query: string, limit: number, roleFilter: string) => {
        return convexStore.semanticSearch(query, limit, roleFilter as any);
    });
}
