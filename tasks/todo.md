# Iris-chan v2 — Clean Rebuild Plan

## Context

Iris-chan is a ~160-file Electron desktop AI assistant with tangled dependencies, a god-file bootstrap, a service locator anti-pattern, and two competing IPC layers. The goal is to rebuild from scratch in a separate folder with identical features but a modular architecture where:
- The core (Electron shell + avatar) **never reloads** when modules change
- Every module is **standalone** (runs alone as a Node process OR loaded by Iris)
- Modules communicate only through a typed **message bus** — no direct imports between modules

---

## Architecture Overview

```
iris-v2/
├── packages/
│   ├── core/          # Electron shell — NEVER changes for feature work
│   ├── bus/           # Shared message bus protocol (no Electron dep)
│   ├── renderer/      # Avatar window + UI components
│   │
│   ├── mod-settings/  # Settings persistence + hot-reload broadcast
│   ├── mod-convex/    # Convex client + all table adapters
│   ├── mod-feedback/  # Feedback collection + persistence
│   ├── mod-vocab/     # Vocabulary learning + fuzzy matching
│   ├── mod-search/    # Web search + semantic search + link capture
│   ├── mod-skills/    # Custom JS skills from ~/.iris/skills/
│   ├── mod-screen/    # Screenshot capture + Gemini vision
│   ├── mod-gemini/    # Gemini WebSocket client + tool dispatch
│   ├── mod-voice/     # Full-duplex voice pipeline
│   ├── mod-automation/# Desktop automation (click, type, plan, verify)
│   ├── mod-tools/     # Tool registry + execution dispatcher
│   ├── mod-2fa/       # 2FA detection + auto-fill
│   ├── mod-coding/    # Claude Agent SDK + self-improvement
│   ├── mod-autonomy/  # Intent prediction + proactive suggestions + daily loop
│   ├── mod-tasks/     # Task queue + kanban window
│   └── mod-macp/      # Multi-agent coordination
│
├── convex/            # Convex schema + functions (carried over)
├── assets/            # VRM models, icons (carried over)
└── package.json       # Bun workspace root
```

---

## 1. Core Shell (`packages/core/`)

Minimal Electron app — does exactly 5 things:

1. Creates avatar BrowserWindow (transparent, always-on-top, Three.js)
2. Creates the MessageBus (main-process event hub)
3. Discovers & loads modules from `packages/mod-*/`
4. Bridges bus ↔ renderer via a single IPC channel
5. Manages app lifecycle (single-instance lock, permissions, quit)

**Core never imports any module code.** It only knows the `IrisModule` interface.

### Files
- `main.ts` — Entry (~30 lines): env, single-instance lock, GPU flags, boot
- `shell.ts` — BrowserWindow creation, display tracking, geometry persistence
- `module-loader.ts` — Scan `packages/mod-*/manifest.json`, topological sort by deps, dynamic require, start/stop/reload
- `module-registry.ts` — Map of loaded modules + capabilities
- `bus.ts` — Main-process MessageBus implementation
- `ipc-bridge.ts` — Single bidirectional IPC channel (`iris:bus-message`) connecting bus ↔ renderer
- `preload.ts` — ~25 lines: exposes `window.irisBus.send()`, `.on()`, `.invoke()`
- `settings-store.ts` — JSON file persistence for core-only settings (geometry, etc.)
- `logger.ts` — Unified scoped logger
- `types.ts` — `IrisModule`, `ModuleManifest`, `ModuleContext`, `BusClient` interfaces

---

## 2. Module Contract

Every module implements:

```ts
interface IrisModule {
  manifest: ModuleManifest;
  start(ctx: ModuleContext): Promise<void>;  // init with bus, settings, logger
  stop(): Promise<void>;                     // cleanup all resources
  getHealth(): ModuleHealth;                 // periodic health check
}

interface ModuleManifest {
  name: string;
  version: string;
  capabilities: string[];        // what this module provides
  dependencies: string[];        // other modules needed (soft deps)
  provides: Record<string, ToolSchema>;  // tools registered
  channels: { publishes: string[]; subscribes: string[]; };
  rendererEntry?: string;        // JS to load in renderer
  windowEntry?: string;          // creates its own window (kanban)
  standalone?: string;           // standalone entry point
}
```

Each module also has a `standalone.ts` that creates a local in-process bus, mocks the context, and starts the module — enabling independent execution without Electron.

---

## 3. Message Bus (`packages/bus/`)

Typed pub/sub that works identically in main, renderer, and standalone Node processes.

