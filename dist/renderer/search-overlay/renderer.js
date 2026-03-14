"use strict";
// Search overlay IPC + markdown rendering
const { ipcRenderer } = require('electron');
const container = document.getElementById('container');
const queryEl = document.getElementById('query');
const contentEl = document.getElementById('content');
const spinner = document.getElementById('spinner');
function renderMarkdown(text) {
    try {
        return marked.parse(text || '', { breaks: true });
    }
    catch {
        return text.replace(/</g, '&lt;').replace(/\n/g, '<br>');
    }
}
requestAnimationFrame(() => {
    requestAnimationFrame(() => {
        container.classList.add('visible');
    });
});
ipcRenderer.on('search-spinner', (_, query) => {
    queryEl.textContent = query;
    contentEl.innerHTML = '';
    spinner.classList.add('active');
});
ipcRenderer.on('search-result', (_, query, content) => {
    queryEl.textContent = query;
    contentEl.innerHTML = renderMarkdown(content);
    spinner.classList.remove('active');
    contentEl.scrollTop = 0;
});
ipcRenderer.on('search-hide', () => {
    container.classList.remove('visible');
});
function dismiss() {
    ipcRenderer.send('search-hide');
}
document.getElementById('close-btn').addEventListener('click', dismiss);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape')
        dismiss();
});
