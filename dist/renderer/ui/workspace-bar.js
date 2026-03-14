"use strict";
// Workspace indicator — shows current working directory above debug bar
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshWorkspace = refreshWorkspace;
exports.updateIfWorkspaceTool = updateIfWorkspaceTool;
let el = null;
function getEl() {
    if (el)
        return el;
    el = document.getElementById('workspace-bar');
    return el;
}
async function refreshWorkspace() {
    try {
        const result = await window.electronAPI.executeTool('get_workspace', {});
        const dir = result?.result || '';
        const bar = getEl();
        if (!bar || !dir)
            return;
        // Show shortened path: ~/Desktop/project instead of the full home directory path
        const home = '/Users/' + dir.split('/')[2];
        const display = dir.startsWith(home) ? '~' + dir.slice(home.length) : dir;
        bar.textContent = '📂 ' + display;
        bar.classList.add('visible');
    }
    catch { }
}
function updateIfWorkspaceTool(toolName) {
    if (toolName === 'set_workspace') {
        setTimeout(refreshWorkspace, 100);
    }
}