### API
- `publish(channel, payload)` — fire-and-forget events
- `subscribe(channel, handler)` → unsubscribe function
- `request(channel, payload, timeout?)` → Promise (request/reply)
- `handle(channel, handler)` → unsubscribe (register request handler)

### Channel Naming
```
module:event-name          — fire-and-forget
module:request-name        — request/reply
core:module-loaded         — lifecycle events
settings:changed           — broadcast
```

### IPC Bridge
One IPC channel in each direction replaces the entire 270-line preload:
- Main → Renderer: `iris:bus-message`
- Renderer → Main: `iris:bus-message`
- Request/Reply: `iris:bus-invoke`

Adding a new feature = subscribe to a bus channel. Zero changes to core/preload.

---

## 4. Complete Module Inventory

### mod-settings
- Read/write/validate `~/.iris/settings.json`
- Namespace isolation (voice, behavior, avatar, logging, 2fa)
- Hot-reload: broadcast `settings:changed` on any write
- Default values with deep merge

### mod-convex
- HTTP client with retry + exponential backoff (4 retries, 5s timeout)
- Table adapters: conversations, tool_executions, sessions, runtime_events, task_milestones, proactive_suggestions, daily_drafts, links, task_queue, visual_observations
- Session management (create/end)
- Vector search (1024-dim embeddings)

### mod-feedback
- Persistent JSON store (`~/.iris/feedback.json`)
- Categories: voice, preference, behavior, feature-request
- Add/approve/dismiss/clear operations

### mod-vocab
- VocabMonitor: extract terms from active project files
- VocabStore: term frequency tracking (hot/core terms)
- VocabMatcher: fuzzy match voice input against known terms
- RecentSeenStore: 30s TTL, max 24 terms
- CorrectionStore: user voice corrections
- N-gram learner

### mod-search
- Web search via Gemini Flash
- Semantic search via Convex vector (1024-dim)
- LinkCapturePoller: clipboard monitoring → URL extraction → embedding → store
- Search overlay window management

### mod-skills
- SkillScanner: discover `~/.iris/skills/*/SKILL.md`
- SkillRunner: spawn skill scripts as child processes
- SkillPolicy: execution gating
- Dynamic tool declaration from skill metadata

### mod-screen
- Screenshot capture via Electron `desktopCapturer`
- Retina normalization + coordinate mapping (scale + offset)
- Gemini Vision analysis (UI understanding, field detection)
- Visual observation storage with embeddings
- 24-capture history with freshness tracking
- Screen capture health monitoring

### mod-gemini
- WebSocket client to `BidiGenerateContent` (native audio model)
- Tool declaration builder (collects from all modules via bus)
- System prompt builder (dynamic: skills, vocab, observations, context)
- Response parser (text, audio, tool calls)
- Fallback profiles (full → compact if system instruction too large)
- Self-fix pattern detection
- **Runs in renderer** (WebSocket + audio API)

### mod-voice
- AudioCapture (WebAudio, 16kHz PCM16) — renderer
- AudioPlayback (pitch/rate/frequency shaping, compressor) — renderer
- VoiceEngine state machine: IDLE → LISTENING → USER_SPEAKING → PROCESSING → RESPONDING → TOOL_EXECUTING
- BargeInDetector (user speaks during playback)
- ListeningGate (VAD, noise floor adaptation, configurable thresholds)
- Echo suppression
- TranscriptionPolicy (clean/drop partial transcripts)
- BehaviorEngine (silent/attentive/autonomous mode logic)
- Screen capture controller (periodic screenshots during voice)

### mod-automation
- PlanningEngine: decompose natural language goals → executable steps
- ExecutionPolicy: route to native / browser / TARS
- UITaskService: full orchestration (plan → execute → verify → iterate)
- VerificationEngine: screenshot after action, compare expected vs actual
- InputMonitor: detect user keyboard/mouse during automation
- EpisodeRecorder: record sequences for learning
- NativeFallbackManager
- Native actions: click_at, double_click, mouse_move, drag, scroll, type_text, press_key
- App launching, window management (minimize, maximize, hide)
- File operations, Finder integration, clipboard read/write
- TARS client (UI-TARS model for browser automation)
- BrowserAdapter (Chrome/Safari/Firefox abstraction)

### mod-tools
- Tool registry: collects handlers from all modules via `tools:register` bus channel
- Tool executor: dispatch by name, timing, logging, result formatting
- Built-in tools: input, apps, files, search, system, design, 3d-gen
- Tool slow threshold alerting

