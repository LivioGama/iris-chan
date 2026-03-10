const MAX_CAPTURE_AGE_MS = 5000;

function isCaptureUsable(health, now = Date.now()) {
	if (!health || health.lastError) return false;
	if (!health.lastCaptureAt) return false;
	return now - health.lastCaptureAt <= MAX_CAPTURE_AGE_MS;
}

function formatCaptureBlockReason(actionLabel, health, now = Date.now()) {
	const action = actionLabel || 'interact with the screen';
	const ageMs = health?.lastCaptureAt ? now - health.lastCaptureAt : null;
	const ageText = ageMs != null ? ` Last successful screen frame was ${Math.round(ageMs / 1000)}s ago.` : '';
	const permissionText = health?.permissionStatus && health.permissionStatus !== 'unknown'
		? ` Screen Recording permission: ${health.permissionStatus}.`
		: '';
	const detail = health?.lastError || 'No recent screen frame is available.';
	return `Cannot ${action} without a fresh screen capture. ${detail}${permissionText}${ageText}`.trim();
}

module.exports = {
	MAX_CAPTURE_AGE_MS,
	isCaptureUsable,
	formatCaptureBlockReason,
};
