const assert = require('node:assert');
const path = require('node:path');

console.log('Running screen capture coordinate-space tests...');

function createFakeImage(width, height) {
	return {
		_width: width,
		_height: height,
		getSize() {
			return { width: this._width, height: this._height };
		},
		toPNG({ scaleFactor } = {}) {
			return Buffer.from(`png:${scaleFactor ?? 'default'}:${this._width}x${this._height}`);
		},
		resize({ width: nextWidth, height: nextHeight }) {
			return createFakeImage(nextWidth, nextHeight);
		},
		toJPEG() {
			return Buffer.from(`jpeg:${this._width}x${this._height}`);
		},
		isEmpty() {
			return false;
		},
	};
}

const screenCapturePath = path.join(process.cwd(), 'src/main/screen-capture.js');
const loggerPath = path.join(process.cwd(), 'src/main/logger.js');
const electronPath = require.resolve('electron');

delete require.cache[require.resolve(screenCapturePath)];
delete require.cache[require.resolve(loggerPath)];
delete require.cache[electronPath];

const requestedThumbnailSizes = [];
const cursorPoint = { x: 720, y: 450 };
const displayBounds = { x: 0, y: 0, width: 1440, height: 900 };

require.cache[require.resolve(loggerPath)] = {
	exports: {
		info() {},
		error() {},
	},
};

require.cache[electronPath] = {
	exports: {
		desktopCapturer: {
			async getSources(options) {
				requestedThumbnailSizes.push(options.thumbnailSize);
				return [
					{
						display_id: 'display-1',
						thumbnail: createFakeImage(2160, 1350),
					},
				];
			},
		},
		nativeImage: {
			createFromBuffer(buffer) {
				const match = String(buffer).match(/:(\d+)x(\d+)$/);
				if (!match) return createFakeImage(1, 1);
				return createFakeImage(Number(match[1]), Number(match[2]));
			},
		},
		screen: {
			getCursorScreenPoint() {
				return cursorPoint;
			},
			getDisplayNearestPoint() {
				return {
					id: 'display-1',
					bounds: displayBounds,
					scaleFactor: 1.5,
				};
			},
		},
		systemPreferences: {
			getMediaAccessStatus() {
				return 'granted';
			},
		},
	},
};

const { capture, getMapping } = require(screenCapturePath);

Promise.resolve()
	.then(async () => {
		const result = await capture();
		assert.strictEqual(result.ok, true, 'capture should succeed');
		assert.deepStrictEqual(
			requestedThumbnailSizes[0],
			{ width: 1440, height: 900 },
			'desktop capture should request the display size in logical coordinates'
		);
		assert.strictEqual(result.context.imageWidth, 1440, 'normalized image width should match display width');
		assert.strictEqual(result.context.imageHeight, 900, 'normalized image height should match display height');
		assert.strictEqual(result.context.displayWidth, 1440, 'display width should match the logical capture width');
		assert.strictEqual(result.context.displayHeight, 900, 'display height should match the logical capture height');
		assert.strictEqual(result.context.cursorX, 720, 'cursor X should stay in the same coordinate space as the image');
		assert.strictEqual(result.context.cursorY, 450, 'cursor Y should stay in the same coordinate space as the image');

		const mapping = getMapping(result.context.captureId);
		assert.deepStrictEqual(
			mapping,
			{
				captureId: result.context.captureId,
				capturedAt: mapping.capturedAt,
				scaleX: 1,
				scaleY: 1,
				offsetX: 0,
				offsetY: 0,
				permissionStatus: 'granted',
			},
			'capture mapping should stay one-to-one in the normalized coordinate space'
		);
	})
	.then(() => {
		console.log('Screen capture coordinate-space tests passed.');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
