
╔═══════════════════════════════════════════════════════════════════╗
║                    IRIS-CHAN v2 ARCHITECTURE                      ║
║         Modular AI Desktop Assistant · Electron + Bun            ║
║         17 standalone modules · typed message bus                ║
╚═══════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────┐
│                     USER INPUT LAYER                            │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ Mic 🎤   │  │ Screen 🖥│  │ Keyboard  │  │ Clipboard    │  │
│  │ 16kHz    │  │ Retina   │  │ Mouse     │  │ URL monitor  │  │
│  │ PCM16    │  │ normalize│  │ HID idle  │  │ 5s poll      │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
└───────┼──────────────┼──────────────┼───────────────┼───────────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│               RENDERER PROCESS (Electron BrowserWindow)         │
│               transparent · always-on-top · frameless           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              THREE.JS AVATAR ENGINE                      │   │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────────────┐ │   │
│  │  │ Scene   │  │ VRM/glTF │  │ Procedural Overlays    │ │   │
│  │  │ 30° FOV │  │ Loader   │  │ • head look (3-axis)   │ │   │
│  │  │ 22% ←   │  │ tripo3d/ │  │ • blink (6s cycle)     │ │   │
│  │  │ offset  │  │ original │  │ • lip sync (vol→aa/oh) │ │   │
│  │  └─────────┘  └──────────┘  │ • smile (speaking +15%)│ │   │
│  │                              └────────────────────────┘ │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ REACTIVE LIGHT RIG                              │    │   │
│  │  │ cool 0x84ddff ◄──► warm 0xffd2a6               │    │   │
│  │  │ thinking: pulse 0.78Hz │ speaking: vol-damped   │    │   │
│  │  │ idle: drift 0.27-0.47Hz                         │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────── UI OVERLAY ──────────────────────────┐   │
│  │                                                          │   │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐ │   │
│  │  │ Bubbles  │  │ Timeline  │  │ Debug Panel (10 dots) │ │   │
│  │  │ 3 lanes: │  │ 30 events │  │ WS MIC VOICE SEND    │ │   │
│  │  │ chat     │  │ phase-    │  │ THINK SPEAK TOOL      │ │   │
│  │  │ context  │  │ colored   │  │ SRCH AUTO 2FA         │ │   │
│  │  │ thinking │  │ cards     │  └──────────────────────┘ │   │
│  │  └──────────┘  └───────────┘  ┌──────────────────────┐ │   │
│  │  ┌──────────┐  ┌───────────┐  │ Tool Log (max 5)     │ │   │
│  │  │ Mute     │  │ Workspace │  │ ⟳ running → ✓ done  │ │   │
│  │  │ Badge    │  │ Bar ~/... │  │ auto-hide 2s         │ │   │
│  │  └──────────┘  └───────────┘  └──────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────── VOICE PIPELINE ─────────────────────┐   │
│  │                                                          │   │
│  │  AudioCapture ──► ListeningGate ──► VoiceEngine         │   │
│  │  (WebAudio)       (adaptive        (state machine)       │   │
│  │  16kHz PCM16      noise floor)     IDLE→LISTENING→       │   │
│  │                   180ms speech     USER_SPEAKING→         │   │
│  │  AudioPlayback ◄─ BargeInDetector  PROCESSING→           │   │
│  │  (24kHz output)   (playback-       RESPONDING→            │   │
│  │  pitch/rate       compensated      TOOL_EXECUTING         │   │
│  │  shaping)         threshold)                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────── GEMINI WEBSOCKET CLIENT ────────────────────┐   │
│  │  wss://generativelanguage.googleapis.com/.../             │   │
│  │  BidiGenerateContent                                      │   │
│  │  Model: gemini-2.5-flash-native-audio-preview             │   │
│  │                                                            │   │
│  │  ← audio (PCM16 24kHz)  → audio (PCM16 16kHz)           │   │
│  │  ← tool calls           → tool responses                 │   │
│  │  ← transcriptions       → images (JPEG base64)           │   │
│  │  ← turn complete        → text input                     │   │
│  │                                                            │   │
│  │  Fallback: full → no-voice → core-tools → compact-14k   │   │
│  │  Retry: 5 attempts, 2-30s exponential backoff            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──── window.irisBus (25-line preload) ────────────────────┐  │
│  │  .send(channel, payload)    → ipcRenderer.send()         │  │
│  │  .on(channel, handler)      → ipcRenderer.on()           │  │
│  │  .invoke(channel, payload)  → ipcRenderer.invoke()       │  │
│  └──────────────────────┬───────────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │    iris:bus-message (IPC)      │
          │    Single bidirectional        │
          │    channel (replaces 80+)      │
          └───────────────┬───────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                 MAIN PROCESS (Electron)                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    @iris/core (8 files)                     │ │
