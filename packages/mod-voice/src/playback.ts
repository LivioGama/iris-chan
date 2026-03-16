/**
 * AudioPlayback: Plays PCM16 audio from Gemini with pitch/rate shaping.
 *
 * Runs in the RENDERER process (needs Web Audio API).
 */

import { Emitter } from '@iris/bus';

const SAMPLE_RATE = 24_000; // Gemini output rate

export interface PlaybackConfig {
  pitch?: number; // 0.5-2.0, default 1
  rate?: number; // 0.5-2.0, default 1
}

export const createAudioPlayback = (config: PlaybackConfig = {}) => {
  const emitter = new Emitter();
  let audioContext: AudioContext | null = null;
  let playing = false;
  let queue: AudioBuffer[] = [];
  let nextStartTime = 0;

  const ensureContext = () => {
    if (!audioContext) {
      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    return audioContext;
  };

  const base64ToPcm16 = (base64: string): Float32Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32;
  };

  const scheduleChunk = (buffer: AudioBuffer) => {
    const ctx = ensureContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = config.rate ?? 1;

    // Optional: gain for volume analysis
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, nextStartTime);
    source.start(startAt);
    nextStartTime = startAt + buffer.duration / (config.rate ?? 1);

    source.onended = () => {
      if (queue.length === 0) {
        playing = false;
        emitter.emit('ended');
      }
    };
  };

  return {
    enqueue(base64Audio: string) {
      const ctx = ensureContext();
      const pcm = base64ToPcm16(base64Audio);
      const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(pcm);

      if (!playing) {
        playing = true;
        nextStartTime = ctx.currentTime;
        emitter.emit('started');
      }

      scheduleChunk(buffer);
    },

    stop() {
      queue = [];
      playing = false;
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      nextStartTime = 0;
    },

    get isPlaying(): boolean {
      return playing;
    },

    on(event: string, handler: (...args: unknown[]) => void) {
      return emitter.on(event, handler);
    },

    dispose() {
      this.stop();
      emitter.removeAll();
    },
  };
};
