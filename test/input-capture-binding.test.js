const assert = require('node:assert');
const path = require('node:path');

console.log('Running input capture binding tests...');

const inputPath = path.join(process.cwd(), 'src/main/tools/input.js');
const nativeHelperPath = path.join(process.cwd(), 'src/main/native-helper.js');
const screenCapturePath = path.join(process.cwd(), 'src/main/screen-capture.js');

delete require.cache[require.resolve(inputPath)];
delete require.cache[require.resolve(nativeHelperPath)];
delete require.cache[require.resolve(screenCapturePath)];

const helperCalls = [];

require.cache[require.resolve(nativeHelperPath)] = {
	exports: {
		runHelper: async (args) => {
			helperCalls.push(args);
			return { ok: true, result: 'ok' };
		},
	},
};

require.cache[require.resolve(screenCapturePath)] = {
	exports: {
		getMapping: (captureId = '') => {
			if (captureId === 'cap_active') {
				return { scaleX: 2, scaleY: 3, offsetX: 100, offsetY: 200 };
			}
			if (captureId === 'cap_missing') return null;
			return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
		},
		getCaptureHealth: (captureId = '') => {
			if (captureId === 'cap_missing') {
				return {
					lastCaptureAt: 0,
					lastError: 'Unknown capture_id "cap_missing"',
					permissionStatus: 'granted',
				};
			}
			return {
				lastCaptureAt: Date.now() - 1000,
				lastError: null,
				permissionStatus: 'granted',
			};
		},
	},
};

const { click_at, drag } = require(inputPath);

Promise.resolve()
	.then(async () => {
		const click = await click_at({ x: 10, y: 20, capture_id: 'cap_active' });
		assert.strictEqual(click.ok, true, 'click_at should succeed with a live capture id');
		assert.deepStrictEqual(
			helperCalls[0],
			{ action: 'click_at', x: 120, y: 260, button: 'left' },
			'click_at should use the capture-specific mapping instead of the latest global mapping'
		);

		const dragResult = await drag({ x: 1, y: 2, x2: 3, y2: 4, capture_id: 'cap_active' });
		assert.strictEqual(dragResult.ok, true, 'drag should succeed with a live capture id');
		assert.deepStrictEqual(
			helperCalls[1],
			{ action: 'drag', x: 102, y: 206, x2: 106, y2: 212 },
			'drag should transform both endpoints with the same capture-specific mapping'
		);

		const missing = await click_at({ x: 10, y: 20, capture_id: 'cap_missing' });
		assert.strictEqual(missing.ok, false, 'unknown capture ids should block the click');
		assert.match(missing.result, /Unknown capture_id "cap_missing"/, 'unknown capture ids should surface a clear error');
	})
	.then(() => {
		console.log('Input capture binding tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
