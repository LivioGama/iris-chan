# Iris-chan

Electron desktop assistant: always-on avatar overlay, voice pipeline (STT/TTS), Gemini chat, tools & skills, Convex persistence.

```bash
bun run dev
bun run dev:v2
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    IRIS-CHAN RUNTIME                                          │
│                               IRIS_RUNTIME=v1 | v2 (env)                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                    src/main/index.js
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
                    ▼                                                   ▼
            ┌───────────────┐                                   ┌───────────────┐
            │     V1        │                                   │     V2        │
            │  startV1()    │                                   │  startV2()    │
            └───────┬───────┘                                   └───────┬───────┘
                    │                                                   │
                    │                                                   │
┌───────────────────┴───────────────────────────────────────────────────┴───────────────────┐
│                              MAIN PROCESS (Electron)                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  SHARED (both runtimes):                                                                 │
│  • ipc.register(apiKey)     → system, tool, vocab, search, skill, convex, kanban         │
│  • avatar-window.create()   → loads src/renderer or src/v2/renderer by IRIS_RUNTIME      │
│  • kanban-window.create()                                                                 │
│  • skills.scan()                                                                         │
│  • convex-store.init()                                                                    │
│  • preload.js → contextBridge.exposeInMainWorld('electronAPI', ...)                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  V1 ONLY:                                                                                │
│  • vocabStore.syncFromSource()                                                            │
│  • vocabMonitor.start(apiKey)                                                            │
│  • globalShortcut: Cmd+I (voice), Cmd+K (kanban), Cmd+Shift+M (autonomous)               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  V2 ONLY (src/v2/main/bootstrap.js):                                                     │
│  • RuntimeEventBus          → event stream (THINKING, TOOL_START, TASK_MILESTONE, etc.)   │
│  • ConvexClientV2           → runtime_events, task_milestones, proactive_suggestions     │
│  • TaskEngine               → run/stop tasks, lifecycle stream → kanban + avatar          │
│  • HealthService           → DB health checks                                            │
│  • DailyLoop                → ghost draft generation, createGhostDraft                  │
│  • BehaviorModeState        → silent | attentive | autonomous                            │
│  • registerV2Ipc()          → v2:tasks:*, v2:events:*, v2:behavior:*, v2:window:*, etc.  │
│  • geometry-store           → persist kanban window bounds                               │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                           RENDERER PROCESS (Avatar overlay)                                  │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  SHARED:                                                                                    │
│  • Three.js avatar (scene, loader, overlays)                                                │
│  • VoicePipeline (capture.js, playback.js) + GeminiClient                                  │
│  • window.electronAPI.*                                                                     │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  V1 (src/renderer/app.js):                                                                  │
│  • VocabMatcher, vocab learner                                                              │
│  • Bubbles, tool-log, debug-panel, activity-panel                                           │
│  • toggle-voice, toggle-autonomous (globalShortcut)                                         │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  V2 (src/v2/renderer/app-runtime.js, app.js):                                               │
│  • tools-skills-panel, activity-timeline, bubbles                                           │
│  • v2SubscribeEvents → onV2Event → onRuntimeEvent()                                         │
│  • onV2TaskStream → TASK_MILESTONE / TASK_DONE                                              │
│  • milestone-summarizer, shouldNarrateMilestone                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              IPC CHANNELS                                                   │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  V1 (shared/channels.ts):                                                                   │
│  get-api-key | execute-tool | capture-screen | toggle-voice | track-vocabulary |            │
│  get-vocabulary | get-skill-declarations | save-conversation-turn | semantic-search |       │
│  load-kanban-tasks | save-kanban-tasks | ...                                                │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  V2 (v2/shared/ipc-contracts.ts):                                                            │
│  v2:runtime:get-health | v2:behavior:get-mode | v2:behavior:set-mode |                       │
│  v2:events:subscribe | v2:events:stream | v2:tasks:run | v2:tasks:stream |                   │
│  v2:window:get-geometry | v2:window:set-geometry | v2:blog:create-daily-draft                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              MAIN TOOLS (src/main/tools/)                                   │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  input | apps | files | clipboard | search | system | meta | design | 3d-gen | auth |       │
│  fix-project | set_workspace | get_workspace | use_skill                                    │
│  + skill handlers from skills.scan()                                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              CONVEX BACKEND (convex/)                                       │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  conversations    → sessionId, text, embedding, hasToolCalls                                │
│  tool_executions  → sessionId, toolName, args, result, success                               │
│  sessions         → sessionId, turnCount                                                     │
│  runtime_events   → type, payload, idempotencyKey (V2)                                        │
│  task_milestones  → taskId, message, importance (V2)                                          │
│  proactive_suggestions → text, confidence, accepted (V2)                                     │
│  daily_drafts     → title, date, ghostId, status (V2)                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              WINDOWS                                                        │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  avatar-window    → transparent overlay, alwaysOnTop, loads renderer/v2/renderer             │
│  kanban-window    → tasks.json UI, geometry persisted (V1: json file, V2: geometry-store)   │
│  search-window    → search overlay (V1)                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DIRECTORY TREE                                                  │
├───────────────────────────────────────────────────────────────────────────────────────────  │
│  src/                                                                                        │
│  ├── main/           → index.js, ipc.ts, logger, convex-store, workspace                     │
│  │   ├── controllers/  system, tool, vocabulary, search, skill, convex, kanban               │
│  │   ├── tools/        input, apps, files, clipboard, search, system, meta, design, etc.     │
│  │   ├── windows/      avatar-window, kanban-window, search-window                           │
│  │   └── vocab/        store, monitor                                                        │
│  ├── renderer/       → V1 UI: app.js, voice/, avatar/, gemini/, ui/                          │
│  ├── v2/                                                                                     │
│  │   ├── main/         bootstrap, ipc/register, persistence/convex-client                    │
│  │   │   ├── autonomy/  daily-loop, ghost-draft-publisher                                    │
│  │   │   ├── runtime/   geometry-store, health-service                                       │
│  │   │   ├── tasks/    task-engine                                                          │
│  │   │   └── windows/  kanban-window                                                         │
│  │   ├── renderer/     app.js, app-runtime, ui/, voice/, tasks/                              │
│  │   └── shared/       event-bus, ipc-contracts, event-types                                │
│  ├── shared/         channels, config, emitter                                               │
│  └── preload.js                                                                              │
│  convex/             schema.ts, runtime.ts, conversations.ts, search.ts                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```
