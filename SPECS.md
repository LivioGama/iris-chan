# Iris-chan: Transparent Desktop Companion Specification

## Goals

- **Always-visible transparent desktop companion** with VRM avatar that follows cursor and displays realistic idle behavior with natural micro-movements
- **Voice-driven interaction** with Google Gemini Live API including real-time lip-sync synchronized to TTS output using viseme-driven facial animation
- **Non-intrusive UX** with click-through transparency, smart positioning, minimal performance impact, and seamless desktop workflow integration
- **Auto-update system** with background downloads, delta updates, seamless version management, and automatic rollback on failures
- **Production-ready Electron app** optimized for performance, memory efficiency, cross-platform support (macOS, Windows, Linux), and battery conservation

## Non-Goals

- Mobile app versions (iOS/Android)
- Multi-avatar support or avatar customization UI
- Full 3D scene editor or avatar builder
- Real-time avatar rendering during tool execution (avatar pauses gracefully)
- Support for non-VRM avatar formats

## Tech Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| **Runtime** | Bun | 1.2.0+ | Package manager, task runner (always latest) |
| **Desktop Framework** | Electron | 40.4.1+ | Cross-platform desktop app |
| **UI Framework** | React | 19.1.0+ | Renderer process UI with concurrent features |
| **3D Engine** | Three.js | 0.175.0+ | WebGL rendering engine |
| **Avatar Format** | VRM | 1.0/3.0 | Humanoid 3D avatar standard (GLTF-based) |
| **VRM Loader** | @pixiv/three-vrm | 3.6.0+ | VRM parsing, animation, expressions |
| **Language** | TypeScript | 5.8.0+ (strict) | Type safety with strict mode enabled |
| **Styling** | Tailwind CSS | 4.1.7+ | Utility-first CSS with v4 features |
| **State Management** | Zustand | 5.0.3+ | Lightweight React state (minimal boilerplate) |
| **Voice API** | Google Gemini Live | 2.0-flash-exp | Real-time bidirectional voice streaming |
| **Audio Processing** | Web Audio API | Native | Mic capture, playback, FFT analysis |
| **Lip-sync** | Oculus Visemes | Standard | 15 phoneme-driven mouth shapes |
| **Auto-Updates** | electron-updater | 7.2.0+ | GitHub Releases with delta updates |
| **Build Tool** | electron-builder | 25.4.0+ | Multi-platform packaging & code signing |
| **Linting/Format** | Biome | 1.9.4+ | Fast Rust-based linter/formatter (replaces ESLint+Prettier) |
| **Cursor Tracking** | Electron screen API | Native | Global cursor position monitoring |
| **Animation** | Three.js Animation Mixer | Native | Skeletal animation blending |
| **Physics** | Custom Spring Damper | N/A | Smooth cursor following with lag |

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                    │
├─────────────────────────────────────────────────────────────┤
│  • App Lifecycle (main/index.ts)                            │
│  • Window Manager (main/windows/avatar-window.ts)           │
│  • IPC Handlers (main/ipc.ts)                               │
│  • Tool Executor (main/tools/)                              │
│  • Auto-Updater (main/updater.ts) ← NEW                     │
│  • Performance Monitor (main/perf-monitor.ts) ← NEW         │
└──────────────┬──────────────────────────────────────────────┘
               │ IPC Bridge (contextBridge)
┌──────────────▼──────────────────────────────────────────────┐
│                  ELECTRON RENDERER PROCESS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │           VRM Avatar Layer (renderer/avatar/)        │ │
│  │  • Three.js Scene (scene.ts)                         │ │
│  │  • VRM Loader (loader.ts)                            │ │
│  │  • Animation Controller (animations.ts) ← NEW        │ │
│  │  • Lip-sync Engine (lipsync.ts) ← NEW                │ │
│  │  • Cursor Follower (cursor-follower.ts) ← NEW        │ │
│  │  • Idle Behavior (idle-behavior.ts) ← NEW            │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │         Voice Pipeline (renderer/voice/)             │ │
│  │  • Gemini Client (client.ts)                         │ │
│  │  • Audio Capture (capture.ts)                        │ │
│  │  • Audio Playback (playback.ts)                      │ │
│  │  • Pipeline Orchestrator (pipeline.ts)               │ │
│  │  • Viseme Mapper (viseme-mapper.ts) ← NEW            │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              UI Layer (renderer/ui/)                 │ │
│  │  • Debug Panel (debug-panel.tsx)                     │ │
│  │  • Speech Bubbles (bubbles.tsx)                      │ │
│  │  • Update Notification (update-banner.tsx) ← NEW     │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │           State (renderer/store/)                    │ │
│  │  • Avatar Store (avatar-store.ts) ← NEW              │ │
│  │  • Performance Store (perf-store.ts) ← NEW           │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Transparent Window Architecture

