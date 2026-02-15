// Centralized configuration — all hardcoded values in one place

const path = require('path');
const os = require('os');

module.exports = {
	gemini: {
		endpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
		model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
		flashEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent',
		voice: 'Kore',
		maxRetries: 5,
		retryDelay: 2000,
	},
	audio: {
		captureRate: 16000,
		playbackRate: 24000,
		bufferSize: 2048,
	},
	voice: {
		volumeThreshold: 0.015,
		screenCaptureInterval: 10000,
		newTurnThresholdMs: 3000,
		replyCooldownMs: 45000,
	},
	vocab: {
		hotPromoteCount: 5,
		hotExpireMs: 3600000,
		maxSystemTerms: 40,
		clipboardPollMs: 5000,
		windowPollMs: 3000,
		batchExtractMs: 60000,
		promoteCleanMs: 60000,
		refreshMs: 60000,
		maxExtractTextLen: 4000,
		maxExtractTerms: 10,
		correctionPromoteCount: 2,
	},
	window: {
		avatarWidth: 700,
		avatarHeight: 600,
	},
	search: {
		ollamaHost: 'https://ollama.com',
		autoHideMs: 30000,
	},
	paths: {
		irisDir: path.join(os.homedir(), '.iris'),
		helperSrc: path.join(__dirname, '..', '..', 'helpers', 'iris-helper.swift'),
		helperBin: path.join(__dirname, '..', '..', 'helpers', 'iris-helper'),
		srcVocab: path.join(__dirname, '..', '..', 'data', 'vocabulary.json'),
	},
	messaging: {
		apps: ['whatsapp', 'telegram', 'signal', 'messages', 'imessage', 'discord', 'slack', 'messenger'],
	},
};
