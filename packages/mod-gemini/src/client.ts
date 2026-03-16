import { Emitter } from '@iris/bus';
import {
  WS_ENDPOINT,
  MODEL,
  LOW_LATENCY_ACTIVITY_DETECTION,
  FALLBACK_ORDER,
  MAX_RETRIES,
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  INBOUND_BATCH_SIZE,
  type FallbackProfile,
} from './config';
import type { ToolDeclaration } from './types';

export interface GeminiClientOptions {
  apiKey: string;
  voiceName?: string;
  systemInstruction: string;
  toolDeclarations: ToolDeclaration[];
  skillDeclarations?: ToolDeclaration[];
}

export type GeminiEvent =
  | 'connected'
  | 'ready'
  | 'disconnected'
  | 'audio'
  | 'inputTranscription'
  | 'outputTranscription'
  | 'turnComplete'
  | 'interrupted'
  | 'toolCall'
  | 'maxRetriesReached';

export const createGeminiClient = (opts: GeminiClientOptions) => {
  const emitter = new Emitter();
  let ws: WebSocket | null = null;
  let connectId = 0;
  let retryCount = 0;
  let profileIndex = 0;
  let sessionReady = false;
  const inboundQueue: unknown[] = [];
  let drainScheduled = false;

  const currentProfile = (): FallbackProfile => FALLBACK_ORDER[profileIndex] ?? 'full';

  const buildSetupPayload = () => {
    const profile = currentProfile();
    const maxChars =
      profile === 'compact-system-instruction' ? 14_000 : 24_000;
    const systemText = opts.systemInstruction.slice(0, maxChars);

    const tools: ToolDeclaration[] = [
      ...opts.toolDeclarations,
      ...(profile === 'core-tools-only' ? [] : (opts.skillDeclarations ?? [])),
    ];

    const generationConfig: Record<string, unknown> = {
      responseModalities: ['AUDIO'],
    };

    if (
      opts.voiceName &&
      profile !== 'no-custom-voice'
    ) {
      generationConfig.speechConfig = {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: opts.voiceName },
        },
      };
    }

    return {
      setup: {
        model: MODEL,
        generationConfig,
        realtimeInputConfig: {
          activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
          automaticActivityDetection: LOW_LATENCY_ACTIVITY_DETECTION,
        },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ],
        systemInstruction: { parts: [{ text: systemText }] },
      },
    };
  };

  const drainInboundQueue = () => {
    drainScheduled = false;
    const batch = inboundQueue.splice(0, INBOUND_BATCH_SIZE);
    for (const msg of batch) {
      processMessage(msg);
    }
    if (inboundQueue.length > 0) {
      drainScheduled = true;
      queueMicrotask(drainInboundQueue);
    }
  };

  const processMessage = (data: unknown) => {
    const msg = data as Record<string, unknown>;

    if (msg.setupComplete) {
      sessionReady = true;
      emitter.emit('ready');
      return;
    }

    if (msg.toolCall) {
      const tc = msg.toolCall as { functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> };
      for (const call of tc.functionCalls) {
        emitter.emit('toolCall', call);
      }
      return;
    }

    const sc = (msg.serverContent ?? msg) as Record<string, unknown>;

    if (sc.inputTranscription) {
      const it = sc.inputTranscription as { text: string };
      emitter.emit('inputTranscription', it.text);
    }

    if (sc.outputTranscription) {
      const ot = sc.outputTranscription as { text: string };
      emitter.emit('outputTranscription', ot.text);
    }

    if (sc.modelTurn) {
      const mt = sc.modelTurn as { parts: Array<{ inlineData?: { data: string }; text?: string }> };
      for (const part of mt.parts) {
        if (part.inlineData?.data) {
          emitter.emit('audio', part.inlineData.data);
        }
        if (part.text) {
          emitter.emit('outputTranscription', part.text);
        }
      }
    }

    if (sc.turnComplete) {
      emitter.emit('turnComplete');
    }

    if (sc.interrupted) {
      emitter.emit('interrupted');
    }
  };

  const connect = () => {
    const id = ++connectId;
    const url = `${WS_ENDPOINT}?key=${opts.apiKey}`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      if (id !== connectId) return;
      // Send setup
      ws!.send(JSON.stringify(buildSetupPayload()));
      emitter.emit('connected');
    };

    ws.onmessage = (event) => {
      if (id !== connectId) return;
      try {
        const data = JSON.parse(event.data as string);
        inboundQueue.push(data);
        if (!drainScheduled) {
          drainScheduled = true;
          queueMicrotask(drainInboundQueue);
        }
      } catch {}
    };

    ws.onclose = (event) => {
      if (id !== connectId) return;
      sessionReady = false;
      emitter.emit('disconnected', { code: event.code, reason: event.reason });

      // Fallback on invalid-argument close
      if (
        event.code === 1007 &&
        event.reason?.toLowerCase().includes('invalid argument')
      ) {
        if (profileIndex < FALLBACK_ORDER.length - 1) {
          profileIndex++;
          console.warn(
            `[gemini] Falling back to profile: ${currentProfile()}`,
          );
          retryCount = 0;
          setTimeout(() => connect(), 500);
          return;
        }
      }

      // Retry with backoff
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, retryCount),
          MAX_RETRY_DELAY_MS,
        );
        retryCount++;
        setTimeout(() => {
          if (id === connectId) connect();
        }, delay);
      } else {
        emitter.emit('maxRetriesReached');
      }
    };

    ws.onerror = () => {
      // onclose will handle retry
    };
  };

  return {
    connect,

    disconnect() {
      connectId++;
      sessionReady = false;
      ws?.close();
      ws = null;
    },

    get isReady() {
      return sessionReady;
    },

    sendAudio(base64: string) {
      if (!sessionReady || !ws) return;
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { mimeType: 'audio/pcm;rate=16000', data: base64 },
          },
        }),
      );
    },

    sendText(text: string) {
      if (!sessionReady || !ws) return;
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }),
      );
    },

    sendRealtimeText(text: string) {
      if (!sessionReady || !ws) return;
      ws.send(JSON.stringify({ realtimeInput: { text } }));
    },

    sendImage(base64Jpeg: string) {
      if (!sessionReady || !ws) return;
      ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'image/jpeg', data: base64Jpeg }],
          },
        }),
      );
    },

    sendToolResponse(callId: string, name: string, result: unknown) {
      if (!ws) return;
      const resultStr =
        typeof result === 'string' ? result : JSON.stringify(result);
      ws.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              { id: callId, name, response: { result: resultStr } },
            ],
          },
        }),
      );
    },

    on(event: GeminiEvent, handler: (...args: unknown[]) => void) {
      return emitter.on(event, handler);
    },

    dispose() {
      connectId++;
      ws?.close();
      ws = null;
      sessionReady = false;
      emitter.removeAll();
      inboundQueue.length = 0;
    },
  };
};