```
┌─────────────────────────────────────────────┐
│        macOS/Windows/Linux Desktop         │
│                                             │
│  ┌───────────────────────────────────────┐ │
│  │   Electron BrowserWindow              │ │
│  │   • transparent: true                 │ │
│  │   • frame: false                      │ │
│  │   • alwaysOnTop: true (optional)      │ │
│  │   • hasShadow: false                  │ │
│  │   • backgroundColor: '#00000000'      │ │
│  │   • ignoreMouseEvents: true (partial) │ │
│  │                                       │ │
│  │  ┌─────────────────────────────────┐ │ │
│  │  │   React Root (#root)            │ │ │
│  │  │   • pointer-events: none        │ │ │
│  │  │                                 │ │ │
│  │  │  ┌───────────────────────────┐ │ │ │
│  │  │  │  Three.js Canvas          │ │ │ │
│  │  │  │  (transparent bg)         │ │ │ │
│  │  │  │  • VRM Avatar Mesh        │ │ │ │
│  │  │  │  • pointer-events: auto   │ │ │ │
│  │  │  └───────────────────────────┘ │ │ │
│  │  │                                 │ │ │
│  │  │  ┌───────────────────────────┐ │ │ │
│  │  │  │  UI Overlays (bubbles)    │ │ │ │
│  │  │  │  • pointer-events: auto   │ │ │ │
│  │  │  └───────────────────────────┘ │ │ │
│  │  └─────────────────────────────────┘ │ │
│  └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Key transparency mechanisms:**
- Window-level: `transparent: true`, `backgroundColor: '#00000000'`
- CSS root: `background: transparent; pointer-events: none;`
- Three.js: `renderer.setClearColor(0x000000, 0)`
- Selective interactivity: `pointer-events: auto` on avatar canvas only

## Data Model

### Avatar State (Zustand)

```typescript
interface AvatarState {
  // VRM Model
  vrmModel: VRM | null;
  modelUrl: string | null;
  isLoading: boolean;
  loadError: string | null;

  // Animation State
  currentExpression: 'neutral' | 'happy' | 'sad' | 'surprised' | 'angry' | 'blink';
  blendShapeWeights: Record<string, number>;

  // Lip-sync
  currentViseme: OculusViseme;
  visemeWeights: Float32Array; // 15 viseme blend shapes
  isSpeaking: boolean;

  // Cursor Following
  targetPosition: { x: number; y: number; z: number };
  currentPosition: { x: number; y: number; z: number };
  lookAtTarget: { x: number; y: number };
  isFollowingCursor: boolean;

  // Idle Behavior
  idleAnimationId: string | null;
  lastInteractionTime: number;
  breathingPhase: number;

  // Performance
  fps: number;
  drawCalls: number;
  memoryUsage: number;

  // Actions
  loadVRM: (url: string) => Promise<void>;
  setExpression: (expr: string, intensity?: number) => void;
  updateViseme: (viseme: OculusViseme, weight: number) => void;
  setCursorPosition: (x: number, y: number) => void;
  startIdleAnimation: (animId: string) => void;
  stopIdleAnimation: () => void;
}
```

### Performance Metrics (Zustand)

```typescript
interface PerformanceState {
  // Frame timing
  fps: number;
  frameTime: number; // ms

  // Memory
  jsHeapSize: number; // bytes
  totalMemory: number; // bytes

  // GPU
  drawCalls: number;
  triangles: number;
  textures: number;

  // Alerts
  isLagging: boolean; // FPS < 30
  isMemoryHigh: boolean; // > 500MB

