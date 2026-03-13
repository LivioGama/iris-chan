// Centralized configuration — all hardcoded values in one place

import path from 'path';
import os from 'os';

export interface Config {
	gemini: {
		endpoint: string;
		model: string;
		flashEndpoint: string;
		voice: string;
		maxRetries: number;
		retryDelay: number;
	};
	tars: {
		enabled: boolean;
		endpoint: string;
		apiKey: string;
		timeoutMs: number;
	};
	audio: {
		captureRate: number;
		playbackRate: number;
		bufferSize: number;
	};
	voice: {
		modelVoiceName: string;
		speechProfile: {
			playbackRate: number;
			pitchSemitones: number;
			lowShelfFrequencyHz: number;
			lowShelfGainDb: number;
			warmthFrequencyHz: number;
			warmthGainDb: number;
			warmthQ: number;
			presenceFrequencyHz: number;
			presenceGainDb: number;
			presenceQ: number;
			highShelfFrequencyHz: number;
			highShelfGainDb: number;
			outputGain: number;
			compressorThresholdDb: number;
			compressorKneeDb: number;
			compressorRatio: number;
			compressorAttackSeconds: number;
			compressorReleaseSeconds: number;
		};
		volumeThreshold: number;
		screenCaptureInterval: number;
		newTurnThresholdMs: number;
		replyCooldownMs: number;
		speechReleaseMs: number;
		echoSuppressionGain: number;
		recentSeen: {
			ttlMs: number;
			maxTerms: number;
			extractIntervalMs: number;
			minConfidence: number;
			rewriteDistance: number;
			persistEnabled: boolean;
		};
		listeningGate: {
			minSpeechMs: number;
			candidateGapMs: number;
			preRollMs: number;
			noiseFloorAttack: number;
			noiseFloorRelease: number;
			noiseFloorMultiplier: number;
			noiseFloorOffset: number;
			frameMsFallback: number;
		};
		bargeIn: {
			minRespondingThreshold: number;
			minSpeechMs: number;
			candidateGapMs: number;
			preRollMs: number;
			playbackDominanceRatio: number;
			settleMs: number;
			noiseFloorAttack: number;
			noiseFloorRelease: number;
			noiseFloorMultiplier: number;
			noiseFloorOffset: number;
			frameMsFallback: number;
		};
	};
	vocab: {
		hotPromoteCount: number;
		hotExpireMs: number;
		maxSystemTerms: number;
		clipboardPollMs: number;
		windowPollMs: number;
		batchExtractMs: number;
		promoteCleanMs: number;
		refreshMs: number;
		maxExtractTextLen: number;
		maxExtractTerms: number;
		correctionPromoteCount: number;
	};
	window: {
		avatarWidth: number;
		avatarHeight: number;
	};
	search: {
		ollamaHost: string;
		autoHideMs: number;
	};
	paths: {
		irisDir: string;
		helperSrc: string;
		helperBin: string;
		srcVocab: string;
	};
	messaging: {
		apps: string[];
	};
	autonomous: {
		pollIntervalMs: number;
		cooldownAfterTurnMs: number;
		maxConsecutiveAutoTurns: number;
	};
	directMode: {
		pollIntervalMs: number;
		countdownSeconds: number;
		cooldownAfterTurnMs: number;
		maxConsecutiveAutoTurns: number;
	};
	avatar: {
		current: 'original' | 'tripo3d';
	};
}

const config: Config = {
	gemini: {
		endpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
		model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
		flashEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
		voice: 'Kore',
		maxRetries: 5,
		retryDelay: 2000,
	},
	tars: {
		enabled: (process.env.TARS_ENABLED || '1') !== '0'
			&& Boolean(process.env.TARS_ENDPOINT || '')
			&& Boolean(process.env.TARS_API_KEY || ''),
		endpoint: process.env.TARS_ENDPOINT || '',
		apiKey: process.env.TARS_API_KEY || '',
		timeoutMs: Math.max(1000, Number(process.env.TARS_TIMEOUT_MS || 8000)),
	},
	audio: {
		captureRate: 16000,
		playbackRate: 24000,
		bufferSize: 2048,
	},
	voice: {
		modelVoiceName: 'Charon',
		speechProfile: {
			playbackRate: 0.93,
			pitchSemitones: -2.6,
			lowShelfFrequencyHz: 170,
			lowShelfGainDb: 3.4,
			warmthFrequencyHz: 280,
			warmthGainDb: 2.6,
			warmthQ: 0.9,
			presenceFrequencyHz: 2100,
			presenceGainDb: 0.9,
			presenceQ: 0.7,
			highShelfFrequencyHz: 4800,
			highShelfGainDb: 0,
			outputGain: 1,
			compressorThresholdDb: -24,
			compressorKneeDb: 8,
			compressorRatio: 2.2,
			compressorAttackSeconds: 0.003,
			compressorReleaseSeconds: 0.2,
		},
		volumeThreshold: 0.015,
		screenCaptureInterval: 10000,
		newTurnThresholdMs: 3000,
		replyCooldownMs: 45000,
		speechReleaseMs: 160,
		echoSuppressionGain: 0.8,
		recentSeen: {
			ttlMs: 30000,
			maxTerms: 24,
			extractIntervalMs: 10000,
			minConfidence: 0.6,
			rewriteDistance: 3,
			persistEnabled: true,
		},
		listeningGate: {
			minSpeechMs: 180,
			candidateGapMs: 90,
			preRollMs: 450,
			noiseFloorAttack: 0.22,
			noiseFloorRelease: 0.05,
			noiseFloorMultiplier: 1.8,
			noiseFloorOffset: 0.02,
			frameMsFallback: 32,
		},
		bargeIn: {
			minRespondingThreshold: 0.04,
			minSpeechMs: 180,
			candidateGapMs: 90,
			preRollMs: 450,
			playbackDominanceRatio: 0.35,
			settleMs: 120,
			noiseFloorAttack: 0.22,
			noiseFloorRelease: 0.05,
			noiseFloorMultiplier: 1.6,
			noiseFloorOffset: 0.012,
			frameMsFallback: 32,
		},
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
	autonomous: {
		pollIntervalMs: 60000,
		cooldownAfterTurnMs: 15000,
		maxConsecutiveAutoTurns: 3,
	},
	directMode: {
		pollIntervalMs: 1000,       // Poll every 1s in direct mode (vs 3s normal)
		countdownSeconds: 0,        // Skip countdown entirely — queue immediately
		cooldownAfterTurnMs: 5000,  // Minimal cooldown between auto turns
		maxConsecutiveAutoTurns: 10, // Higher ceiling for consecutive autonomous turns
	},
	avatar: {
		// 'original' or 'tripo3d'
		current: 'original',
	},
};

export default config;
