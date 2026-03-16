/**
 * BargeInDetector: Detects when user speaks during system playback.
 * Compares microphone volume against playback-modulated threshold.
 */

export interface BargeInConfig {
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
}

export const createBargeInDetector = (config: BargeInConfig) => {
  let noiseFloor = 0;
  let candidateStart = 0;
  let confirmed = false;
  let lastAboveAt = 0;
  let playbackVolume = 0;

  const threshold = () => {
    const base =
      noiseFloor * config.noiseFloorMultiplier + config.noiseFloorOffset;
    const playbackCompensation = playbackVolume * config.playbackDominanceRatio;
    return Math.max(config.minRespondingThreshold, base + playbackCompensation);
  };

  return {
    setPlaybackVolume(vol: number) {
      playbackVolume = vol;
    },

    observe(micVolume: number, nowMs: number = Date.now()): boolean {
      // Adapt noise floor
      if (micVolume < threshold()) {
        noiseFloor += (micVolume - noiseFloor) * config.noiseFloorRelease;
      } else {
        noiseFloor += (micVolume - noiseFloor) * config.noiseFloorAttack;
      }

      const isAbove = micVolume > threshold();

      if (isAbove) {
        lastAboveAt = nowMs;
        if (candidateStart === 0) candidateStart = nowMs;
        if (!confirmed && nowMs - candidateStart >= config.minSpeechMs) {
          confirmed = true;
        }
      } else {
        if (
          candidateStart > 0 &&
          !confirmed &&
          nowMs - lastAboveAt > config.candidateGapMs
        ) {
          candidateStart = 0;
        }
      }

      return confirmed;
    },

    reset() {
      candidateStart = 0;
      confirmed = false;
      lastAboveAt = 0;
      playbackVolume = 0;
    },

    get isActive(): boolean {
      return confirmed;
    },
  };
};
