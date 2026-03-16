# Iris-chan v2 — AI Desktop Assistant

> A modular Electron desktop AI assistant with full-duplex voice, desktop automation, 2FA auto-fill, and a hackathon demo mode. Built with 17 standalone modules communicating through a typed message bus.

![Architecture](architecture.md)

## What Iris Can Do

| Category | Capabilities |
|----------|-------------|
| **Voice** | Full-duplex conversation via Gemini native audio, barge-in detection, VAD, echo suppression, 3 behavior modes |
| **Vision** | Screenshot capture with Retina normalization, Gemini Vision UI analysis, visual observation storage with 1024-dim embeddings |
| **Automation** | Click, type, drag, scroll at any coordinate, app launching, file ops, verification engine (screenshot after each action) |
| **2FA** | Detects 2FA fields via Accessibility API + Gemini Vision, reads codes from iMessage/Mail/notifications, 5-min cache, auto-fills with confidence gating |
| **Intelligence** | Intent prediction (Groq LLaMA 3.3), proactive suggestions, daily Ghost blog drafts, autonomous task queue |
| **Coding** | Claude Agent SDK integration, scientific workflow, self-improvement learning, custom skills from `~/.iris/skills/` |
| **Search** | Web search via Gemini Flash, semantic search over Convex vectors, clipboard link capture |
| **UI** | Always-on-top Three.js avatar, chat bubbles, activity timeline, kanban board, debug panel |

## Google Cloud / Gemini API Usage

Iris-chan is powered by **4 Google Cloud APIs** (Gemini):

| API | Purpose | Code Reference |
|-----|---------|----------------|
| **Gemini 2.5 Flash Native Audio** (WebSocket) | Real-time full-duplex voice conversation | [`packages/mod-gemini/src/client.ts`](packages/mod-gemini/src/client.ts) — WebSocket endpoint, setup payload, audio streaming |
| **Gemini 2.5 Flash Native Audio** (WebSocket) | Tool calling (47 function declarations) | [`packages/mod-gemini/src/client.ts`](packages/mod-gemini/src/client.ts) — `sendToolResponse()`, tool call handling |
| **Gemini 3 Flash** (REST) | Vision analysis (UI understanding, 2FA field detection) | [`packages/mod-gemini/src/config.ts`](packages/mod-gemini/src/config.ts) — `FLASH_ENDPOINT`, [`packages/mod-search/src/web-search.ts`](packages/mod-search/src/web-search.ts) |
| **Gemini 3 Flash** (REST) | Web search with Google Search grounding | [`packages/mod-search/src/web-search.ts`](packages/mod-search/src/web-search.ts) — `googleSearch` tool |

**Endpoints used:**
```
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent
```

## Architecture

```
iris-chan/
├── packages/
│   ├── core/          # Electron shell (8 files, never changes for features)
│   ├── bus/           # Typed pub/sub message bus (134+ channels)
│   ├── renderer/      # Three.js avatar + UI overlay
│   └── 17 mod-*      # Standalone feature modules
├── convex/            # Database schema (11 tables)
└── assets/            # VRM avatar models
```

See [`architecture.md`](architecture.md) for the full ASCII architecture diagram.

### Key Design Decisions
- **Single IPC channel** replaces 80+ legacy channels — one `iris:bus-message` for everything
- **25-line preload** replaces 270-line monolith
- **Topological module loading** — dependencies resolved automatically
- **Hot-reload** — change a module, core never restarts
- **Each module runs standalone** — `bun run packages/mod-*/src/standalone.ts`

## Reproducible Testing Instructions

### Prerequisites

- **macOS** (required for Accessibility API, AppleScript, screen capture)
- **Bun** (v1.0+): `curl -fsSL https://bun.sh/install | bash`
- **Node.js** (v20+)
- **API Keys** (set in `~/.zshrc` or `.env`):
  - `GEMINI_API_KEY` — Google AI Studio key (required for voice + vision)
  - `GROQ_API_KEY` — Groq API key (for intent prediction)
  - Optional: `CONVEX_URL`, `GHOST_ADMIN_URL`, `GHOST_ADMIN_KEY`

