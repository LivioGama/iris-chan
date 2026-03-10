const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

function createProcessorHarness(ProcessorCtor) {
	const messages = [];
	const processor = new ProcessorCtor();
	processor.port.postMessage = (message) => {
		messages.push(message);
	};
	return { processor, messages };
}

function findLastVolume(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.type === 'volume') return messages[i].value;
	}
	return null;
}

console.log('Running audio capture worklet tests...');

(async () => {
	const captureModuleUrl = pathToFileURL(path.join(process.cwd(), 'src/renderer/voice/capture.js')).href;
	const { WORKLET_CODE } = await import(captureModuleUrl);

	let ProcessorCtor = null;
	const context = {
		AudioWorkletProcessor: class {
			constructor() {
				this.port = {
					onmessage: null,
					postMessage() {},
				};
			}
		},
		Float32Array,
		Int16Array,
		Math,
		registerProcessor(_name, ctor) {
			ProcessorCtor = ctor;
		},
	};

	vm.runInNewContext(WORKLET_CODE, context);
	assert.ok(ProcessorCtor, 'worklet should register a processor constructor');

	{
		const { processor, messages } = createProcessorHarness(ProcessorCtor);
		const frame = new Float32Array(128).fill(0.5);

		processor.port.onmessage({ data: { type: 'reference', samples: new Float32Array(0) } });
		processor.process([[frame]], []);
		processor.process([[frame]], []);

		const volume = findLastVolume(messages);
		assert.ok(volume, 'fallback pass should emit a volume reading');
		assert(
			volume.effective > 0.2,
			`playback-active fallback should preserve mic energy instead of crushing it (got ${volume.effective})`
		);
	}

	{
		const { processor } = createProcessorHarness(ProcessorCtor);
		const frame = new Float32Array(128).fill(0.5);

		processor.filterOrder = 1;
		processor.filterCoeffs = new Float32Array([1]);
		processor.referenceHistory = new Float32Array(1);
		processor.historyIndex = 0;
		processor.stepSize = 0;
		processor.refPower = 1;
		processor.port.onmessage({ data: { type: 'setSuppressionGain', gain: 0.8 } });
		processor.port.onmessage({ data: { type: 'reference', samples: new Float32Array(128).fill(0.5) } });

		processor.process([[frame]], []);

		const normalizedFirstSample = processor.buffer[0] / 0x7FFF;
		assert(
			Math.abs(normalizedFirstSample - 0.1) < 0.02,
			`suppressionGain should scale the subtraction path (got ${normalizedFirstSample})`
		);
	}

	console.log('Audio capture worklet tests passed.');
})().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
