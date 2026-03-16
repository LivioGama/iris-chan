/**
 * AudioCapture: WebAudio-based microphone capture.
 * Outputs PCM16 16kHz base64 chunks and volume levels.
 *
 * Runs in the RENDERER process (needs Web Audio API).
 */

import { Emitter } from '@iris/bus';

const SAMPLE_RATE = 16_000;
const BUFFER_SIZE = 4096;

export const createAudioCapture = () => {
  const emitter = new Emitter();
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let active = false;

  const pcm16ToBase64 = (float32: Float32Array): string => {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const computeVolume = (data: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  };

  return {
    async start() {
      if (active) return;

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const volume = computeVolume(data);
        const base64 = pcm16ToBase64(data);

        emitter.emit('volume', volume);
        emitter.emit('data', base64);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      active = true;
    },

    stop() {
      if (!active) return;
      processor?.disconnect();
      source?.disconnect();
      audioContext?.close();
      mediaStream?.getTracks().forEach((t) => t.stop());

      processor = null;
      source = null;
      audioContext = null;
      mediaStream = null;
      active = false;
    },

    get isActive(): boolean {
      return active;
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
