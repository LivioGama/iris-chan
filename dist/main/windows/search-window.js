"use strict";
// Search overlay window management
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const config = require('../../shared/config').default;
let searchWin = null;
let searchHideTimeout = null;
function show(query, content) {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { width: dw, height: dh } = display.workAreaSize;
    const { x: dx, y: dy } = display.workArea;
    const ow = Math.min(650, dw - 80);
    const oh = Math.min(520, dh - 80);
    let wx = cursor.x + 16;
    let wy = cursor.y + 16;
    if (wx + ow > dx + dw)
        wx = cursor.x - ow - 16;
    if (wy + oh > dy + dh)
        wy = cursor.y - oh - 16;
    wx = Math.max(dx, wx);
    wy = Math.max(dy, wy);
    if (!searchWin || searchWin.isDestroyed()) {
        searchWin = new BrowserWindow({
            width: ow,
            height: oh,
            x: wx,
            y: wy,
            transparent: true,
            frame: false,
            hasShadow: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            resizable: false,
            focusable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        searchWin.loadFile(path.join(__dirname, '..', '..', 'renderer', 'search-overlay', 'index.html'));
        searchWin.webContents.on('did-finish-load', () => {
            if (content !== null) {
                searchWin.webContents.send('search-result', query, content);
            }
            else {
                searchWin.webContents.send('search-spinner', query);
            }
        });
    }
    else {
        searchWin.setBounds({ x: wx, y: wy, width: ow, height: oh });
        searchWin.show();
        if (content !== null) {
            searchWin.webContents.send('search-result', query, content);
        }
        else {
            searchWin.webContents.send('search-spinner', query);
        }
    }
    clearTimeout(searchHideTimeout);
    if (content !== null) {
        // Scale auto-hide based on content length — long research reports need more reading time
        const baseMs = config.search.autoHideMs;
        const ms = content.length > 2000 ? baseMs * 4 : baseMs;
        searchHideTimeout = setTimeout(() => hide(), ms);
    }
}
function hide() {
    clearTimeout(searchHideTimeout);
    if (searchWin && !searchWin.isDestroyed()) {
        searchWin.webContents.send('search-hide');
        setTimeout(() => {
            if (searchWin && !searchWin.isDestroyed())
                searchWin.hide();
        }, 350);
    }
}
module.exports = { show, hide };