  // Actions
  updateMetrics: (metrics: Partial<PerformanceState>) => void;
  resetMetrics: () => void;
}
```

### Update State (Main Process)

```typescript
interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  downloadProgress: number; // 0-100
  autoUpdateEnabled: boolean;
  lastCheckTime: number;
}
```

## Features

### 1. VRM Avatar System

**1.1 VRM Model Loading**
- Load VRM 1.0/3.0 models from local file or URL
- Validate VRM structure (humanoid bones, blend shapes)
- Optimize mesh geometry (merge materials, reduce draw calls)
- Pre-cache textures and materials
- Error handling for corrupt/invalid VRM files

**1.2 Avatar Rendering**
- Three.js WebGL renderer with transparency
- PBR materials with tone mapping
- Soft shadows (VSM or PCF)
- Rim lighting for better visibility on varied backgrounds
- Automatic LOD based on window size
- 60 FPS target, graceful degradation to 30 FPS on low-end hardware

**1.3 Expressions & Blend Shapes**
- Preset expressions: neutral, happy, sad, surprised, angry, thinking
- Smooth transitions (200ms ease-in-out)
- Blink animation (random intervals: 2-6s, 100ms blink duration)
- Micro-expressions during idle (subtle eyebrow/mouth movements)

### 2. Lip-sync Engine (Advanced Implementation)

**2.1 Viseme Mapping (Oculus Standard - 15 Phonemes)**
Map audio phonemes to Oculus visemes with weighted blending:

| Viseme | Phonemes | VRM Blend Shapes | Weight Formula |
|--------|----------|------------------|----------------|
| `sil` | silence | `aa: 0, oh: 0` | Base state |
| `PP` | p, b, m | `aa: 0, oh: 0` | Lips closed |
| `FF` | f, v | `aa: 0.3, oh: 0` | Upper teeth on lower lip |
| `TH` | th (voiced/unvoiced) | `aa: 0.2, oh: 0` | Tongue between teeth |
| `DD` | d, t, n | `aa: 0.4, oh: 0` | Tongue on alveolar ridge |
| `kk` | k, g | `aa: 0.3, oh: 0.2` | Back of tongue raised |
| `CH` | ch, j, sh, zh | `aa: 0.5, oh: 0.3` | Lips protruded |
| `SS` | s, z | `aa: 0.2, oh: 0` | Teeth together, air flow |
| `nn` | n, ng | `aa: 0.3, oh: 0` | Nasal resonance |
| `RR` | r | `aa: 0.4, oh: 0.2` | Tongue curled |
| `aa` | a (father) | `aa: 0.8, oh: 0` | Jaw open wide |
| `E` | e (bed) | `aa: 0.5, oh: 0` | Jaw mid-open |
| `I` | i (see) | `aa: 0.3, oh: 0` | Jaw slightly open |
| `O` | o (note) | `aa: 0.4, oh: 0.6` | Lips rounded |
| `U` | u (moon) | `aa: 0.2, oh: 0.8` | Lips pursed tight |

**2.2 Real-time Audio Analysis Pipeline**
```typescript
// Three-stage processing pipeline
class LipSyncEngine {
  // Stage 1: Audio Feature Extraction
  async extractFeatures(audioChunk: Float32Array): Promise<AudioFeatures> {
    const fft = this.audioContext.createAnalyser();
    fft.fftSize = 2048;
    const frequencyData = new Uint8Array(fft.frequencyBinCount);
    fft.getByteFrequencyData(frequencyData);

    // Extract formants (F1, F2, F3) for vowel detection
    const formants = this.detectFormants(frequencyData);
    // Extract amplitude envelope for consonant timing
    const amplitude = this.calculateRMS(audioChunk);

    return { formants, amplitude, spectralCentroid };
  }

  // Stage 2: Viseme Inference (Lightweight ML or Rule-based)
  async inferViseme(features: AudioFeatures): Promise<VisemeFrame> {
    // Option A: ONNX Runtime Web (15KB model, <1ms inference)
    const visemeProbs = await this.onnxSession.run({ input: features });
    const topViseme = argmax(visemeProbs);

    // Option B: Rule-based fallback (formant frequencies → vowels)
    if (!this.onnxSession) {
      return this.ruleBasedViseme(features);
    }

    return { viseme: topViseme, confidence: visemeProbs[topViseme], timestamp: Date.now() };
  }

