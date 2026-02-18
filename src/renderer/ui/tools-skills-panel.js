// Tools & Skills panel: two-column list of available tools and installed skills

let loaded = false;

export async function loadToolsAndSkills() {
	if (loaded) return;
	loaded = true;

	const toolsList = document.getElementById('ts-tools-list');
	const skillsList = document.getElementById('ts-skills-list');
	if (!toolsList || !skillsList) return;

	// Populate tools from tool-declarations
	try {
		const { toolDeclarations } = await import('../gemini/tool-declarations.js');
		for (const decl of toolDeclarations) {
			const el = document.createElement('div');
			el.className = 'ts-item';
			el.textContent = decl.name;
			el.title = decl.description || '';
			toolsList.appendChild(el);
		}
	} catch {}

	// Populate skills from electronAPI
	try {
		const catalog = await window.electronAPI.getSkillCatalog();
		for (const skill of catalog || []) {
			const el = document.createElement('div');
			el.className = 'ts-item';
			el.textContent = skill.name;
			el.title = skill.description || '';
			skillsList.appendChild(el);
		}
	} catch {}
}

export function showPanel() {
	loadToolsAndSkills();
	document.getElementById('tools-skills-panel')?.classList.add('visible');
}

export function hidePanel() {
	document.getElementById('tools-skills-panel')?.classList.remove('visible');
}

export function togglePanel() {
	const panel = document.getElementById('tools-skills-panel');
	if (!panel) return;
	if (panel.classList.contains('visible')) {
		hidePanel();
	} else {
		showPanel();
	}
}