### Quick Start

```bash
# 1. Clone and install
git clone https://github.com/LivioGama/iris-chan.git
cd iris-chan
git checkout v2-rebuild
bun install

# 2. Run the full app
cd packages/core
bunx electron .

# 3. You should see:
#    - Transparent avatar window appears
#    - 17 modules load in ~130ms
#    - Debug panel shows status dots
#    - Console shows: "Iris v2 ready"
```

### Test Individual Modules (No Electron Needed)

Each module runs independently as a plain Node/Bun process:

```bash
# Settings (loads ~/.iris/settings.json)
bun run packages/mod-settings/src/standalone.ts

# Vocabulary (loads 260+ terms, fuzzy matching)
bun run packages/mod-vocab/src/standalone.ts

# Tool registry (47 tool declarations)
bun run packages/mod-tools/src/standalone.ts

# 2FA orchestrator (polls for codes)
bun run packages/mod-2fa/src/standalone.ts

# Autonomy (intent prediction + daily drafts)
GROQ_API_KEY=your_key bun run packages/mod-autonomy/src/standalone.ts

# All modules follow the same pattern:
bun run packages/mod-{name}/src/standalone.ts
```

### Run the Hackathon Demo

```bash
# Launch with auto-demo (0.3x speed for readability)
cd packages/core
IRIS_DEMO_AUTO=1 IRIS_DEMO_SPEED=0.3 GEMINI_API_KEY=your_key bunx electron .

# Or say "present yourself" during normal operation
# Or trigger via the start_demo tool
```

The demo runs 26 narrated steps:
1. **Introduction** — Iris explains her architecture
2. **Web Search** — Opens Safari, searches Google Images, identifies a person
3. **Chess** — Opens chess.com, makes e4 + d4 moves via vision + clicking
4. **Skill Creation** — Creates "nano banana pro" skill, generates + edits an image
5. **2FA Auto-Fill** — Detects a 2FA field, reads SMS code, auto-fills
6. **Closing** — Architecture recap

### Verify Module Health

```bash
# Quick health check for all modules
for m in settings convex feedback vocab screen tools gemini voice \
         automation autonomy coding 2fa search skills tasks macp demo; do
  result=$(timeout 5 bun run packages/mod-$m/src/standalone.ts 2>&1)
  if echo "$result" | grep -q 'Error\|TypeError'; then
    echo "FAIL mod-$m"
  else
    echo "OK   mod-$m"
  fi
done
```

Expected output: 17/17 OK (autonomy requires GROQ_API_KEY, convex requires CONVEX_URL — both degrade gracefully).

### macOS Permissions Required

- **Screen Recording** — System Settings → Privacy & Security → Screen Recording → grant Electron
- **Accessibility** — System Settings → Privacy & Security → Accessibility → grant Electron (for 2FA + automation)
- **Microphone** — Prompted on first voice interaction

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 35 + Bun |
| Language | TypeScript (110 files) |
| 3D Avatar | Three.js + VRM |
| Voice | WebAudio API (16kHz capture, 24kHz playback) |
| AI Chat | Gemini 2.5 Flash Native Audio (WebSocket) |
| Vision | Gemini 3 Flash (REST) |
| Intent | Groq LLaMA 3.3-70B |
| Coding | Claude Agent SDK |
| Database | Convex (11 tables, 1024-dim vectors) |
| Automation | AppleScript + CGEvent (cliclick) |
| Blog | Ghost CMS API |

## Project Stats

- **20 packages** (core, bus, renderer, 17 modules)
- **151 source files**, 110 TypeScript
- **47 tool declarations** for Gemini function calling
- **134+ bus channels** across 17 module namespaces
- **Boot time**: ~130ms for all 17 modules
- **Zero cross-module imports** — everything goes through the bus

## License

MIT
