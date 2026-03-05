// Screen capture: periodic screenshots via Electron desktopCapturer
const { desktopCapturer, screen, BrowserWindow } = require('electron');
const log = require('./logger');

// Latest image→screen mapping, updated every capture.
// Tools use this to convert Gemini's image-pixel coords → CGEvent logical coords.
// offsetX/offsetY = display origin in global screen space (non-zero on multi-monitor).
let _lastMapping = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

function getMapping() { return _lastMapping; }

async function capture() {
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
			return { ok: false, data: null };
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
		log.error('ScreenCapture', err.message);
		return { ok: false, data: null };
	}
}

module.exports = { capture, getMapping };
