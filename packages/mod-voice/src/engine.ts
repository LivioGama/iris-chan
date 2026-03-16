import { Emitter } from '@iris/bus';
import { VOICE_STATES, type VoiceState, DEFAULT_VOICE_CONFIG } from './config';
import { createListeningGate } from './listening-gate';
import { createBargeInDetector } from './barge-in';

/**
 * VoiceEngine: State machine for full-duplex voice.
 *
 * States: IDLE → LISTENING → USER_SPEAKING → PROCESSING → RESPONDING → TOOL_EXECUTING
 *
 * This is a pure state machine — audio capture and playback are external.
 * Events are emitted for state changes and transitions.
 */

export interface VoiceEngineConfig {
  volumeThreshold: number;
  speechReleaseMs: number;
  echoSuppressionGain: number;
  listeningGate: typeof DEFAULT_VOICE_CONFIG.listeningGate;
  bargeIn: typeof DEFAULT_VOICE_CONFIG.bargeIn;
}

export const createVoiceEngine = (config: VoiceEngineConfig) => {
  const emitter = new Emitter();
  let state: VoiceState = VOICE_STATES.IDLE;
  let speechReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  const listeningGate = createListeningGate(config.listeningGate);
  const bargeInDetector = createBargeInDetector(config.bargeIn);

  const setState = (newState: VoiceState) => {
    if (newState === state) return;
    const prev = state;
    state = newState;
    emitter.emit('stateChanged', { state, prev });
  };

  const clearSpeechRelease = () => {
    if (speechReleaseTimer) {
      clearTimeout(speechReleaseTimer);
      speechReleaseTimer = null;
    }
  };

  return {
    get state(): VoiceState {
      return state;
    },

    /**
     * Start listening (mic active, gemini connected).
     */
    startListening() {
      if (state === VOICE_STATES.IDLE) {
        setState(VOICE_STATES.LISTENING);
      }
    },

    /**
     * Stop voice pipeline.
     */
    stop() {
      clearSpeechRelease();
      listeningGate.reset();
      bargeInDetector.reset();
      setState(VOICE_STATES.IDLE);
    },

    /**
     * Feed a volume sample from the microphone.
     */
    onMicVolume(volume: number) {
      const now = Date.now();

      if (state === VOICE_STATES.LISTENING) {
        const speechDetected = listeningGate.observe(volume, now);
        if (speechDetected) {
          setState(VOICE_STATES.USER_SPEAKING);
          emitter.emit('userSpeaking', { volume });
        }
      } else if (state === VOICE_STATES.USER_SPEAKING) {
        listeningGate.observe(volume, now);
        if (listeningGate.isSilent(now)) {
          // Speech ended — wait for release timer
          clearSpeechRelease();
          speechReleaseTimer = setTimeout(() => {
            if (state === VOICE_STATES.USER_SPEAKING) {
              setState(VOICE_STATES.PROCESSING);
              listeningGate.reset();
            }
          }, config.speechReleaseMs);
        } else {
          clearSpeechRelease();
        }
      } else if (state === VOICE_STATES.RESPONDING) {
        // Barge-in detection
        const bargeIn = bargeInDetector.observe(volume, now);
        if (bargeIn) {
          emitter.emit('bargeIn');
          bargeInDetector.reset();
          setState(VOICE_STATES.USER_SPEAKING);
        }
      }
    },

    /**
     * Set playback volume (for barge-in compensation).
     */
    onPlaybackVolume(volume: number) {
      bargeInDetector.setPlaybackVolume(volume);
    },

    /**
     * Model audio received — transition to RESPONDING.
     */
    onModelAudio() {
      if (
        state === VOICE_STATES.PROCESSING ||
        state === VOICE_STATES.LISTENING
      ) {
        setState(VOICE_STATES.RESPONDING);
        emitter.emit('playbackStart');
      }
    },

    /**
     * Model turn complete — back to LISTENING.
     */
    onTurnComplete() {
      if (
        state === VOICE_STATES.RESPONDING ||
        state === VOICE_STATES.PROCESSING
      ) {
        bargeInDetector.reset();
        setState(VOICE_STATES.LISTENING);
        emitter.emit('playbackEnd');
      }
    },

    /**
     * Tool execution started.
     */
    onToolStart() {
      if (state === VOICE_STATES.RESPONDING || state === VOICE_STATES.LISTENING) {
        setState(VOICE_STATES.TOOL_EXECUTING);
      }
    },

    /**
     * Tool execution complete.
     */
    onToolEnd() {
      if (state === VOICE_STATES.TOOL_EXECUTING) {
        setState(VOICE_STATES.LISTENING);
      }
    },

    /**
     * Model interrupted (server-side interruption).
     */
    onInterrupted() {
      bargeInDetector.reset();
      if (state === VOICE_STATES.RESPONDING) {
        setState(VOICE_STATES.LISTENING);
      }
    },

    on(event: string, handler: (...args: unknown[]) => void) {
      return emitter.on(event, handler);
    },

    dispose() {
      clearSpeechRelease();
      emitter.removeAll();
    },
  };
};
