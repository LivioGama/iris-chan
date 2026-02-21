# Iris-chan — Feature Spec

## Core Architecture
- Electron desktop app (vanilla JS, no build step)
- Gemini 2.5 Flash Native Audio (WebSocket) for voice I/O
- Three.js + VRM avatar with glow effects
- Convex (self-hosted) for conversation history + vector search
- Swift native helper for macOS keyboard/mouse/app control
- Hot-reload for tool modules (no restart needed)

## Completed Features
- [x] Real-time voice conversation (16kHz capture → Gemini → 24kHz playback)
- [x] Echo cancellation (reference signal feedback)
- [x] 3D VRM avatar with lip-sync and idle animations
- [x] Tool system: 10 built-in modules (input, apps, files, clipboard, search, system, meta, design, 3d-gen, auth)
- [x] Dynamic skill loader (~/.iris/skills/)
- [x] Vocabulary learning (fuzzy matching, corrections, hot terms, core terms)
- [x] Conversation persistence to Convex with embeddings
- [x] Semantic search across conversation history
- [x] Kanban board (secondary Electron window)
- [x] Self-fix tool (creates kanban tasks for code changes)
- [x] Workspace system (persistent project directory)
- [x] Screen capture + screenshot-driven action verification
- [x] Web search (Ollama Cloud gpt-oss-120b)
- [x] Debug overlay (8 status indicators)
- [x] Speech bubbles (user/iris/context variants)
- [x] Activity panel (rolling log of thinking/tool activity)
- [x] 2FA auto-extraction from Messages.app
- [x] Mute/unmute toggle (click avatar)

## In Progress
- [ ] Behavior modes (Silent / Attentive / Autonomous)
- [ ] Claude Code streaming observability in activity panel
- [ ] Action verification feedback loop (screenshot after every click/type)
- [ ] Kanban window size/position persistence
- [ ] Legacy log import to Convex

## Planned
- [ ] Ghost blog integration (daily posts via Admin API)
- [ ] Autonomous learning loop (research → blog)
- [ ] Proactive 2FA helper (auto-detect + auto-fill)
- [ ] Message suggestion (messaging app context)
- [ ] Voice latency optimization
- [ ] Skill creation meta-skill
- [ ] Glow effects driven by speech volume