### mod-2fa
- TwoFAOrchestrator: poll → detect field → gather codes → confidence → fill
- Detector: Accessibility API + Gemini Vision field detection
- 6 code sources: iMessage, Mail, notifications, keychain TOTP, local TOTP, 1Password
- CodeCache: 5-minute TTL, auto-fill from cache on field focus
- Confidence gating (configurable threshold)
- NotificationMonitor (macOS notification center)

### mod-coding
- CodingRunner: spawn Claude Agent SDK / Codex tasks
- Provider abstraction (Claude, Codex)
- ScientificWorkflow: analyze runtime logs → generate self-fixes
- SelfImprovementManager: propose, apply, verify improvements
- LearningManager: feedback → patterns → skills
- MemoryStore: persistent automation memory (`~/.iris/memory.json`)

### mod-autonomy
- ProactiveEngine: periodic screen analysis → suggest actions
- IntentPredictionEngine: Groq-based, 10s intervals, LRU cache (50 entries, 5min TTL)
- IntentRouter: route predictions to actions or suggestions
- IntentContextBuilder: frontmost app, window titles, time, git branch, workspace
- PatternStore: learned prediction patterns with outcome tracking
- DailyLoop: Ghost blog draft generation (hourly tick, once per calendar day)
- GhostDraftPublisher: HTML draft → Ghost CMS API

### mod-tasks
- TaskEngine: lifecycle (create, start, complete, fail, verify)
- TaskQueueService: FIFO with priorities, dependencies, execution lanes (coding/UI/voice/frustration)
- TaskQueueWatcher: Convex sync
- TaskEnricher: AI-based prompt enrichment (impact files, complexity, task kind)
- TaskExecutor: dispatch to coding or UI automation
- DependencyManager: task dependency resolution
- PathDetector: detect project path from context
- KanbanWindow: separate BrowserWindow (frameless, vibrant, drag-drop)
- KanbanController: CRUD, git operations, reorganize, clean

### mod-macp
- MACP protocol client
- Multi-agent coordination (dispatch/claim tasks, shared memory)
- Channel join/poll/send

---

## 5. Renderer (`packages/renderer/`)

### Avatar (Three.js)
- Scene: WebGL transparent, 30° FOV, camera offset left 22%
- 3 directional + 1 ambient light
- Dynamic light rig (reactive to voice state: thinking/speaking/idle)
- VRM/glTF loader (tripo3d + original model support)
- Procedural animations: head look-around, finger curl, blink, lip sync, smile
- Mouse raycasting for avatar hitbox

### UI Components
- **Chat bubbles**: 3 lanes (chat/context/thinking), streaming mode, auto-hide with duration calc
- **Activity timeline**: 30 events max, phase-colored cards (thinking/tool/verify/done/2fa/interrupt/db)
- **Debug panel**: 9 status dots (WS, MIC, VOICE, SEND, THINK, SPEAK, TOOL, SRCH, AUTO)
- **Tool log**: live execution entries (max 5), spinner/check/warning states
- **Workspace bar**: current directory display
- **Mute badge**: audio mute indicator
- **Loading overlay**: fade-out on boot

### Kanban (separate window, owned by mod-tasks)
- 3 columns: To Do / In Progress / Done
- Drag-to-move, task counts, run button, delete
- Task logs display (scrollable)
- Inline task creation
- Buttons: New, Reorganize, Clean, Run All, Commit & Push

---

## 6. Hot-Reload Strategy

1. **Core never changes** for feature work — shell, bus, IPC bridge are stable
2. **Modules are `require()`'d dynamically** by module-loader
3. On file change in `packages/mod-X/src/**`:
   - Call `module.stop()` (cleans up bus subscriptions, timers, child processes)
   - Clear Node require cache for `packages/mod-X/`
   - Re-require entry, call `module.start(ctx)`
   - Publish `core:module-loaded`
4. **Bus subscriptions are scoped** per module — auto-cleanup on stop even if module forgets
5. **Renderer modules** with `rendererEntry` get a bus message to dynamically re-import
6. Avatar window stays up the entire time

---

## 7. Data Flow Examples

### Voice Conversation
```
User speaks → [mod-voice] AudioCapture → ListeningGate (VAD)
→ bus 'voice:user-speaking'
→ [mod-gemini] sends audio over WebSocket
→ Gemini responds (text + audio + tool calls)
→ bus 'gemini:response' → [mod-voice] AudioPlayback
→ bus 'gemini:tool-call' → [mod-tools] execute → bus 'gemini:tool-result'
→ [mod-gemini] sends result back to Gemini
```