  // Stage 3: Smooth Blending
  applyViseme(frame: VisemeFrame) {
    const targetWeights = VISEME_TO_VRM_MAP[frame.viseme];

    // Smooth transition (50ms exponential moving average)
    for (const [blendShape, targetWeight] of Object.entries(targetWeights)) {
      const currentWeight = this.currentWeights[blendShape] || 0;
      const alpha = 0.3; // Smoothing factor
      const smoothedWeight = alpha * targetWeight + (1 - alpha) * currentWeight;

      this.vrm.expressionManager.setValue(blendShape, smoothedWeight);
      this.currentWeights[blendShape] = smoothedWeight;
    }
  }
}
```

**2.3 Advanced Viseme Features**
- **Coarticulation**: Blend adjacent visemes (e.g., "ba" blends `PP` → `aa`)
- **Emotion modulation**: Scale viseme intensity based on current expression (happy = wider smile during `E`)
- **Predictive buffering**: Analyze next 100ms of audio to pre-calculate visemes (reduce lag)
- **Jaw coupling**: Automatically adjust jaw bone rotation based on `aa` weight
- **Tongue visibility**: Control tongue mesh visibility for `TH`, `DD`, `RR` visemes (if VRM has tongue)

**2.4 Fallback Modes**
1. **ML Model Unavailable**: Rule-based formant analysis (F1/F2 frequency mapping)
2. **Low CPU Mode**: Amplitude-only (mouth opens proportional to volume)
3. **No Audio Analysis**: Text-based viseme timing from Gemini transcript (if available)

**2.5 VRM Blend Shape Compatibility**
- **Standard VRM 1.0**: Uses `aa`, `ih`, `ou`, `ee`, `oh` (5 shapes)
- **Full Oculus Set**: Requires custom blend shapes (can be added via Blender)
- **Automatic Remapping**: Config file maps available shapes to closest Oculus visemes

### 3. Cursor Following & Positioning (Physics-Based)

**3.1 Advanced Cursor Tracking**
```typescript
class CursorFollower {
  private position = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };

  // Spring-damper system for smooth pursuit
  update(delta: number, cursorPos: { x: number; y: number }) {
    this.target = cursorPos;

    // Hooke's law: F = -k * displacement
    const springConstant = 0.15; // Stiffness (higher = snappier)
    const dampingFactor = 0.8;   // Damping (higher = less oscillation)

    const dx = this.target.x - this.position.x;
    const dy = this.target.y - this.position.y;

    // Apply spring force
    this.velocity.x += dx * springConstant;
    this.velocity.y += dy * springConstant;

    // Apply damping
    this.velocity.x *= dampingFactor;
    this.velocity.y *= dampingFactor;

    // Update position
    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;

    // Constrain to screen bounds with soft margins
    this.applyBoundaryForces();

    return this.position;
  }

  private applyBoundaryForces() {
    const margin = 100; // px from edge
    const screen = getCurrentScreen();

    // Soft boundary repulsion (exponential force near edges)
    if (this.position.x < margin) {
      this.velocity.x += (margin - this.position.x) * 0.1;
    }
    if (this.position.x > screen.width - margin) {
      this.velocity.x -= (this.position.x - (screen.width - margin)) * 0.1;
    }
    // Similar for Y axis...
  }
}
```

**3.2 Eye & Head Inverse Kinematics (IK)**
```typescript
class GazeController {
  // Two-stage IK: eyes follow first, then head follows with lag
  updateGaze(cursorWorldPos: Vector3, avatar: VRM) {
    const head = avatar.humanoid.getBoneNode('head');
    const leftEye = avatar.humanoid.getBoneNode('leftEye');
    const rightEye = avatar.humanoid.getBoneNode('rightEye');

    // Calculate look direction
    const lookDir = cursorWorldPos.clone().sub(head.position).normalize();

    // Apply constraints (anatomical limits)
    const clampedDir = this.clampGazeDirection(lookDir, {
      maxHorizontal: 45 * Math.PI / 180, // ±45°
      maxVertical: 30 * Math.PI / 180,   // ±30°
      maxRoll: 10 * Math.PI / 180,       // ±10° tilt
    });

    // Eyes follow immediately (no lag)
    if (leftEye && rightEye) {
      leftEye.lookAt(cursorWorldPos);
      rightEye.lookAt(cursorWorldPos);
    }

    // Head follows with 200ms lag (smooth interpolation)
    const targetHeadRot = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, -1), // Forward vector
      clampedDir
    );
    head.quaternion.slerp(targetHeadRot, 0.1); // 10% blend per frame
  }

  // Convert 2D cursor → 3D world position
  private screenToWorld(cursorX: number, cursorY: number, camera: Camera): Vector3 {
    const ndc = {
      x: (cursorX / window.innerWidth) * 2 - 1,
      y: -(cursorY / window.innerHeight) * 2 + 1,
    };

    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, camera);

    // Project onto virtual plane at avatar's depth
    const plane = new Plane(new Vector3(0, 0, 1), 0);
    const intersection = new Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    return intersection;
  }
}
```

**3.3 Multi-Monitor Smart Positioning**
```typescript
class PositionManager {
  // Track which monitor the cursor is on
  private currentDisplay: Electron.Display;

  updatePosition(cursorPos: { x: number; y: number }) {
    const displays = screen.getAllDisplays();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPos);

    // Detect monitor switch
    if (activeDisplay.id !== this.currentDisplay?.id) {
      this.onMonitorSwitch(activeDisplay);
    }

    // Constrain to active display bounds
    const bounds = activeDisplay.workArea; // Excludes taskbar/menu bar
    const constrainedPos = {
      x: Math.max(bounds.x + 100, Math.min(cursorPos.x, bounds.x + bounds.width - 100)),
      y: Math.max(bounds.y + 100, Math.min(cursorPos.y, bounds.y + bounds.height - 100)),
    };

    // Handle DPI scaling (4K/Retina displays)
    const scaleFactor = activeDisplay.scaleFactor;
    const scaledPos = {
      x: constrainedPos.x / scaleFactor,
      y: constrainedPos.y / scaleFactor,
    };

