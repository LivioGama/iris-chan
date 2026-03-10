// Screen capture: periodic screenshots via Electron desktopCapturer
const { desktopCapturer, screen, systemPreferences } = require('electron');
const log = require('./logger');

// Latest image→screen mapping, updated every capture.
// Tools use this to convert Gemini's image-pixel coords → CGEvent logical coords.
// offsetX/offsetY = display origin in global screen space (non-zero on multi-monitor).
let _lastMapping = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
let _lastCaptureHealth = {
	lastCaptureAt: 0,
	lastError: 'No screen capture has succeeded yet.',
	permissionStatus: 'unknown',
};
let _lastLoggedError = '';
let _lastLoggedAt = 0;

function getMapping() { return _lastMapping; }
function getCaptureHealth() { return { ..._lastCaptureHealth }; }

function getScreenPermissionStatus() {
	if (process.platform !== 'darwin') return 'granted';
	try {
		return systemPreferences.getMediaAccessStatus('screen') || 'unknown';
	} catch {
		return 'unknown';
	}
}

function describeCaptureError(err) {
	if (!err) return 'Unknown screen capture error';
	if (err instanceof Error) return err.stack || err.message || String(err);
	if (typeof err === 'object') {
		try {
			return JSON.stringify(err);
		} catch {
			return String(err);
		}
	}
	return String(err);
}

function buildPermissionError(permissionStatus) {
	return `Screen capture unavailable. Screen Recording permission is ${permissionStatus}. Enable Screen Recording for Electron / Iris in System Settings > Privacy & Security > Screen Recording, then restart Iris.`;
}

function rememberCaptureFailure(error, permissionStatus) {
	_lastCaptureHealth = {
		..._lastCaptureHealth,
		lastError: error,
		permissionStatus,
	};

	const now = Date.now();
	if (error !== _lastLoggedError || now - _lastLoggedAt > 10000) {
		log.error('ScreenCapture', error);
		_lastLoggedError = error;
		_lastLoggedAt = now;
	}
}

async function capture() {
	const permissionStatus = getScreenPermissionStatus();
	try {
		const cursor = screen.getCursorScreenPoint();
		const cursorDisplay = screen.getDisplayNearestPoint(cursor);
		const display = cursorDisplay.bounds;
		const scaleFactor = cursorDisplay.scaleFactor;

		// Capture at fixed high resolution regardless of display
		// This ensures consistent coordinate mapping
		const sources = await desktopCapturer.getSources({
			types: ['screen'],
			thumbnailSize: { width: 2560, height: 1440 },
		});

		if (!sources.length) {
			const error = permissionStatus !== 'granted'
				? buildPermissionError(permissionStatus)
				: 'Screen capture returned no sources.';
			rememberCaptureFailure(error, permissionStatus);
			return { ok: false, data: null, error, permissionStatus };
		}

		const match = sources.find(s => String(s.display_id) === String(cursorDisplay.id));
		const source = match || sources[0];

		const thumbSize = source.thumbnail.getSize();
		const jpeg = source.thumbnail.toJPEG(40);
		const base64 = jpeg.toString('base64');

		// Update mapping: image pixels → logical screen points (CGEvent coords)
		// offsetX/offsetY = display origin for multi-monitor support.
		// The screenshot only covers THIS display, so image (0,0) = display origin.
		_lastMapping = {
			scaleX: display.width / thumbSize.width,
			scaleY: display.height / thumbSize.height,
			offsetX: display.x,
			offsetY: display.y,
		};

		// Cursor reported in GLOBAL SCREEN coordinates — convert to IMAGE coordinates for Gemini.
		// Subtract display origin first: cursor relative to this display's top-left.
		const cursorImgX = Math.round((cursor.x - display.x) / _lastMapping.scaleX);
		const cursorImgY = Math.round((cursor.y - display.y) / _lastMapping.scaleY);

		_lastCaptureHealth = {
			lastCaptureAt: Date.now(),
			lastError: null,
			permissionStatus,
		};
		_lastLoggedError = '';

		return {
			ok: true,
			data: base64,
			context: {
				imageWidth: thumbSize.width,
				imageHeight: thumbSize.height,
				displayWidth: Math.round(display.width),
				displayHeight: Math.round(display.height),
				scaleFactor,
				cursorX: cursorImgX,
				cursorY: cursorImgY,
			}
		};
	} catch (err) {
		const detail = describeCaptureError(err);
		const error = permissionStatus !== 'granted'
			? `${buildPermissionError(permissionStatus)} Underlying error: ${detail}`
			: detail;
		rememberCaptureFailure(error, permissionStatus);
		return { ok: false, data: null, error, permissionStatus };
	}
}

module.exports = { capture, getMapping, getCaptureHealth, getScreenPermissionStatus };