### 2FA Auto-Fill
```
[mod-2fa] poll timer → screenshot → detector (AX + Vision)
→ field found → gatherCodes (iMessage, Mail, notifications...)
→ computeConfidence → above threshold
→ bus 'automation:run-ui-task' → type code into field
→ bus '2fa:fill-success'
```

### Module Hot-Reload
```
File saved in mod-voice/ → watcher → loader.reload("voice")
→ voiceModule.stop() → clear require cache → re-require → start(ctx)
→ avatar window untouched, voice reconnects
```

---

## 8. State Ownership

| State | Owner | Storage | Shared via |
|-------|-------|---------|------------|
| Settings | mod-settings | `~/.iris/settings.json` | `settings:changed` bus event |
| Conversations, observations, links | mod-convex | Convex cloud DB | bus request/reply |
| Task queue | mod-tasks | Convex `task_queue` | `tasks:queue-changed` |
| Runtime events | mod-convex | Convex `runtime_events` | modules publish, mod-convex persists |
| Feedback | mod-feedback | `~/.iris/feedback.json` | `feedback:add` |
| Memory (automation) | mod-coding | `~/.iris/memory.json` | internal |
| Code cache (2FA) | mod-2fa | In-memory (5-min TTL) | internal |
| Window geometry | core | `~/.iris/geometry.json` | core only |
| Vocab | mod-vocab | `~/.iris/vocab.json` | `vocab:terms-updated` |
| World state (intent) | mod-autonomy | In-memory | internal |

**Rule**: Modules own their state. No module reads another's files. Cross-module access = bus.

---

## 9. Implementation Order

### Phase 1 — Foundation
- [ ] Create `iris-v2/` folder with bun workspace
- [ ] `packages/bus/` — protocol, channels, emitter, bus-client (no Electron dep)
- [ ] `packages/core/` — main.ts, shell.ts, module-loader, registry, ipc-bridge, preload
- [ ] `packages/renderer/` — index.html, app.ts, bus-renderer, avatar (scene/loader/overlays)
- [ ] Verify: core boots, avatar shows, bus works, modules load

### Phase 2 — Foundation Modules
- [ ] mod-settings (settings persistence + broadcast)
- [ ] mod-convex (Convex client + all table adapters)
- [ ] mod-feedback (feedback store)
- [ ] mod-vocab (vocab monitor/store/matcher)
- [ ] mod-screen (screenshot capture + vision + observations)

### Phase 3 — Voice & AI
- [ ] mod-gemini (WebSocket client + tool dispatch + system prompt)
- [ ] mod-voice (full voice pipeline: capture, playback, VAD, barge-in, behavior)
- [ ] mod-tools (tool registry + executor + built-in tools)

### Phase 4 — Automation & Intelligence
- [ ] mod-automation (planning, execution, verification, native actions, TARS)
- [ ] mod-autonomy (intent prediction, proactive engine, daily loop, Ghost)
- [ ] mod-coding (Claude Agent SDK, self-improvement, learning)
- [ ] mod-2fa (orchestrator, detector, sources, cache, fill)

### Phase 5 — Remaining Modules
- [ ] mod-search (web search, semantic search, link capture)
- [ ] mod-skills (scanner, runner, policy)
- [ ] mod-tasks (task engine, queue, kanban window)
- [ ] mod-macp (multi-agent coordination)

### Phase 6 — Polish
- [ ] Hot-reload dev mode with file watcher
- [ ] Health dashboard (aggregate module health)
- [ ] Standalone execution verification for each module
- [ ] End-to-end feature parity test against current Iris

---

## 10. Verification Plan

For each phase:
1. **Unit**: each module starts and stops cleanly in standalone mode
2. **Integration**: modules communicate correctly through the bus
3. **E2E**: full app boots, avatar renders, voice works, tools execute

Final verification:
- [ ] Voice conversation works (speak → Gemini → response → playback)
- [ ] Desktop automation works (click, type, verify)
- [ ] 2FA auto-fill works (detect field, read code, fill)
- [ ] Intent prediction fires every 10s
- [ ] Daily draft generates to Ghost
- [ ] Task queue processes tasks
- [ ] Kanban board shows/edits tasks
- [ ] Hot-reload: change a module file → module reloads without avatar restart
- [ ] Standalone: `bun run packages/mod-2fa/src/standalone.ts` works independently
- [ ] All 21+ tools execute correctly
- [ ] Screen capture + Retina normalization works
- [ ] Semantic search returns relevant results
- [ ] Skills load and execute from ~/.iris/skills/
