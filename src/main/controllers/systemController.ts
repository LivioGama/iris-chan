import { BrowserWindow, ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import config from '../../shared/config';
import * as log from '../logger';
import * as avatarWindow from '../windows/avatar-window';
import * as toolExecutor from '../tools';
import * as skills from '../skills';

export function register(apiKey: string) {
    const broadcastLogSettings = (settings: unknown) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(ch.LOG_SETTINGS_CHANGED, settings);
        }
    };

    log.setSettingsBroadcaster(broadcastLogSettings);

    ipcMain.handle(ch.GET_API_KEY, () => apiKey);
    ipcMain.handle(ch.GET_VOICE_CONFIG, () => config.voice);
    ipcMain.handle(ch.GET_LOG_SETTINGS, () => log.getSettings());
    ipcMain.handle(ch.UPDATE_LOG_SETTINGS, (_, patch: Record<string, unknown> | undefined) => log.updateSettings(patch));

    ipcMain.on(ch.SET_IGNORE_MOUSE, (_, ignore: boolean) => {
        const win = avatarWindow.get();
        if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
    });

    // Renderer log forwarding
    ipcMain.on(ch.LOG_TO_FILE, (_, level: string, tag: string, message: string) => {
        log.logFromRenderer(level, tag, message);
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
