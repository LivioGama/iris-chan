"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSelfFixAck = getSelfFixAck;
exports.isIdleNoise = isIdleNoise;
const transcription_policy_js_1 = require("../voice/transcription-policy.js");
function getSelfFixAck() {
    return 'On it.';
}
function isIdleNoise(text = '') {
    return transcription_policy_js_1.IDLE_NOISE_PATTERN.test(text);
}
