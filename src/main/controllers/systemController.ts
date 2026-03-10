import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import config from '../../shared/config';
import * as log from '../logger';
import * as avatarWindow from '../windows/avatar-window';
import * as toolExecutor from '../tools';
import * as skills from '../skills';

export function register(apiKey: string) {
    ipcMain.handle(ch.GET_API_KEY, () => apiKey);
    ipcMain.handle(ch.GET_VOICE_CONFIG, () => config.voice);

    ipcMain.on(ch.SET_IGNORE_MOUSE, (_, ignore: boolean) => {
        const win = avatarWindow.get();
        if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
    });

    // Renderer log forwarding
    ipcMain.on(ch.LOG_TO_FILE, (_, level: string, tag: string, message: string) => {
        if (level === 'error') log.error(tag, message);
        else if (level === 'warn') log.warn(tag, message);
        else log.info(tag, message);
    });

    ipcMain.handle(ch.RELOAD_SESSION, () => {
        toolExecutor.reload();
        skills.scan();
        const win = avatarWindow.get();
        if (win) win.webContents.send(ch.RELOAD_SESSION);
        return { ok: true };
    });

    // Avatar configuration
    ipcMain.handle('get-avatar-config', () => config.avatar);

    ipcMain.handle(ch.TOGGLE_AVATAR, () => {
        // Toggle between 'tripo3d' and 'original'
        const current = config.avatar.current;
        config.avatar.current = current === 'tripo3d' ? 'original' : 'tripo3d';
        log.info('Avatar', `Switched to ${config.avatar.current}`);

        // Reload the avatar window
        const win = avatarWindow.get();
        if (win) {
            win.reload();
        }

        return config.avatar.current;
    });
}
