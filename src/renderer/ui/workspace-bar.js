// Workspace indicator — shows current working directory above debug bar

let el = null;

function getEl() {
	if (el) return el;
	el = document.getElementById('workspace-bar');
	return el;
}

export async function refreshWorkspace() {
	try {
		const result = await window.electronAPI.executeTool('get_workspace', {});
		const dir = result?.result || '';
		const bar = getEl();
		if (!bar || !dir) return;
		// Show shortened path: ~/Desktop/project instead of /Users/livio/Desktop/project
		const home = '/Users/' + dir.split('/')[2];
		const display = dir.startsWith(home) ? '~' + dir.slice(home.length) : dir;
		bar.textContent = '📂 ' + display;
		bar.classList.add('visible');
	} catch {}
}

export function updateIfWorkspaceTool(toolName) {
	if (toolName === 'set_workspace') {
		setTimeout(refreshWorkspace, 100);
	}
}
