"use strict";
function emitCodingStream(type, data) {
    const payload = { type, ...data };
    try {
        const avatarWindow = require('../windows/avatar-window');
        const win = avatarWindow.get();
        if (win)
            win.webContents.send('claude-code-stream', payload);
    }
    catch { }
    try {
        const kanbanWindow = require('../windows/kanban-window');
        const kWin = kanbanWindow.get();
        if (kWin)
            kWin.webContents.send('claude-code-stream', payload);
    }
    catch { }
}
module.exports = { emitCodingStream };
