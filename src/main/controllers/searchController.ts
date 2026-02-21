import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as searchWindow from '../windows/search-window';

export function register() {
    ipcMain.on(ch.SEARCH_SPINNER, (_, query: string) => searchWindow.show(query, null));
    ipcMain.on(ch.SEARCH_RESULT, (_, query: string, content: string) => searchWindow.show(query, content));
    ipcMain.on(ch.SEARCH_HIDE, () => searchWindow.hide());
}
