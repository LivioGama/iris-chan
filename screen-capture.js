// Screen capture: periodic screenshots via Electron desktopCapturer
const { desktopCapturer, screen } = require('electron');

async function capture() {
	try {
		const sources = await desktopCapturer.getSources({
			types: ['screen'],
			thumbnailSize: { width: 800, height: 500 },
		});

		if (!sources.length) {
			return { ok: false, data: null };
		}

		const cursor = screen.getCursorScreenPoint();
		const cursorDisplay = screen.getDisplayNearestPoint(cursor);

		// desktopCapturer source.display_id matches display.id as a string
		const match = sources.find(s => String(s.display_id) === String(cursorDisplay.id));
		const source = match || sources[0];

		const jpeg = source.thumbnail.toJPEG(25);
		const base64 = jpeg.toString('base64');

		return { ok: true, data: base64 };
	} catch (err) {
		console.error('[ScreenCapture] Error:', err.message);
		return { ok: false, data: null };
	}
}

module.exports = { capture };
