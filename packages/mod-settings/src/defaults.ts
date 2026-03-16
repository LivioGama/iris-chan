export const DEFAULTS: Record<string, Record<string, unknown>> = {
  voice: {
    modelVoiceName: 'Aoede',
    volumeThreshold: 0.015,
    screenCaptureInterval: 10000,
    newTurnThresholdMs: 3000,
    replyCooldownMs: 45000,
    bargeInDetection: true,
  },
  avatar: {
    model: 'tripo3d',
  },
  behavior: {
    mode: 'attentive',
    directMode: false,
    suggestionsEnabled: true,
    feedbackEnabled: true,
    introversionEnabled: false,
  },
  logging: {
    consoleLevel: 'info',
    persistLevel: 'info',
  },
  '2fa': {
    enabled: true,
    pollIntervalMs: 5000,
    confidenceThreshold: 0.7,
    sources: ['imessage', 'mail', 'notifications'],
  },
};
