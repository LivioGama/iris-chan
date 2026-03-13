import { error as logError } from '../logger.js';

const PASSIVE_CAPTURE_INTERVAL_MS = 10000;
const ACTIVE_CAPTURE_COOLDOWN_MS = 1500;

export function createScreenCaptureController({ gemini, onCapture = null }) {
	let interval = null;
	let lastUserSpeechTime = Date.now();
	let idleGateClosed = false;
	let autonomousMode = false;
	let lastCaptureAt = 0;
	let inFlightCapture = null;
	let lastCaptureId = '';
	let lastInteractiveCaptureId = '';
	let latestCapture = null;
	const captureListeners = new Set();

	if (typeof onCapture === 'function') {
		captureListeners.add(onCapture);
	}

	const sendFrame = async ({ passive = false, force = false } = {}) => {
		const now = Date.now();
		if (inFlightCapture) return inFlightCapture;
		if (!force && now - lastCaptureAt < ACTIVE_CAPTURE_COOLDOWN_MS) {
			return Promise.resolve(null);
		}

		inFlightCapture = (async () => {
			lastCaptureAt = Date.now();
			try {
				const capture = await window.electronAPI.captureScreen();
				if (capture?.ok && capture.data) {
					latestCapture = { ...capture, capturedAt: Date.now(), passive };
					if (capture.context?.captureId) {
						lastCaptureId = capture.context.captureId;
						if (!passive) lastInteractiveCaptureId = capture.context.captureId;
					}
					if (!passive && capture.context) {
						const ctx = capture.context;
						gemini.sendRealtimeText(
							`[SCREEN CONTEXT] Capture ID: ${ctx.captureId}. Captured: ${ctx.capturedAtIso || 'unknown'}. Image: ${ctx.imageWidth}x${ctx.imageHeight}px, Display: ${ctx.displayWidth}x${ctx.displayHeight}, Scale: ${ctx.scaleFactor}x, Display ID: ${ctx.displayId}, Cursor(image): (${ctx.cursorX}, ${ctx.cursorY}), Cursor(screen): (${ctx.cursorScreenX}, ${ctx.cursorScreenY}). IMPORTANT: Use the IMAGE pixel coordinates (from ${ctx.imageWidth}x${ctx.imageHeight} image) directly for mouse_move, click_at, double_click, and drag, and pass capture_id="${ctx.captureId}" with those pointer tools. Never reuse coordinates across different captures.`
						);
					}
					gemini.sendImage(capture.data);
					for (const listener of captureListeners) {
						try {
							listener(latestCapture);
						} catch (err) {
							logError('Screen', 'Capture listener error:', err);
						}
					}
				}
				return capture;
			} catch (err) {
				logError('Screen', 'Capture error:', err);
				return null;
			} finally {
				inFlightCapture = null;
			}
		})();

		return inFlightCapture;
	};

	const start = () => {
		stop();
		sendFrame({ passive: false, force: true });
		interval = setInterval(() => {
			if (idleGateClosed) return;
			if (!autonomousMode && Date.now() - lastUserSpeechTime > 60000) {
				stop();
				return;
			}
			sendFrame({ passive: true, force: true });
		}, PASSIVE_CAPTURE_INTERVAL_MS);
	};

	const stop = () => {
		if (interval) {
			clearInterval(interval);
			interval = null;
		}
	};

	return {
		start,
		stop,
		capture: (options = {}) => {
			if (typeof options === 'boolean') {
				return sendFrame({ passive: options });
			}
			return sendFrame(options);
		},
		get isRunning() { return interval !== null; },
		get lastCaptureAt() { return lastCaptureAt; },
		get lastCaptureId() { return lastCaptureId; },
		get lastInteractiveCaptureId() { return lastInteractiveCaptureId || lastCaptureId; },
		get latestCapture() { return latestCapture; },
		onCapture(listener) {
			if (typeof listener !== 'function') return () => {};
			captureListeners.add(listener);
			return () => captureListeners.delete(listener);
		},
		setLastUserSpeechTime(t) { lastUserSpeechTime = t; },
		setIdleGateClosed(closed) { idleGateClosed = closed; },
		setAutonomousMode(mode) { autonomousMode = mode; },
	};
}
