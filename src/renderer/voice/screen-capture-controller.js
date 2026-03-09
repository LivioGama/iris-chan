import { error as logError } from '../logger.js';

const PASSIVE_CAPTURE_INTERVAL_MS = 10000;
const ACTIVE_CAPTURE_COOLDOWN_MS = 1500;

export function createScreenCaptureController({ gemini }) {
	let interval = null;
	let lastUserSpeechTime = Date.now();
	let idleGateClosed = false;
	let autonomousMode = false;
	let lastCaptureAt = 0;
	let inFlightCapture = null;

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
					if (!passive && capture.context) {
						const ctx = capture.context;
						gemini.sendRealtimeText(
							`[SCREEN CONTEXT] Image: ${ctx.imageWidth}x${ctx.imageHeight}px, Display: ${ctx.displayWidth}x${ctx.displayHeight}, Scale: ${ctx.scaleFactor}x, Cursor: (${ctx.cursorX}, ${ctx.cursorY}). IMPORTANT: Use the IMAGE pixel coordinates (from ${ctx.imageWidth}x${ctx.imageHeight} image) directly for mouse_move, click_at, and drag. The image shows exactly what is at each pixel location.`
						);
					}
					gemini.sendImage(capture.data);
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
		setLastUserSpeechTime(t) { lastUserSpeechTime = t; },
		setIdleGateClosed(closed) { idleGateClosed = closed; },
		setAutonomousMode(mode) { autonomousMode = mode; },
	};
}
