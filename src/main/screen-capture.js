// Screen capture: periodic screenshots via Electron desktopCapturer
const { desktopCapturer, nativeImage, screen, systemPreferences } = require('electron');
const log = require('./logger');

// Latest image→screen mapping, updated every capture.
// Tools use this to convert Gemini's image-pixel coords → CGEvent logical coords.
// offsetX/offsetY = display origin in global screen space (non-zero on multi-monitor).
let _lastMapping = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
const MAX_CAPTURE_HISTORY = 24;
const _captureMappings = new Map();
let _latestCaptureId = '';
let _lastCaptureHealth = {
	lastCaptureAt: 0,
	lastError: 'No screen capture has succeeded yet.',
	permissionStatus: 'unknown',
};
let _lastLoggedError = '';
let _lastLoggedAt = 0;

function clampCaptureDimension(value) {
	const rounded = Math.round(Number(value) || 0);
	return Math.max(1, rounded);
}

function normalizeCaptureImage(thumbnail, targetSize) {
	const width = clampCaptureDimension(targetSize?.width);
	const height = clampCaptureDimension(targetSize?.height);
	let normalized = thumbnail;

	// Collapse multi-scale Retina reps into a stable 1x image so the model sees
	// the same coordinate space that Quartz mouse events use.
	try {
		const oneX = thumbnail.toPNG({ scaleFactor: 1 });
		if (oneX?.length) {
			const decoded = nativeImage.createFromBuffer(oneX);
			if (decoded && !decoded.isEmpty()) {
				normalized = decoded;
			}
		}
	} catch {}

	const currentSize = normalized.getSize();
	if (currentSize.width !== width || currentSize.height !== height) {
		normalized = normalized.resize({ width, height, quality: 'best' });
	}

	const finalSize = normalized.getSize();
	return {
		jpeg: normalized.toJPEG(40),
		width: clampCaptureDimension(finalSize.width),
		height: clampCaptureDimension(finalSize.height),
	};
}

function createCaptureId() {
	return `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rememberCaptureMapping(mapping) {
	_captureMappings.set(mapping.captureId, mapping);
	_latestCaptureId = mapping.captureId;
	_lastMapping = mapping;
	while (_captureMappings.size > MAX_CAPTURE_HISTORY) {
		const oldestKey = _captureMappings.keys().next().value;
		if (!oldestKey) break;
		_captureMappings.delete(oldestKey);
	}
}

function getMapping(captureId = '') {
	if (captureId) {
		return _captureMappings.get(captureId) || null;
	}
	return _lastMapping;
}

function getLatestCaptureId() {
	return _latestCaptureId;
}

function getCaptureHealth(captureId = '') {
	if (!captureId) return { ..._lastCaptureHealth };
	const mapping = _captureMappings.get(captureId);
	if (!mapping) {
		return {
			lastCaptureAt: 0,
			lastError: `Unknown capture_id "${captureId}"`,
			permissionStatus: _lastCaptureHealth.permissionStatus || 'unknown',
			captureId,
		};
	}
	return {
		lastCaptureAt: mapping.capturedAt,
		lastError: null,
		permissionStatus: mapping.permissionStatus || 'unknown',
		captureId,
	};
}

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
		const captureWidth = clampCaptureDimension(display.width);
		const captureHeight = clampCaptureDimension(display.height);

		// Capture in logical display units so screenshot pixels and Quartz event
		// coordinates stay aligned.
		const sources = await desktopCapturer.getSources({
			types: ['screen'],
			thumbnailSize: { width: captureWidth, height: captureHeight },
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
		const normalized = normalizeCaptureImage(source.thumbnail, { width: captureWidth, height: captureHeight });
		const thumbSize = { width: normalized.width, height: normalized.height };
		const jpeg = normalized.jpeg;
		const base64 = jpeg.toString('base64');
		const capturedAt = Date.now();
		const captureId = createCaptureId();

		// Update mapping: image pixels → logical screen points (CGEvent coords)
		// offsetX/offsetY = display origin for multi-monitor support.
		// The screenshot only covers THIS display, so image (0,0) = display origin.
		rememberCaptureMapping({
			captureId,
			capturedAt,
			scaleX: display.width / thumbSize.width,
			scaleY: display.height / thumbSize.height,
			offsetX: display.x,
			offsetY: display.y,
			permissionStatus,
		});

		// Cursor reported in GLOBAL SCREEN coordinates — convert to IMAGE coordinates for Gemini.
		// Subtract display origin first: cursor relative to this display's top-left.
		const cursorImgX = Math.round((cursor.x - display.x) / _lastMapping.scaleX);
		const cursorImgY = Math.round((cursor.y - display.y) / _lastMapping.scaleY);

		_lastCaptureHealth = {
			lastCaptureAt: capturedAt,
			lastError: null,
			permissionStatus,
			captureId,
		};
		_lastLoggedError = '';

		return {
			ok: true,
			data: base64,
			context: {
				captureId,
				imageWidth: thumbSize.width,
				imageHeight: thumbSize.height,
				displayWidth: captureWidth,
				displayHeight: captureHeight,
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

module.exports = { capture, getMapping, getCaptureHealth, getLatestCaptureId, getScreenPermissionStatus };
