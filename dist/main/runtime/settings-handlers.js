"use strict";
const { avatarWindow } = require('../windows/avatar-window');
const settings = require('../settings');
const taskQueueWatcher = require('../task-queue/watcher');
/**
 * Registers application handlers for settings changes.
 * @param {object} params
 * @param {import('./behavior-mode').BehaviorModeState} params.behaviorEngine
 */
function registerSettingsHandlers({ behaviorEngine }) {
    settings.registerApplyHandler('avatar', (nextAvatar, previousAvatar) => {
        if (nextAvatar?.current === previousAvatar?.current)
            return { applied: true, liveApply: true };
        const win = require('../windows/avatar-window').get();
        if (win && !win.isDestroyed()) {
            win.reload();
        }
        return { applied: true, liveApply: true };
    });
    settings.registerApplyHandler('behavior', (nextBehavior, previousBehavior) => {
        const win = require('../windows/avatar-window').get();
        behaviorEngine.setState(nextBehavior);
        if (nextBehavior?.mode !== previousBehavior?.mode && win && !win.isDestroyed()) {
            win.webContents.send('mode-changed', nextBehavior.mode);
        }
        if (nextBehavior?.directMode !== previousBehavior?.directMode) {
            taskQueueWatcher.restartWithNewInterval();
            if (win && !win.isDestroyed())
                win.webContents.send('direct-mode-changed', nextBehavior.directMode);
        }
        if (win && !win.isDestroyed())
            win.webContents.send('behavior-state-changed', behaviorEngine.getState());
        return { applied: true, liveApply: true };
    });
    settings.registerApplyHandler('voice', (nextVoice, previousVoice) => {
        const modelVoiceChanged = nextVoice?.modelVoiceName !== previousVoice?.modelVoiceName;
        const speechProfileChanged = JSON.stringify(nextVoice?.speechProfile || {}) !== JSON.stringify(previousVoice?.speechProfile || {});
        return {
            applied: true,
            liveApply: true,
            restartRequired: false,
            sessionRefreshRequired: modelVoiceChanged,
            modelVoiceChanged,
            speechProfileChanged,
        };
    });
}
module.exports = { registerSettingsHandlers };
