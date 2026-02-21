import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as vocabStore from '../vocab/store';

export function register() {
    ipcMain.on(ch.TRACK_VOCABULARY, (_, terms: string[]) => vocabStore.trackTerms(terms));
    ipcMain.handle(ch.GET_VOCABULARY, () => vocabStore.loadTerms());
    ipcMain.handle(ch.GET_HOT_VOCABULARY, () => Object.keys(vocabStore.loadHot()));
    ipcMain.handle(ch.GET_VOCABULARY_STATS, () => vocabStore.loadStats());
    ipcMain.handle(ch.GET_VOCABULARY_CORRECTIONS, () => vocabStore.loadCorrections());
    ipcMain.handle(ch.GET_VOCABULARY_CORE, () => vocabStore.loadCore());
    ipcMain.on(ch.ADD_CORRECTION, (_, wrong: string, right: string) => vocabStore.addCorrection(wrong, right));
}
