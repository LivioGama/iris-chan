// Thinking/activity display below avatar

let hideTimer = null;
const activityLog = [];
const MAX_LOG_LINES = 4;

export function showActivity(text) {
	const panel = document.getElementById('activity-panel');
	const content = document.getElementById('activity-content');
	if (!panel || !content) return;

	// Add to rolling log
	activityLog.push(text);
	if (activityLog.length > MAX_LOG_LINES) activityLog.shift();

	content.innerHTML = activityLog
		.map((line, i) => {
			const opacity = 0.4 + (i / activityLog.length) * 0.6;
			return `<div style="opacity:${opacity.toFixed(2)}">${escapeHtml(line)}</div>`;
		})
		.join('');

	panel.classList.add('visible');
	clearTimeout(hideTimer);
	hideTimer = setTimeout(() => {
		panel.classList.remove('visible');
		activityLog.length = 0;
	}, 8000);
}

export function hideActivity() {
	clearTimeout(hideTimer);
	document.getElementById('activity-panel')?.classList.remove('visible');
	activityLog.length = 0;
}

function escapeHtml(str) {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