│  │                                                             │ │
│  │  main.js ──► main.ts                                       │ │
│  │    │                                                        │ │
│  │    ├─ 1. createBus()          ← typed pub/sub hub          │ │
│  │    ├─ 2. createSettingsStore() ← ~/.iris/settings.json     │ │
│  │    ├─ 3. createShell()        ← avatar window + tray       │ │
│  │    ├─ 4. createIpcBridge()    ← bus ↔ renderer bridge      │ │
│  │    ├─ 5. ModuleRegistry()     ← capability lookup          │ │
│  │    ├─ 6. createModuleLoader() ← discovery + toposort       │ │
│  │    └─ 7. loader.loadAll()     ← start all 17 modules       │ │
│  │                                                             │ │
│  │  Dev mode: file watcher → hot-reload modules (500ms)       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              @iris/bus — TYPED MESSAGE BUS                  │ │
│  │                                                             │ │
│  │  publish(channel, payload)  ──► all subscribers             │ │
│  │  subscribe(channel, handler) ── returns unsubscribe fn     │ │
│  │  request(channel, payload)  ──► single handler (10s timeout)│ │
│  │  handle(channel, handler)   ── registers RPC handler       │ │
│  │                                                             │ │
│  │  BusClient per module: auto-scoped, auto-dispose on stop() │ │
│  │  134+ named channels across 17 module namespaces           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          │                                       │
│          ┌───────────────┴───────────────────┐                  │
│          │     MODULE LOADING (toposort)      │                  │
│          │     packages/mod-*/manifest.json   │                  │
│          └───────────────┬───────────────────┘                  │
│                          │                                       │
│  ════════════════════════╪══════════════════════════════════     │
│     17 STANDALONE MODULES (each runs independently)              │
│  ════════════════════════╪══════════════════════════════════     │
│                          │                                       │
│          ┌───────────────┴──────────────────────┐               │
│          │    FIRED IN DEPENDENCY ORDER          │               │
│          └──┬───────┬───────┬───────┬───────┬───┘               │
│             │       │       │       │       │                    │
│             ▼       ▼       ▼       ▼       ▼                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TIER 0 — NO DEPENDENCIES                               │    │
│  │                                                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ settings │ │ convex   │ │ feedback │ │ macp     │  │    │
│  │  │ JSON     │ │ HTTP+    │ │ JSON     │ │ agent    │  │    │
│  │  │ hot-     │ │ retry    │ │ store    │ │ coord    │  │    │
│  │  │ reload   │ │ 4x exp   │ │          │ │ 10s poll │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TIER 1 — DEPENDS ON: settings, convex                  │    │
│  │                                                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ screen   │ │ vocab    │ │ search   │ │ coding   │  │    │
│  │  │ capture  │ │ 260+     │ │ Gemini   │ │ Claude   │  │    │
│  │  │ + Retina │ │ terms    │ │ Flash    │ │ Agent    │  │    │
│  │  │ + coords │ │ fuzzy    │ │ + vector │ │ SDK      │  │    │
│  │  │ mapping  │ │ match    │ │ + links  │ │ + learn  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TIER 2 — DEPENDS ON: screen, tools, settings           │    │
│  │                                                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ tools    │ │ gemini   │ │ voice    │ │ skills   │  │    │
│  │  │ 47 decls │ │ WS bridge│ │ state    │ │ scan     │  │    │
│  │  │ registry │ │ tool call│ │ machine  │ │ ~/.iris/ │  │    │
│  │  │ executor │ │ routing  │ │ coord    │ │ skills/  │  │    │
│  │  │ RPC disp │ │          │ │          │ │          │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TIER 3 — DEPENDS ON: automation, screen, tools, coding │    │
│  │                                                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │automation│ │ 2fa      │ │ autonomy │ │ tasks    │  │    │
│  │  │ planner  │ │ detect   │ │ Groq     │ │ queue    │  │    │
│  │  │ execute  │ │ AX+Vision│ │ intent   │ │ p0/p1/p2 │  │    │
│  │  │ verify   │ │ 6 sources│ │ predict  │ │ kanban   │  │    │
│  │  │ native   │ │ 5m cache │ │ Ghost    │ │ CRUD     │  │    │
│  │  │ actions  │ │ auto-fill│ │ drafts   │ │          │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│             │                                                    │
│             ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TIER 4 — DEPENDS ON: ALL                               │    │
│  │                                                          │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │                  mod-demo                        │    │    │
│  │  │       Hackathon Presentation Mode               │    │    │
│  │  │                                                  │    │    │
│  │  │  26 scripted steps · narrated by Iris            │    │    │
│  │  │  Trigger: "present yourself" or start_demo       │    │    │
│  │  │                                                  │    │    │
│  │  │  Phase 1: Introduction + architecture            │    │    │
│  │  │  Phase 2: Web search + person identification    │    │    │
│  │  │  Phase 3: Chess moves (vision + click)          │    │    │
│  │  │  Phase 4: Skill creation + image gen/edit       │    │    │
│  │  │  Phase 5: 2FA auto-fill from SMS               │    │    │
│  │  │  Phase 6: Recap + closing                       │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐  ┌────────────────┐  ┌───────────────────┐
│  EXTERNAL    │  │  LOCAL STATE   │  │  EXTERNAL APIS    │
│  STORAGE     │  │                │  │                   │
│              │  │  ~/.iris/      │  │  Gemini WS        │
│  Convex DB   │  │  ├ settings   │  │  (native audio)   │
│  11 tables   │  │  ├ vocab      │  │                   │
│  1024-dim    │  │  ├ feedback   │  │  Gemini Flash     │
│  vectors     │  │  ├ memory     │  │  (vision+search)  │
│              │  │  ├ patterns   │  │                   │
│  Tables:     │  │  ├ tasks      │  │  Groq LLaMA 3.3  │
│  conversa-   │  │  ├ geometry   │  │  (intent predict) │
│  tions,      │  │  ├ daily-loop │  │                   │
│  observa-    │  │  └ logs/      │  │  Ghost CMS        │
│  tions,      │  │    └ iris.log │  │  (daily drafts)   │
│  links,      │  │      (2MB     │  │                   │
│  tasks,      │  │       rotate) │  │  MACP Relay       │
│  runtime     │  │               │  │  (multi-agent)    │
│  events...   │  │               │  │                   │
└──────────────┘  └────────────────┘  └───────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     KEY DATA FLOWS                              │
│                                                                 │
│  ┌─── VOICE CONVERSATION ───────────────────────────────────┐  │
│  │                                                           │  │
│  │  Mic → AudioCapture (16kHz) → ListeningGate (VAD)       │  │
│  │    → VoiceEngine: LISTENING → USER_SPEAKING              │  │
│  │    → Gemini WS (send PCM16) → Model processes           │  │
│  │    → VoiceEngine: PROCESSING → RESPONDING                │  │
│  │    → AudioPlayback (24kHz) → Speaker                     │  │
│  │                                                           │  │
│  │  [Barge-in: mic vol > playback-compensated threshold     │  │
│  │   for 180ms → interrupt → back to USER_SPEAKING]         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── TOOL EXECUTION ──────────────────────────────────────┐   │
│  │                                                          │   │
│  │  Gemini → toolCall{id,name,args}                        │   │
│  │    → bus GEMINI_TOOL_CALL → mod-tools TOOL_EXECUTE      │   │
│  │    → RPC dispatch to tools:execute:{module}              │   │
│  │    → handler executes → result                          │   │
│  │    → bus GEMINI_TOOL_RESULT → sendToolResponse to WS    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── 2FA AUTO-FILL ──────────────────────────────────────┐    │
│  │                                                         │    │
│  │  Every 5s: gather codes (iMessage + notifications)      │    │
│  │    → detect field (AX API → heuristics → Vision)        │    │
│  │    → score confidence (length + format + context)        │    │
│  │    → if score ≥ 0.6: fill via clipboard paste           │    │
│  │    → remove code from cache (no double-fill)            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─── AUTOMATION TASK ────────────────────────────────────┐    │
│  │                                                         │    │
│  │  Goal → PlanningEngine (decompose to steps)             │    │
│  │    → ExecutionPolicy (native/browser/TARS routing)      │    │
│  │    → For each step: execute → verify (screenshot+vision)│    │
│  │    → InputMonitor: abort if user active (HID idle<500ms)│    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─── AUTONOMY LOOP ─────────────────────────────────────┐     │
│  │                                                        │     │
│  │  Every 10s: Groq LLaMA → classify intent (LRU cached) │     │
│  │  Every 1h:  Ghost CMS → daily engineering draft        │     │
│  │  On screen: ProactiveEngine → suggest actions          │     │
│  └────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════════════════════╗
║                IRIS-CHAN v2 — ARCHITECTURE SUMMARY                ║
║                                                                   ║
║  User Input ──► Renderer (Three.js + WebAudio + Gemini WS)      ║
║                    │                                              ║
║            iris:bus-message (single IPC)                          ║
║                    │                                              ║
║  Core Shell ──► Bus ──► 17 Modules (toposort loaded)             ║
║                    │                                              ║
║       ┌────────────┼────────────────────────┐                    ║
║       ▼            ▼            ▼           ▼                    ║
║    Voice &      Desktop     Intelligence  Data &                 ║
║    Gemini       Automation  (intent,      Persistence            ║
║    (full-       (plan →     autonomy,     (Convex,               ║
║    duplex,      execute →   coding,       settings,              ║
║    barge-in)    verify)     2FA, skills)  vocab)                 ║
║                                                                   ║
║  Stack: Electron · Bun · Three.js · Gemini · Groq · Convex     ║
║  Files: 151 source · 110 TypeScript · 20 packages               ║
║  Boot:  17 modules loaded in ~130ms                              ║
║  Demo:  26-step narrated hackathon presentation                  ║
╚═══════════════════════════════════════════════════════════════════╝
