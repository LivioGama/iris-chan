import { BrowserWindow, ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import config from '../../shared/config';
import * as log from '../logger';
import * as settings from '../settings';
import * as avatarWindow from '../windows/avatar-window';
import * as toolExecutor from '../tools';
import * as skills from '../skills';

export function register(apiKey: string) {
    const broadcastSettings = (nextSettings: unknown) => {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(ch.SETTINGS_CHANGED, nextSettings);
                // Compatibility shim for log-only listeners.
                const logging = (nextSettings as Record<string, unknown> | null)?.logging;
                if (logging) win.webContents.send(ch.LOG_SETTINGS_CHANGED, logging);
            }
        }
    };

    settings.init();
    settings.setSettingsBroadcaster(broadcastSettings);

    ipcMain.handle(ch.GET_API_KEY, () => apiKey);
    ipcMain.handle(ch.GET_VOICE_CONFIG, () => settings.getNamespace('voice'));
    ipcMain.handle(ch.GET_SETTINGS, () => settings.getSettings());
    ipcMain.handle(ch.UPDATE_SETTINGS, (_, patch: Record<string, unknown> | undefined, metadata: Record<string, unknown> | undefined) => settings.updateSettings(patch, metadata));
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
    ipcMain.handle('get-avatar-config', () => settings.getNamespace('avatar'));

    ipcMain.handle(ch.TOGGLE_AVATAR, () => {
        // Toggle between 'tripo3d' and 'original'
        const current = settings.getNamespace('avatar')?.current || config.avatar.current;
        const next = current === 'tripo3d' ? 'original' : 'tripo3d';
        log.info('Avatar', `Switched to ${next}`);
        settings.updateSettings({ avatar: { current: next } }, { source: 'toggle-avatar' });
        return next;
    });
}
