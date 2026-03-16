export const WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

export const FLASH_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

export const LOW_LATENCY_ACTIVITY_DETECTION = {
  disabled: false,
  startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
  endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
  prefixPaddingMs: 20,
  silenceDurationMs: 140,
};

export const MAX_SKILL_SECTION_CHARS = 12_000;
export const MAX_SKILL_CATALOG_ENTRIES = 40;
export const DEFAULT_MAX_SYSTEM_CHARS = 24_000;
export const COMPACT_MAX_SYSTEM_CHARS = 14_000;
export const DEFAULT_MAX_PAYLOAD_CHARS = 45_000;
export const INBOUND_BATCH_SIZE = 24;

export type FallbackProfile =
  | 'full'
  | 'no-custom-voice'
  | 'core-tools-only'
  | 'compact-system-instruction';

export const FALLBACK_ORDER: FallbackProfile[] = [
  'full',
  'no-custom-voice',
  'core-tools-only',
  'compact-system-instruction',
];

export const MAX_RETRIES = 5;
export const BASE_RETRY_DELAY_MS = 2_000;
export const MAX_RETRY_DELAY_MS = 30_000;
