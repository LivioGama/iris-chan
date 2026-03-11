# Iris-chan V2 Living Roadmap

## Goal
Deliver a full V2 runtime rewrite with deterministic behavior, verifiable actions, robust persistence, and autonomy workflows while keeping V1 intact until cutover.

## Status Summary
- Runtime strategy: `IRIS_RUNTIME=v2` introduced, V1 preserved.
- V2 architecture scaffold: in progress.
- Cutover default: pending (blocked on acceptance gates below).

## Phase 1 — Core Runtime Scaffold
Status: In Progress
Owner: Iris Core

### Scope
- V2 tree under `src/v2/`.
- Typed IPC contracts and event schema.
- Core domain engines scaffolded: behavior, voice, action, tasks, observability, persistence, autonomy.

### Acceptance Criteria
- `src/v2/shared/ipc-contracts.ts` and `src/v2/shared/event-types.ts` exist and are used by V2 IPC registration.
- `IRIS_RUNTIME=v2` launches V2 bootstrap path without touching V1 path.
- V2 kanban window geometry persists and restores.

### Checklist
- [x] Add V2 folder structure.
- [x] Add IPC contracts and event schema.
- [x] Add V2 bootstrap with runtime selector.
- [x] Add V2 geometry store and kanban window persistence.

## Phase 2 — Behavior, Voice, and Verification
Status: In Progress
Owner: Iris Voice/Behavior

### Scope
- Silent-by-default behavior gating.
- No repeated idle outputs.
- One self-fix ack policy.
- Full-duplex interruption and transcript cleanup.
- Action verification loop with retries.

### Acceptance Criteria
- No repeated idle messages in 30-minute simulation.
- User interruption halts playback promptly.
- Action engine never reports success without verification.

### Checklist
- [x] Implement V2 behavior engine with anti-nag gate.
- [x] Implement transcript cleanup policy.
- [x] Implement action verification engine.
- [ ] Integrate V2 voice engine as primary runtime path (currently scaffolded).

## Phase 3 — Observability and Task Lifecycle
Status: In Progress
Owner: Iris Workflow

### Scope
- Event timeline UI.
- Milestone summarization (user-relevant wording only).
- Task lifecycle engine and stream handling.
- Self-fix restart classifier (`hot` vs `cold`).

### Acceptance Criteria
- Milestones show in timeline with structured cards.
- Task streaming and completion events deterministic.
- Restart classifier returns stable output from touched file sets.

### Checklist
- [x] Add activity timeline renderer.
- [x] Add milestone summarizer.
- [x] Add task engine with lifecycle stream.
- [x] Add restart classifier.

## Phase 4 — Persistence and History
Status: In Progress
Owner: Iris Data

### Scope
- Convex health checks with retry telemetry.
- New Convex tables for runtime and autonomy signals.
- Verify-history flow only (no destructive re-import).

### Acceptance Criteria
- Startup and periodic DB health checks emit events.
- `verify-history-import` returns non-destructive summary.
- Runtime/task/proactive/draft persistence paths available.

### Checklist
- [x] Add `convex/runtime.ts` mutations/queries.
- [x] Expand `convex/schema.ts` with V2 tables.
- [x] Add `src/v2/scripts/verify-history-import.js`.

## Phase 5 — Proactive + Autonomy + Ghost Drafts
Status: In Progress
Owner: Iris Autonomy

### Scope
- High-confidence proactive suggestions only.
- 2FA auto-fill only with confidence/context checks.
- Daily short Ghost draft generation (draft only).
- Priority task preemption support in daily loop.

### Acceptance Criteria
- Suggestions are throttled and confidence-gated.
- 2FA auto-fill blocked below threshold.
- Daily loop creates draft only, no auto-publish.

### Checklist
- [x] Add proactive engine with threshold + cooldown.
- [x] Add V2 auth confidence policy wrapper.
- [x] Add Ghost draft publisher and daily loop.
- [ ] Wire full research content generation pipeline before draft publish.

## Test Gates
Status: In Progress

### Required Before Default Cutover
- [x] Behavior gate test (no repeated idle chatter).
- [x] Action verification retry test.
- [x] Task lifecycle/restart-classifier test.
- [ ] V2 end-to-end UI + voice smoke test. Manual gold-path checklist: `planning/manual-e2e-verification.md`
- [ ] Convex schema deployment + integration smoke test.

## Rollback Plan
- Keep `IRIS_RUNTIME=v1` as immediate fallback.
- Do not remove V1 modules before V2 default cutover passes all gates.
- If V2 fails runtime health checks in production, switch env to V1 and relaunch.

## Notes
- Historical logs are already imported; importer remains verification-only in V2.
- Raw screen context remains transient by default.
