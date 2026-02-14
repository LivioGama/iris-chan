// Debug indicators + status text

export function updateIndicator(id, active) {
	const el = document.getElementById(`dbg-${id}`);
	if (el) el.classList.toggle('active', active);
}

export function updateStatus(text) {
	const el = document.getElementById('dbg-status');
	if (el) el.textContent = text;
}
