/**
 * Procedural avatar animations — no external animation system needed.
 * Applied every frame in the render loop.
 */

export interface OverlayState {
  volume: number; // 0-1 current voice volume
  isSpeaking: boolean;
  elapsed: number; // total elapsed ms
}

/**
 * Head look-around — subtle sine/cos oscillation.
 */
export const applyHeadLook = (
  bone: { rotation: { x: number; y: number; z: number } } | null,
  state: OverlayState,
) => {
  if (!bone) return;
  const t = state.elapsed / 1000;
  bone.rotation.x = 0.02 * Math.sin(t * 0.31);
  bone.rotation.y = 0.03 * Math.sin(t * 0.23);
  bone.rotation.z = 0.01 * Math.cos(t * 0.17);
};

/**
 * Finger curl — relaxed curl with gentle oscillation.
 */
export const applyFingerCurl = (
  fingers: Array<{ rotation: { x: number } } | null>,
  state: OverlayState,
) => {
  const t = state.elapsed / 1000;
  for (let i = 0; i < fingers.length; i++) {
    const bone = fingers[i];
    if (!bone) continue;
    bone.rotation.x = 0.3 + 0.05 * Math.sin(t * 0.4 + i * 0.7);
  }
};

/**
 * Blink animation — periodic closed-eye effect.
 */
export const computeBlink = (state: OverlayState): number => {
  const t = state.elapsed / 1000;
  const blinkInterval = 6.0;
  const blinkPhase = (t % blinkInterval) / blinkInterval;

  // Quick blink at phase 0
  if (blinkPhase < 0.03) {
    return Math.sin(blinkPhase / 0.03 * Math.PI);
  }
  return 0;
};

/**
 * Lip sync — volume-driven mouth shape.
 */
export const computeLipSync = (
  state: OverlayState,
): { aa: number; oh: number } => {
  if (!state.isSpeaking || state.volume < 0.01) {
    return { aa: 0, oh: 0 };
  }
  const v = Math.min(1, state.volume);
  return {
    aa: v * 0.7,
    oh: v * 0.3,
  };
};

/**
 * Smile — subtle sine-based happiness, more when speaking.
 */
export const computeSmile = (state: OverlayState): number => {
  const t = state.elapsed / 1000;
  const base = 0.1 + 0.05 * Math.sin(t * 0.19);
  return state.isSpeaking ? base + 0.15 : base;
};