    return scaledPos;
  }

  private onMonitorSwitch(newDisplay: Electron.Display) {
    // Smoothly transition avatar to new monitor
    this.currentDisplay = newDisplay;
    // Reset velocity to avoid huge jumps
    this.velocity = { x: 0, y: 0 };
  }
}
```

**3.4 User Dragging (Manual Override)**
- Hold **Cmd/Ctrl + Left Mouse** on avatar → drag to new position
- Snap to grid (optional, 50px increments)
- Show "ghost" outline during drag
- Release → spring back slightly (tactile feedback)
- Persist position in config file

**3.5 Idle Positioning Behavior**
- **Home position**: Bottom-right corner (or user-defined)
- **Floating animation**: Gentle sine wave (amplitude: 5px, period: 4s)
- **Auto-return**: After 30s of no cursor movement, slowly drift back to home
- **Screen edge affinity**: Avatar prefers corners/edges (feels more "tucked away")

### 4. Idle Behavior System

**4.1 Idle Animations**
- **Breathing**: Chest/spine subtle expansion (1.0-1.02 scale, 3s period)
- **Weight shifting**: Hip sway (±2° rotation, random intervals 10-20s)
- **Looking around**: Random look targets (every 5-10s, 1s transition)
- **Micro-gestures**: Small hand/finger movements (every 15-30s)
- **Blinking**: Random blinks (2-6s intervals)

**4.2 Activity Detection**
- User speaking → alert expression + look at mic icon
- Gemini responding → attentive expression + mouth animation
- Tool executing → thinking expression + subtle head tilt
- No activity for 2min → deeper idle state (slouch posture, slower breathing)

**4.3 Configurable Behavior**
- Enable/disable individual idle animations
- Adjust animation intensity (0.0-1.0 scale)
- Set idle timeout thresholds
- Custom animation presets via JSON

### 5. Voice Integration (Enhanced Existing)

**5.1 Lip-sync Pipeline**
- Hook into `AudioPlayback.enqueue()` in `voice/playback.ts`
- Analyze audio chunks in real-time (FFT → formants → visemes)
- Send viseme weights to avatar store
- Sync viseme playback with audio timing (±10ms accuracy)

**5.2 Visual Feedback**
- Avatar mouth opens when user speaks (based on mic volume)
- Avatar speaks with lip-sync during Gemini responses
- Expression changes based on conversation state:
  - User speaking → listening expression (slight smile, attentive eyes)
  - Processing → thinking expression (raised eyebrow)
  - Responding → talking expression (dynamic visemes)

### 6. Transparency & Click-Through

**6.1 Window Configuration**
```typescript
new BrowserWindow({
  width: 400,
  height: 600,
  transparent: true,
  frame: false,
  alwaysOnTop: true, // User-configurable
  hasShadow: false,
  backgroundColor: '#00000000',
  webPreferences: {
    backgroundThrottling: false, // Prevent animation freeze
  }
})
```

**6.2 Click-Through Regions**
- Avatar canvas: interactive (can click to activate voice)
- UI overlays: interactive (bubbles, debug panel)
- Transparent areas: click-through via `setIgnoreMouseEvents(true, { forward: true })`
- Auto-detect interactive regions using DOM hit testing

**6.3 macOS-Specific**
- Use `NSWindow.isOpaque = false` for true transparency
- Handle Spaces/Mission Control (window restores position on workspace switch)
- Menu bar integration (optional status bar icon)

### 7. Auto-Update System

**7.1 Update Detection**
- Check GitHub Releases on app start (debounce: 24h)
- Manual check via menu item
- Compare semantic versions
- Parse release notes from GitHub

**7.2 Download & Install**
- Background download via `electron-updater`
- Progress notification (banner UI with percentage)
- Verify download signature (code signing)
- Prompt user to restart or defer

**7.3 Rollback Safety**
- Keep previous version backup
- Auto-rollback on crash during first 5 min after update
- User can manually revert to previous version

**7.4 Update Channels**
- `stable` (default): production releases
- `beta`: pre-release builds
- `dev`: nightly builds (opt-in)

### 8. Performance Optimization

**8.1 Rendering Optimizations**
- Frustum culling (don't render off-screen avatar parts)
- Texture compression (KTX2/Basis Universal)
- Geometry instancing for repeated meshes
- Conditional rendering: pause Three.js render loop when window hidden
- Target 60 FPS, degrade gracefully:
  - < 45 FPS: disable shadows
  - < 30 FPS: reduce texture resolution
  - < 20 FPS: disable idle animations

**8.2 Memory Management**
- Dispose Three.js resources on VRM unload
- Limit audio buffer size (max 5s of playback queued)
- Monitor JS heap size, warn if > 500MB
- Force GC on idle (via `--expose-gc` flag)

**8.3 CPU Optimization**
- Offload lip-sync ML inference to Web Worker
- Throttle cursor position updates (max 60 Hz)
- Debounce window resize events (100ms)
- Use `requestIdleCallback` for non-critical tasks

**8.4 Performance Monitoring**
- Built-in FPS counter (debug panel)
- Memory profiler (heap snapshots)
- GPU usage metrics (via Chrome DevTools Protocol)
- Send telemetry to main process (alerts if performance degrades)

## API Design

### Main Process IPC Handlers

```typescript
// src/main/ipc.ts

// Auto-Update
ipcMain.handle('updater:check', async () => {
  return await autoUpdater.checkForUpdates();
});

