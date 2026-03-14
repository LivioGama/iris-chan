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
		provider: string;
		model: string;
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
	voicePresets: Array<{
		name: string;
		description: string;
		aliases?: string[];
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
	}>;
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
		axPollMs: number;
		axMaxElements: number;
	};
	window: {
		avatarWidth: number;
		avatarHeight: number;
	};
	search: {
		perplexityBaseUrl: string;
		perplexityModel: string;
		requestTimeoutMs: number;
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
	linkCapture: {
		enabled: boolean;
		pollIntervalMs: number;
		maxSeenCacheSize: number;
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
		enabled: (process.env.UI_TARS_ENABLED || process.env.TARS_ENABLED || '1') !== '0'
			&& Boolean(process.env.UI_TARS_URL || process.env.TARS_ENDPOINT || '')
			&& Boolean(process.env.UI_TARS_API_KEY || process.env.TARS_API_KEY || ''),
		endpoint: process.env.UI_TARS_URL || process.env.TARS_ENDPOINT || '',
		apiKey: process.env.UI_TARS_API_KEY || process.env.TARS_API_KEY || '',
		timeoutMs: Math.max(1000, Number(process.env.UI_TARS_TIMEOUT_MS || process.env.TARS_TIMEOUT_MS || 8000)),
		provider: (process.env.UI_TARS_PROVIDER || process.env.TARS_PROVIDER || 'custom').trim().toLowerCase(),
		model: (process.env.UI_TARS_MODEL || process.env.TARS_MODEL || 'ui-tars-7b-dpo').trim(),
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
	voicePresets: [
		{
			name: 'soft bloom',
			description: 'Soft, airy, feminine-leaning voice with a gentle high-end sheen.',
			aliases: ['bloom'],
			modelVoiceName: 'Aoede',
			speechProfile: {
				playbackRate: 0.98,
				pitchSemitones: -0.5,
				lowShelfFrequencyHz: 170,
				lowShelfGainDb: 0.8,
				warmthFrequencyHz: 280,
				warmthGainDb: 1.6,
				warmthQ: 0.9,
				presenceFrequencyHz: 2600,
				presenceGainDb: 1.5,
				presenceQ: 0.7,
				highShelfFrequencyHz: 5600,
				highShelfGainDb: 0.9,
				outputGain: 1,
				compressorThresholdDb: -22,
				compressorKneeDb: 8,
				compressorRatio: 2.0,
				compressorAttackSeconds: 0.003,
				compressorReleaseSeconds: 0.2,
			},
		},
		{
			name: 'clear guide',
			description: 'Balanced, articulate preset for neutral guidance and instruction.',
			aliases: ['guide'],
			modelVoiceName: 'Kore',
			speechProfile: {
				playbackRate: 0.97,
				pitchSemitones: -1.1,
				lowShelfFrequencyHz: 170,
				lowShelfGainDb: 1.2,
				warmthFrequencyHz: 280,
				warmthGainDb: 1.4,
				warmthQ: 0.9,
				presenceFrequencyHz: 2400,
				presenceGainDb: 1.3,
				presenceQ: 0.7,
				highShelfFrequencyHz: 5200,
				highShelfGainDb: 0.4,
				outputGain: 1,
				compressorThresholdDb: -23,
				compressorKneeDb: 8,
				compressorRatio: 2.1,
				compressorAttackSeconds: 0.003,
				compressorReleaseSeconds: 0.2,
			},
		},
		{
			name: 'velvet dusk',
			description: 'Warmer, darker, more intimate preset with softer presence.',
			aliases: ['dusk', 'velvet'],
			modelVoiceName: 'Charon',
			speechProfile: {
				playbackRate: 0.92,
				pitchSemitones: -2.1,
				lowShelfFrequencyHz: 170,
				lowShelfGainDb: 2.6,
				warmthFrequencyHz: 280,
				warmthGainDb: 2.8,
				warmthQ: 0.9,
				presenceFrequencyHz: 1900,
				presenceGainDb: 0.2,
				presenceQ: 0.7,
				highShelfFrequencyHz: 4700,
				highShelfGainDb: -0.4,
				outputGain: 1,
				compressorThresholdDb: -24,
				compressorKneeDb: 8,
				compressorRatio: 2.4,
				compressorAttackSeconds: 0.003,
				compressorReleaseSeconds: 0.2,
			},
		},
		{
			name: 'bright spark',
			description: 'Faster, brighter, more energetic preset with extra presence.',
			aliases: ['spark'],
			modelVoiceName: 'Aoede',
			speechProfile: {
				playbackRate: 1.01,
				pitchSemitones: 0.2,
				lowShelfFrequencyHz: 170,
				lowShelfGainDb: 0.4,
				warmthFrequencyHz: 280,
				warmthGainDb: 0.8,
				warmthQ: 0.9,
				presenceFrequencyHz: 3000,
				presenceGainDb: 1.9,
				presenceQ: 0.7,
				highShelfFrequencyHz: 6200,
				highShelfGainDb: 1.2,
				outputGain: 1,
				compressorThresholdDb: -21,
				compressorKneeDb: 8,
				compressorRatio: 2.0,
				compressorAttackSeconds: 0.003,
				compressorReleaseSeconds: 0.2,
			},
		},
	],
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
		axPollMs: 15000,
		axMaxElements: 80,
	},
	window: {
		avatarWidth: 700,
		avatarHeight: 600,
	},
	search: {
		perplexityBaseUrl: (process.env.IRIS_SEARCH_PERPLEXITY_BASE_URL || 'https://api.perplexity.ai').trim(),
		perplexityModel: (process.env.IRIS_SEARCH_PERPLEXITY_MODEL || 'sonar').trim(),
		requestTimeoutMs: Math.max(5000, Number(process.env.IRIS_SEARCH_TIMEOUT_MS || 30000)),
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
	linkCapture: {
		enabled: (process.env.IRIS_LINK_CAPTURE_ENABLED || '1') !== '0',
		pollIntervalMs: Math.max(5000, Number(process.env.IRIS_LINK_CAPTURE_INTERVAL_MS || 10000)),
		maxSeenCacheSize: 5000,
	},
};

export default config;
