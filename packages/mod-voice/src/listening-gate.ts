/**
 * ListeningGate: Filters noise, determines speech start/end.
 * Uses adaptive noise floor to distinguish speech from background.
 */

export interface GateConfig {
  minSpeechMs: number;
  candidateGapMs: number;
  preRollMs: number;
  noiseFloorAttack: number;
  noiseFloorRelease: number;
  noiseFloorMultiplier: number;
  noiseFloorOffset: number;
  frameMsFallback: number;
}

export const createListeningGate = (config: GateConfig) => {
  let noiseFloor = 0;
  let candidateStart = 0;
  let speechConfirmed = false;
  let lastAboveAt = 0;

  const threshold = () =>
    noiseFloor * config.noiseFloorMultiplier + config.noiseFloorOffset;

  return {
    /**
     * Observe a volume sample. Returns true if speech is confirmed.
     */
    observe(volume: number, nowMs: number = Date.now()): boolean {
      // Adapt noise floor
      if (volume < threshold()) {
        noiseFloor += (volume - noiseFloor) * config.noiseFloorRelease;
      } else {
        noiseFloor += (volume - noiseFloor) * config.noiseFloorAttack;
      }

      const isAbove = volume > threshold();

      if (isAbove) {
        lastAboveAt = nowMs;
        if (candidateStart === 0) {
          candidateStart = nowMs;
        }
        // Confirm speech if sustained above threshold
        if (!speechConfirmed && nowMs - candidateStart >= config.minSpeechMs) {
          speechConfirmed = true;
        }
      } else {
        // If gap exceeds candidate gap, reset
        if (
          candidateStart > 0 &&
          !speechConfirmed &&
          nowMs - lastAboveAt > config.candidateGapMs
        ) {
          candidateStart = 0;
        }
      }

      return speechConfirmed;
    },

    /**
     * Check if speech has ended (silence after confirmed speech).
     */
    isSilent(nowMs: number = Date.now()): boolean {
      if (!speechConfirmed) return true;
      return nowMs - lastAboveAt > config.candidateGapMs;
    },

    reset() {
      candidateStart = 0;
      speechConfirmed = false;
      lastAboveAt = 0;
    },

    get isActive(): boolean {
      return speechConfirmed;
    },

    get currentNoiseFloor(): number {
      return noiseFloor;
    },
  };
};