ipcMain.handle('updater:download', async () => {
  return await autoUpdater.downloadUpdate();
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.on('updater:enable-auto', (_, enabled: boolean) => {
  store.set('autoUpdate', enabled);
});

// Performance
ipcMain.handle('perf:get-metrics', async () => {
  const cpuUsage = process.getCPUUsage();
  const memUsage = process.getSystemMemoryInfo();
  return { cpuUsage, memUsage };
});

// Avatar Settings
ipcMain.handle('avatar:load-vrm', async (_, url: string) => {
  // Download VRM if URL, or read from disk
  const buffer = await fetchVRM(url);
  return { data: buffer, success: true };
});

ipcMain.handle('avatar:get-config', async () => {
  return store.get('avatarConfig') || defaultConfig;
});

ipcMain.handle('avatar:save-config', async (_, config: AvatarConfig) => {
  store.set('avatarConfig', config);
});

// Cursor Position (throttled 60 Hz)
ipcMain.on('cursor:request-position', (event) => {
  const { x, y } = screen.getCursorScreenPoint();
  event.reply('cursor:position', { x, y });
});
```

### Renderer API (Preload)

```typescript
// src/preload.ts

contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing API ...

  // Auto-Update
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable: (cb: (info: UpdateInfo) => void) =>
      ipcRenderer.on('update-available', (_, info) => cb(info)),
    onDownloadProgress: (cb: (progress: number) => void) =>
      ipcRenderer.on('download-progress', (_, p) => cb(p)),
  },

  // Performance
  performance: {
    getMetrics: () => ipcRenderer.invoke('perf:get-metrics'),
  },

  // Avatar
  avatar: {
    loadVRM: (url: string) => ipcRenderer.invoke('avatar:load-vrm', url),
    getConfig: () => ipcRenderer.invoke('avatar:get-config'),
    saveConfig: (config: AvatarConfig) =>
      ipcRenderer.invoke('avatar:save-config', config),
  },

  // Cursor
  cursor: {
    requestPosition: () => ipcRenderer.send('cursor:request-position'),
    onPosition: (cb: (pos: { x: number, y: number }) => void) =>
      ipcRenderer.on('cursor:position', (_, pos) => cb(pos)),
  },
});
```

### Avatar Store (Zustand)

```typescript
// src/renderer/store/avatar-store.ts

import { create } from 'zustand';
import { VRM, VRMExpressionPresetName } from '@pixiv/three-vrm';

interface AvatarStore {
  vrm: VRM | null;
  isLoading: boolean;
  error: string | null;

  currentExpression: VRMExpressionPresetName;
  visemeWeights: Map<string, number>;

  cursorPosition: { x: number; y: number };
  lookAtTarget: { x: number; y: number; z: number };

  loadVRM: (url: string) => Promise<void>;
  setExpression: (name: VRMExpressionPresetName, weight?: number) => void;
  updateViseme: (viseme: string, weight: number) => void;
  updateCursorPosition: (x: number, y: number) => void;
}

