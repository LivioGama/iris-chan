import { IDLE_NOISE_PATTERN } from '../voice/transcription-policy.js';

export function getSelfFixAck() {
	return 'On it.';
}

export function isIdleNoise(text = '') {
	return IDLE_NOISE_PATTERN.test(text);
}
