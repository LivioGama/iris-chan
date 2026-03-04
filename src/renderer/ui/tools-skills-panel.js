const recent = new Map();
const panelState = { tools: [], skills: [], active: null };

function rank(items = []) {
	return [...items].sort((a, b) => (recent.get(b) || 0) - (recent.get(a) || 0));
}

export function markUsed(name) {
	recent.set(name, Date.now());
}

export function renderToolsSkillsPanel({ tools = [], skills = [], active = null }) {
	const root = document.getElementById('tools-skills-panel');
	if (!root) return;
	panelState.tools = [...tools];
	panelState.skills = [...skills];
	panelState.active = active;
	const toolsColumn = root.querySelector('.panel-tools');
	const skillsColumn = root.querySelector('.panel-skills');
	if (!toolsColumn || !skillsColumn) return;

	toolsColumn.innerHTML = '';
	skillsColumn.innerHTML = '';

	for (const name of rank(tools)) {
		const el = buildRow(name, active);
		toolsColumn.appendChild(el);
	}
	for (const name of rank(skills)) {
		const el = buildRow(name, active);
		skillsColumn.appendChild(el);
	}
}

export function setActiveItem(name = null) {
	panelState.active = name;
	if (name) markUsed(name);

	const root = document.getElementById('tools-skills-panel');
	if (!root) return;

	const prev = root.querySelector('.panel-item.active');
	if (prev) prev.classList.remove('active');

	if (name) {
		const next = root.querySelector(`.panel-item[data-name="${CSS.escape(name)}"]`);
		if (next) next.classList.add('active');
	}
}

export function anchorPanelToAvatar(bounds) {
	const root = document.getElementById('tools-skills-panel');
	if (!root || !bounds) return;
	root.style.left = `${Math.max(8, bounds.right + 12)}px`;
	root.style.top = `${Math.max(8, bounds.top)}px`;
}

export function showPanel() {
	const root = document.getElementById('tools-skills-panel');
	if (root) root.style.display = '';
}

export function hidePanel() {
	const root = document.getElementById('tools-skills-panel');
	if (root) root.style.display = 'none';
}

function buildRow(name, active) {
	const el = document.createElement('div');
	el.className = active === name ? 'panel-item active' : 'panel-item';
	el.dataset.name = name;
	el.title = name;
	el.textContent = name;
	return el;
}
