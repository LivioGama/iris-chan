"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
const electron_1 = require("electron");
const ch = __importStar(require("../../shared/channels"));
const config_1 = __importDefault(require("../../shared/config"));
const log = __importStar(require("../logger"));
const settings = __importStar(require("../settings"));
const avatarWindow = __importStar(require("../windows/avatar-window"));
const toolExecutor = __importStar(require("../tools"));
const skills = __importStar(require("../skills"));
function register(apiKey) {
    const broadcastSettings = (nextSettings) => {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(ch.SETTINGS_CHANGED, nextSettings);
                // Compatibility shim for log-only listeners.
                const logging = nextSettings?.logging;
                if (logging)
                    win.webContents.send(ch.LOG_SETTINGS_CHANGED, logging);
            }
        }
    };
    settings.init();
    settings.setSettingsBroadcaster(broadcastSettings);
    electron_1.ipcMain.handle(ch.GET_API_KEY, () => apiKey);
    electron_1.ipcMain.handle(ch.GET_VOICE_CONFIG, () => settings.getNamespace('voice'));
    electron_1.ipcMain.handle(ch.GET_SETTINGS, () => settings.getSettings());
    electron_1.ipcMain.handle(ch.UPDATE_SETTINGS, (_, patch, metadata) => settings.updateSettings(patch, metadata));
    electron_1.ipcMain.handle(ch.GET_LOG_SETTINGS, () => log.getSettings());
    electron_1.ipcMain.handle(ch.UPDATE_LOG_SETTINGS, (_, patch) => log.updateSettings(patch));
    electron_1.ipcMain.on(ch.SET_IGNORE_MOUSE, (_, ignore) => {
        const win = avatarWindow.get();
        if (win)
            win.setIgnoreMouseEvents(ignore, { forward: true });
    });
    // Renderer log forwarding
    electron_1.ipcMain.on(ch.LOG_TO_FILE, (_, level, tag, message) => {
        log.logFromRenderer(level, tag, message);
    });
    electron_1.ipcMain.handle(ch.RELOAD_SESSION, () => {
        toolExecutor.reload();
        skills.scan();
        const win = avatarWindow.get();
        if (win)
            win.webContents.send(ch.RELOAD_SESSION);
        return { ok: true };
    });
    // Avatar configuration
    electron_1.ipcMain.handle('get-avatar-config', () => settings.getNamespace('avatar'));
    electron_1.ipcMain.handle(ch.TOGGLE_AVATAR, () => {
        // Toggle between 'tripo3d' and 'original'
        const current = settings.getNamespace('avatar')?.current || config_1.default.avatar.current;
        const next = current === 'tripo3d' ? 'original' : 'tripo3d';
        log.info('Avatar', `Switched to ${next}`);
        settings.updateSettings({ avatar: { current: next } }, { source: 'toggle-avatar' });
        return next;
    });
}