export const useAvatarStore = create<AvatarStore>((set, get) => ({
  vrm: null,
  isLoading: false,
  error: null,
  currentExpression: 'neutral',
  visemeWeights: new Map(),
  cursorPosition: { x: 0, y: 0 },
  lookAtTarget: { x: 0, y: 0, z: -1 },

  loadVRM: async (url: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await window.electronAPI.avatar.loadVRM(url);
      const loader = new VRMLoader();
      const vrm = await loader.parseAsync(data);
      set({ vrm, isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  setExpression: (name, weight = 1.0) => {
    const { vrm } = get();
    if (!vrm?.expressionManager) return;
    vrm.expressionManager.setValue(name, weight);
    set({ currentExpression: name });
  },

  updateViseme: (viseme, weight) => {
    const { vrm, visemeWeights } = get();
    visemeWeights.set(viseme, weight);
    // Apply to VRM blend shapes
    if (vrm?.expressionManager) {
      const mapping = VISEME_TO_VRM_MAP[viseme];
      if (mapping) {
        vrm.expressionManager.setValue(mapping, weight);
      }
    }
    set({ visemeWeights: new Map(visemeWeights) });
  },

  updateCursorPosition: (x, y) => {
    const { lookAtTarget } = get();
    // Convert screen coords to 3D target
    const target = screenToWorld(x, y);
    set({ cursorPosition: { x, y }, lookAtTarget: target });
  },
}));
```

## Edge Cases

### 1. VRM Loading Failures
- **Invalid VRM**: Show error message, fallback to default cube avatar
- **Network timeout**: Retry 3 times with exponential backoff (1s, 2s, 4s)
- **Corrupt file**: Validate VRM structure, show detailed error in debug panel
- **Missing blend shapes**: Disable lip-sync, log warning
- **Missing bones**: Disable IK, log warning

### 2. Transparency Issues
- **Linux (X11)**: Transparency may not work → show warning, offer opaque mode
- **Windows 7**: Use Aero blur fallback instead of true transparency
- **macOS dark mode**: Avatar may blend into dark backgrounds → add subtle rim light

### 3. Performance Degradation
- **Low FPS (<20)**: Auto-disable shadows, idle animations, reduce texture resolution
- **High memory (>500MB)**: Force GC, warn user, offer "lite mode"
- **GPU crash**: Fallback to 2D canvas rendering (sprite-based avatar)

### 4. Audio Sync Issues
- **Lip-sync lag**: Buffer visemes 50ms ahead to compensate for audio latency
- **Audio glitches**: Drop audio chunks if playback buffer > 2s
- **Mic permission denied**: Disable voice input, show setup instructions

### 5. Multi-Monitor
- **Cursor moves to another screen**: Reposition avatar to stay near cursor (cross-screen)
- **Screen disconnect**: Move avatar to primary monitor
- **DPI mismatch**: Recalculate coordinates using `screen.getPrimaryDisplay().scaleFactor`

### 6. Auto-Update
- **Download interrupted**: Resume download from last chunk (HTTP range requests)
- **Signature verification fails**: Delete corrupted update, notify user
- **Update crashes app**: Auto-rollback to previous version on next launch
- **No internet**: Gracefully skip update check, retry on next app start

### 7. Click-Through
- **Avatar too small to click**: Expand hitbox by 20px on all sides
- **UI overlaps avatar**: Z-index management (avatar: 100, bubbles: 200)
- **macOS Spaces**: Re-register click-through regions on workspace switch

## Acceptance Criteria

### Functional Requirements

✅ **VRM Avatar**
- [ ] Loads VRM 1.0/3.0 models from URL or local file
- [ ] Displays in transparent window with no background artifacts
- [ ] Renders at 60 FPS on modern hardware (2020+ MacBook Pro/equivalent)
- [ ] Supports custom VRM models via drag-and-drop

✅ **Cursor Following**
- [ ] Avatar eyes/head follow cursor within ±45° horizontal, ±30° vertical
- [ ] Smooth pursuit with <100ms lag
- [ ] Stays within screen bounds on all monitors
- [ ] User can drag avatar to new position (Cmd/Ctrl + drag)

✅ **Idle Behavior**
- [ ] Breathing animation active when idle (3s period)
- [ ] Random blinks every 2-6 seconds
- [ ] Looks around randomly every 5-10 seconds
- [ ] Returns to home position after 30s of no cursor activity

✅ **Lip-sync**
- [ ] Mouth moves in sync with Gemini TTS audio (±50ms accuracy)
- [ ] Supports 15 Oculus visemes
- [ ] Smooth transitions between visemes (<50ms)
- [ ] Fallback to amplitude-based if ML model unavailable

✅ **Voice Integration**
- [ ] Existing Gemini voice pipeline continues to work
- [ ] Avatar expression changes during conversation states:
  - Listening → attentive expression
  - Processing → thinking expression
  - Responding → talking with lip-sync
- [ ] User speaking triggers visual feedback (mic icon + alert expression)

✅ **Transparency**
- [ ] Window background fully transparent (no white/black artifacts)
- [ ] Avatar canvas is clickable
- [ ] Transparent areas are click-through
- [ ] Works on macOS, Windows 10/11, Linux (Wayland/X11 with warnings)

✅ **Performance**
- [ ] Maintains 60 FPS during normal use
- [ ] Degrades gracefully to 30 FPS on low-end hardware
- [ ] Memory usage <300MB (idle), <500MB (active conversation)
- [ ] CPU usage <5% (idle), <15% (active conversation)

✅ **Auto-Update**
- [ ] Checks for updates on app start (max once per 24h)
- [ ] Downloads updates in background
- [ ] Shows progress notification
- [ ] Prompts user to restart when ready
- [ ] Auto-rollback on crash after update

✅ **Developer Experience**
- [ ] Hot-reload tool modules (existing behavior preserved)
- [ ] Debug panel shows FPS, memory, performance metrics
- [ ] TypeScript strict mode with zero errors
- [ ] Biome linting passes with zero warnings
- [ ] All IPC handlers have type-safe contracts

### Non-Functional Requirements

✅ **Reliability**
- [ ] App crashes <1 time per 100 hours of use
- [ ] WebSocket reconnects automatically on network failure
- [ ] VRM loading succeeds 99% of time for valid files

✅ **Usability**
- [ ] Initial setup <2 minutes (download app, launch, grant permissions)
- [ ] Avatar visible within 5 seconds of app launch
- [ ] Voice activation via Ctrl+I works 100% of time
- [ ] Update install completes in <1 minute

✅ **Compatibility**
- [ ] macOS 11+ (Intel & Apple Silicon)
- [ ] Windows 10/11 (x64, ARM64)
- [ ] Linux (Ubuntu 22.04+, Wayland/X11)

✅ **Accessibility**
- [ ] User can disable animations (reduce motion)
- [ ] User can adjust avatar size (50%-200%)
- [ ] User can toggle always-on-top
- [ ] Keyboard shortcuts documented in help menu

## Implementation Plan

### Phase 1: VRM Integration (Week 1-2)
1. Install Three.js, @pixiv/three-vrm dependencies
2. Create VRM loader module (`renderer/avatar/loader.ts`)
3. Set up Three.js scene with transparent background
4. Integrate VRM rendering into existing avatar window
5. Implement basic expression system (preset emotions)

### Phase 2: Cursor Following (Week 2-3)
6. Add cursor position IPC handlers (main → renderer)
7. Implement smooth pursuit algorithm with spring physics
8. Add eye/head IK using VRM humanoid bones
9. Implement smart positioning (screen bounds, multi-monitor)
10. Add drag-to-reposition feature

### Phase 3: Idle Behavior (Week 3-4)
11. Create idle animation system (breathing, blinking, looking around)
12. Implement activity detection (voice, tool execution)
13. Add configurable behavior presets
14. Integrate with voice pipeline state machine

### Phase 4: Lip-sync (Week 4-5)
15. Research + integrate lightweight ONNX viseme model (or fallback to amplitude-based)
16. Create viseme mapper (audio → Oculus visemes → VRM blend shapes)
17. Hook into AudioPlayback.enqueue() for real-time analysis
18. Sync viseme playback with audio timing
19. Test accuracy with various TTS voices

### Phase 5: Auto-Update (Week 5-6)
20. Set up electron-updater with GitHub Releases
21. Configure electron-builder for code signing
22. Implement update detection + download UI
23. Add rollback mechanism
24. Test update flow on all platforms

### Phase 6: Performance Optimization (Week 6-7)
25. Implement FPS-based quality degradation
26. Add memory monitoring + alerts
27. Offload lip-sync ML to Web Worker
28. Profile + optimize Three.js render loop
29. Add performance metrics to debug panel

### Phase 7: Polish & Testing (Week 7-8)
30. Cross-platform testing (macOS, Windows, Linux)
31. Accessibility features (reduce motion, size adjustment)
32. User documentation + help menu
33. CI/CD for automated builds + releases
34. Beta testing with 10+ users

## Configuration Files

### `avatarConfig.json` (User Settings)

```json
{
  "vrmModelUrl": "https://example.com/avatar.vrm",
  "position": {
    "x": -150,
    "y": -100,
    "mode": "bottom-right"
  },
  "behavior": {
    "followCursor": true,
    "idleAnimations": true,
    "breathingIntensity": 1.0,
    "blinkFrequency": 1.0,
    "lookAroundFrequency": 1.0
  },
  "performance": {
    "targetFPS": 60,
    "maxMemoryMB": 500,
    "autoQualityAdjust": true,
    "enableShadows": true
  },
  "window": {
    "alwaysOnTop": false,
    "width": 400,
    "height": 600,
    "opacity": 1.0
  },
  "updates": {
    "autoUpdate": true,
    "channel": "stable",
    "checkInterval": 86400000
  }
}
```

### `visemeMapping.json` (Viseme → VRM Blend Shape)

```json
{
  "sil": "neutral",
  "PP": "mouthClose",
  "FF": "mouthLowerDown",
  "TH": "mouthUpperUp",
  "DD": "mouthOpen",
  "kk": "mouthOpen",
  "CH": "mouthSmile",
  "SS": "mouthSmile",
  "nn": "mouthClose",
  "RR": "mouthOpen",
  "aa": "mouthOpen",
  "E": "mouthSmile",
  "I": "mouthSmile",
  "O": "mouthRound",
  "U": "mouthRound"
}
```

## Build & Deployment

### Development

```bash
# Install dependencies
bun install

# Start Electron in dev mode (auto-reload)
bun run dev

# Lint & format
bun run lint
bun run format

# Type check
bun run typecheck
```

### Production Build

```bash
# Build for current platform
bun run build

# Build for all platforms (macOS, Windows, Linux)
bun run build:all

# Build + publish to GitHub Releases
bun run release
```

### electron-builder Config

```json
{
  "appId": "com.iris-chan.desktop",
  "productName": "Iris-chan",
  "directories": {
    "output": "dist"
  },
  "files": [
    "src/**/*",
    "assets/**/*",
    "!**/*.ts",
    "!**/*.map"
  ],
  "mac": {
    "target": ["dmg", "zip"],
    "category": "public.app-category.productivity",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "win": {
    "target": ["nsis", "portable"],
    "icon": "assets/icon.ico"
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "category": "Utility"
  },
  "publish": {
    "provider": "github",
    "owner": "your-username",
    "repo": "iris-chan"
  }
}
```

### GitHub Actions (CI/CD)

```yaml
name: Build & Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run build
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-build
          path: dist/*
```

## Dependencies

### Production

```json
{
  "dependencies": {
    "electron": "^40.4.1",
    "electron-updater": "^7.2.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "three": "^0.175.0",
    "@pixiv/three-vrm": "^3.6.0",
    "zustand": "^5.0.3"
  }
}
```

### Development

```json
{
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "electron-builder": "^25.4.0",
    "typescript": "^5.8.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/three": "^0.175.0",
    "tailwindcss": "^4.1.0"
  }
}
```

---

**Generated:** 2026-02-14
**Version:** 1.0.0
**Status:** Ready for Implementation
