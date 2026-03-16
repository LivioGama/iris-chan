<!-- MACP-MCP:START -->
## MACP Coordination

MACP is active for this project. The shared project id is `iris-chan`. The MCP server auto-registers this session on startup and auto-joins the default channel `iris-chan`.

Normal workflow:
- do not run SQL directly
- do not manually attach another MACP server inside the agent loop
- call `macp_poll` regularly to stay aware of peer work
- call `macp_send_channel` for shared updates and `macp_send_direct` for one-to-one requests
- call `macp_ack` after acting on a delivery
- use `macp_ext_claim_files`, shared memory, tasks, goals, and vault tools when this project requires them

If this project uses shared memory, tasks, goals, or the vault, follow the local instructions in this file and use those tools as part of normal work.
<!-- MACP-MCP:END -->

# Mission: Standalone Module Refactoring

Every module under `src/main/` must run standalone with `node src/main/MODULE/index.js` — no Electron required.

## Reference Pattern

The 2FA module (`src/main/two-fa/index.js`) and Chess module (`feat/chess-module-tars` branch, `src/main/chess/index.js`) are the gold standard. Every module MUST follow this exact pattern:

```javascript
// MODULE_NAME module — can run standalone or be launched by Iris
//
// Standalone:  node src/main/MODULE/index.js
// From Iris:   const mod = require('./MODULE'); mod.init({ eventBus });

const log = (() => { try { return require('../logger'); } catch { return null; } })();
function info(...a) { log ? log.info('TAG', ...a) : console.log('[TAG]', ...a); }

let instance = null;

function init({ eventBus, settings = {} } = {}) {
  if (instance) return instance;
  instance = new MainClass({ eventBus, settings });
  instance.start();
  return instance;
}

function shutdown() {
  if (instance) { instance.stop(); instance = null; }
}

function getStatus() {
  return instance ? instance.getStatus() : { enabled: false, running: false };
}

module.exports = { init, shutdown, getStatus };

// ---- Standalone entry point ----
if (require.main === module) {
  console.log('MODULE starting (Ctrl+C to stop)...');
  const mockEventBus = {
    emitEvent: (type, payload) => console.log(`[${type}]`, JSON.stringify(payload).slice(0, 120)),
  };
  init({ eventBus: mockEventBus, settings: {} });
  process.on('SIGINT', () => { shutdown(); process.exit(0); });
}
```

**Key rules:**
- Logger fallback: try/catch require('../logger'), fall back to console
- All Electron deps become optional constructor params with sensible defaults
- `screencapture -x -t jpg /tmp/iris-standalone.jpg` replaces Electron desktopCapturer
- MockEventBus in standalone mode
- SIGINT handler for clean shutdown

## Shared Mocks

Create `src/main/_standalone/mocks.js` FIRST. Every standalone block imports from here:

```javascript
const { MockEventBus, MockConvexClient, MockBehaviorEngine } = require('./_standalone/mocks');
```

## Task Assignments

### ALPHA (Claude) — Architecture & Complex Refactoring
**Tasks (sequential):**
1. **T0**: Create `src/main/_standalone/mocks.js` — MockEventBus, MockConvexClient, MockBehaviorEngine, MockScreenCapture. Broadcast "T0 complete" on MACP when done.
2. **T6**: Create `src/main/task-queue/index.js`. Extract window broadcast from `service.js` and `watcher.js` into injectable `broadcastFn`. Keep `service-ref.js` as-is but have index.js call setters internally.
3. **T7**: Create `src/main/automation/index.js`. Master entry wrapping all automation subsystems (UITaskService, MemoryStore, LearningManager, SelfImprovementManager, IntentPredictionEngine, etc.). Internalize service-ref.js setters.
4. **T8**: Decouple `ui-task-service.js` from `screen-capture.js`. Add `screenCaptureFn` constructor param. Default to CLI `screencapture` fallback in standalone mode.

### BRAVO (Codex) — Mechanical Conversions
**Tasks (parallel, but wait for T0):**
1. **T1**: Create `src/main/autonomy/index.js` — wrap DailyLoop, ghost-draft-publisher
2. **T2**: Create `src/main/coding/index.js` — wrap runner.js, providers
3. **T3**: Create `src/main/link-capture/index.js` — wrap LinkCapturePoller (note: poller.js already exists, create index.js wrapper)
4. **T4**: Create `src/main/runtime/index.js` — wrap HealthService, BehaviorModeState, EventPersistence. SKIP shortcut-manager (Electron-only).

### CHARLIE (Gemini) — Medium Refactoring + Reviews
**Tasks:**
1. **T5**: Create `src/main/vocab/index.js` — decouple `monitor.js` from avatarWindow callback. Replace with optional `onVocabUpdate` callback.
2. **T9**: Decouple `world-state.js` from `screen-capture.js` — inject optional `captureVisualFn`.
3. **Reviews**: After each peer task completes, verify: (a) module runs standalone for 5s, (b) no `require('electron')` in module tree, (c) exports init/shutdown/getStatus.

### DELTA (Junie) — Integration & E2E
**Tasks (wait for ALL above):**
1. **T10**: Update `bootstrap.js` to use new module init/shutdown interfaces. Keep Electron-specific code (windows, shortcuts, tray) at bootstrap level.
2. **E2E**: Run `node src/main/MODULE/index.js` for every module. Run `bun run dev` to verify Electron app still boots.

## Rules for All Agents

1. **Poll MACP** every 30 seconds (`macp_poll`)
2. **Claim files** before editing (`macp_ext_claim_files`)
3. **Broadcast status** on channel `iris-chan` after each task
4. **Wait for dependencies**: T1-T9 wait for T0. T10 waits for all.
5. **Don't touch unclaimed files**
6. **Use `bun` not npm/yarn**
7. **Test before declaring done**: `node --check FILE` + run standalone for 5s
8. **Keep changes minimal** — don't restructure, just add standalone capability
9. **Commit each task separately** with descriptive message
10. When done with ALL your tasks, send "all tasks complete" on channel

## Verification Protocol

Each completed module must pass:
```bash
# Syntax check
node --check src/main/MODULE/index.js

# Standalone run (5 seconds, no crash)
timeout 5 node src/main/MODULE/index.js; echo "exit: $?"

# No Electron imports in module tree
grep -r "require('electron')" src/main/MODULE/ && echo "FAIL: electron found" || echo "PASS"
```

## Communication

- Use MACP channel `iris-chan` for broadcasts
- Use MACP direct messages for review requests
- Format: `"Tx complete. Files: [list]. Ready for review."` or `"Tx BLOCKED: [reason]"`
- If stuck > 2 minutes, heartbeat will nudge you
