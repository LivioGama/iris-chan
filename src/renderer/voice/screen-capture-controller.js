import { error as logError } from '../logger.js';

export function createScreenCaptureController({ gemini }) {
	let interval = null;
	let lastUserSpeechTime = Date.now();
	let idleGateClosed = false;
	let autonomousMode = false;
	const sendFrame = async (passive = false, options = {}) => {
		try {
			const captureOptions = {
				persistForDebug: options.persistForDebug ?? !passive,
				reason: options.reason || (passive ? 'passive' : 'analysis'),
			};
			const capture = await window.electronAPI.captureScreen(captureOptions);
			if (capture?.ok && capture.data) {
				if (!passive && capture.context) {
					const ctx = capture.context;
					gemini.sendText(
						`[SCREEN CONTEXT] Image: ${ctx.imageWidth}x${ctx.imageHeight}px, Display: ${ctx.displayWidth}x${ctx.displayHeight}, Scale: ${ctx.scaleFactor}x, Cursor: (${ctx.cursorX}, ${ctx.cursorY}), DebugPath: ${ctx.debugImagePath || 'none'}. IMPORTANT: Use the IMAGE pixel coordinates (from ${ctx.imageWidth}x${ctx.imageHeight} image) directly for mouse_move, click_at, and drag. The image shows exactly what is at each pixel location.`
					);
				}
				gemini.sendImage(capture.data);
			}
		} catch (err) {
			logError('Screen', 'Capture error:', err);
		}
	};

	const start = () => {
		stop();
		sendFrame(false, { persistForDebug: true, reason: 'session-start' });
		interval = setInterval(() => {
			if (idleGateClosed) return;
			if (!autonomousMode && Date.now() - lastUserSpeechTime > 60000) {
				stop();
				return;
			}
			sendFrame(true, { persistForDebug: false, reason: 'passive' });
		}, 10000);
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
		capture: (passive = false, options = {}) => sendFrame(passive, options),
		get isRunning() { return interval !== null; },
		setLastUserSpeechTime(t) { lastUserSpeechTime = t; },
		setIdleGateClosed(closed) { idleGateClosed = closed; },
		setAutonomousMode(mode) { autonomousMode = mode; },
	};
}
