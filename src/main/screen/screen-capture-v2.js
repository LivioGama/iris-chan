const baseCapture = require('../screen-capture');

async function captureForVerification() {
	const result = await baseCapture.capture();
	if (!result.ok) return result;
	return {
		ok: true,
		data: result.data,
		context: {
			...result.context,
			transient: true,
			persistByDefault: false,
		},
	};
}

module.exports = { captureForVerification };
