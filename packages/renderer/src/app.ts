import { createScene } from './avatar/scene';
import { loadAvatar, type AvatarModel } from './avatar/loader';
import {
  applyHeadLook,
  computeBlink,
  computeLipSync,
  computeSmile,
  type OverlayState,
} from './avatar/overlays';
import { rendererBus } from './bus-renderer';
import { initIndicators, setIndicators } from './ui/status-indicators';
import {
  showBubble,
  showStreamingBubble,
  finalizeStreamingBubble,
  clearBubbles,
} from './ui/bubbles';
import { addTimelineEvent, clearTimeline } from './ui/activity-timeline';
import { addToolEntry, updateToolStatus } from './ui/tool-log';
import { setWorkspace } from './ui/workspace-bar';
import { CH } from '@iris/bus';
import * as THREE from 'three';

// ── Phase A: Scene ──
const sceneCtx = createScene();
const clock = new THREE.Clock();

// ── State ──
let avatar: AvatarModel | null = null;
let voiceState: 'idle' | 'thinking' | 'speaking' = 'idle';
let currentVolume = 0;

// ── Phase B: Load avatar ──
loadAvatar(sceneCtx.scene)
  .then((model) => {
    avatar = model;
    console.log('[app] Avatar loaded');
  })
  .catch((e) => console.error('[app] Avatar load failed:', e));

// ── Phase C: Bus event wiring ──
initIndicators();

// Voice state
rendererBus.on<{ state: string }>(CH.VOICE_STATE_CHANGED, (p) => {
  if (p.state === 'RESPONDING' || p.state === 'TOOL_EXECUTING') {
    voiceState = 'speaking';
  } else if (p.state === 'PROCESSING') {
    voiceState = 'thinking';
  } else {
    voiceState = 'idle';
  }
  setIndicators({
    voice: voiceState !== 'idle',
    think: voiceState === 'thinking',
    speak: voiceState === 'speaking',
  });
});

// Bubbles
rendererBus.on<{ text: string; lane?: string; role?: string }>(
  CH.UI_BUBBLE_SHOW,
  (p) => {
    showBubble({
      text: p.text,
      lane: (p.lane as 'chat' | 'context' | 'thinking') ?? 'chat',
      role: (p.role as 'user' | 'iris') ?? 'iris',
    });
  },
);

rendererBus.on<{ token: string; lane?: string; role?: string }>(
  CH.UI_BUBBLE_STREAM,
  (p) => {
    showStreamingBubble(
      p.token,
      (p.lane as 'chat') ?? 'chat',
      (p.role as 'iris') ?? 'iris',
    );
  },
);

rendererBus.on(CH.UI_BUBBLE_STREAM_END, () => finalizeStreamingBubble());
rendererBus.on(CH.UI_BUBBLE_CLEAR, () => clearBubbles());

// Timeline
rendererBus.on<{
  type: string;
  title: string;
  message: string;
  timestamp: number;
}>(CH.UI_TIMELINE_EVENT, (p) => {
  addTimelineEvent(p);
});

// Status indicators
rendererBus.on<Record<string, boolean>>(CH.UI_STATUS_UPDATE, (updates) => {
  setIndicators(updates as any);
});

// Tool log
rendererBus.on<{
  id: string;
  name: string;
  detail?: string;
  counter?: string;
  status: 'running' | 'success' | 'attention';
}>(CH.UI_TOOL_LOG, (p) => {
  if (p.status === 'running') {
    addToolEntry(p);
  } else {
    updateToolStatus(p.id, p.status);
  }
});

// Workspace
rendererBus.on<{ path: string }>('workspace:set', (p) => {
  setWorkspace(p.path);
});

// Gemini connection
rendererBus.on(CH.GEMINI_CONNECTED, () => setIndicators({ ws: true }));
rendererBus.on(CH.GEMINI_DISCONNECTED, () => setIndicators({ ws: false }));

// ── Phase D: Animation loop ──
const fadeOverlay = () => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 600);
  }
};

// Start rendering after a brief delay for assets to load
setTimeout(fadeOverlay, 800);

const animate = () => {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime() * 1000;

  // Update avatar mixer
  if (avatar?.mixer) {
    avatar.mixer.update(delta);
  }

  // Apply procedural overlays
  if (avatar?.vrm) {
    const vrm = avatar.vrm as any;
    const overlayState: OverlayState = {
      volume: currentVolume,
      isSpeaking: voiceState === 'speaking',
      elapsed,
    };

    // Head look
    const head = vrm.humanoid?.getRawBoneNode?.('head');
    applyHeadLook(head, overlayState);

    // Expressions (VRM)
    if (vrm.expressionManager) {
      const blink = computeBlink(overlayState);
      vrm.expressionManager.setValue('blink', blink);

      const { aa, oh } = computeLipSync(overlayState);
      vrm.expressionManager.setValue('aa', aa);
      vrm.expressionManager.setValue('oh', oh);

      const smile = computeSmile(overlayState);
      vrm.expressionManager.setValue('happy', smile);

      vrm.expressionManager.update();
    }

    vrm.update?.(delta);
  }

  // Update light rig
  sceneCtx.updateLightRig(voiceState, currentVolume, elapsed);

  // Render
  sceneCtx.render();
};

animate();
