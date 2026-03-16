export const VOICE_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  USER_SPEAKING: 'USER_SPEAKING',
  PROCESSING: 'PROCESSING',
  RESPONDING: 'RESPONDING',
  TOOL_EXECUTING: 'TOOL_EXECUTING',
} as const;

export type VoiceState = (typeof VOICE_STATES)[keyof typeof VOICE_STATES];

export const DEFAULT_VOICE_CONFIG = {
  volumeThreshold: 0.015,
  screenCaptureInterval: 10_000,
  newTurnThresholdMs: 3_000,
  replyCooldownMs: 45_000,
  speechReleaseMs: 160,
  echoSuppressionGain: 0.8,

  directTurn: {
    fastReleaseMs: 90,
    serverEvidenceGraceMs: 1_500,
    resumeWindowMs: 1_200,
    trailingNoiseRatio: 0.35,
    trailingNoiseThresholdMultiplier: 1.2,
    repromptText: 'I did not catch that. Please say it again.',
  },

  recentSeen: {
    ttlMs: 30_000,
    maxTerms: 24,
    extractIntervalMs: 10_000,
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
    noiseFloorMultiplier: 1.0,
    noiseFloorOffset: 0,
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
};
