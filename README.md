# Iris-chan — AI Desktop Assistant

> A full-featured Electron desktop AI assistant with real-time voice, desktop automation, 2FA auto-fill, intent prediction, and a self-narrated hackathon demo mode. Powered by Gemini native audio, Gemini Vision, Groq, Claude Agent SDK, and Convex.

## What Iris Can Do

| Category | Capabilities |
|----------|-------------|
| **Voice & Conversation** | Full-duplex voice via Gemini native audio WebSocket, barge-in detection, VAD, echo suppression, noise floor adaptation, 3 behavior modes (silent/attentive/autonomous) |
| **Vision & Screen** | Screenshot capture with Retina normalization, Gemini Vision UI analysis, visual observation storage with 1024-dim vector embeddings |
| **Desktop Automation** | Click, type, drag, scroll, keyboard shortcuts at any screen coordinate, app launching, window management, file ops, Finder/clipboard integration, verification engine (screenshot after each action) |
| **2FA Auto-Fill** | Detects 2FA fields via Accessibility API + Gemini Vision, reads codes from iMessage/Mail/notifications, 5-minute code cache, auto-fills on field focus with confidence gating |
| **Proactive Intelligence** | Intent prediction (Groq LLaMA 3.3), proactive suggestions, daily Ghost blog draft generation, autonomous task queue with priorities and dependencies |
| **Coding & Self-Improvement** | Executes coding tasks via Claude Agent SDK, scientific workflow (analyze logs → generate self-fixes), learning manager, custom skills from `~/.iris/skills/` |
| **Search & Memory** | Web search via Gemini, clipboard link capture with embeddings, semantic search over Convex vectors, vocabulary learning with fuzzy voice matching |
| **UI** | Always-on-top transparent Three.js avatar, chat bubbles (3 lanes), activity timeline, kanban task board, debug panel (10 status dots), tool execution log |

## Google Cloud / Gemini API Usage

Iris is powered by **5 Google Cloud (Gemini) API integrations**:

| API | Purpose | Code Reference |
|-----|---------|----------------|
| **Gemini 2.5 Flash Native Audio** (WebSocket) | Real-time full-duplex voice conversation with streaming audio | [`src/renderer/gemini/client.js`](src/renderer/gemini/client.js#L16) |
| **Gemini 2.5 Flash Native Audio** (WebSocket) | Tool calling — 47 function declarations executed in real-time | [`src/renderer/gemini/tool-declarations.js`](src/renderer/gemini/tool-declarations.js) |
| **Gemini 3 Flash** (REST) | Vision analysis — UI understanding, 2FA field detection, chess board analysis | [`src/main/two-fa/detector.js`](src/main/two-fa/detector.js#L10), [`src/main/chess/vision.js`](src/main/chess/vision.js#L5) |
| **Gemini 3 Flash** (REST) | Web search with Google Search grounding, proactive suggestions | [`src/renderer/voice/voice-engine.js`](src/renderer/voice/voice-engine.js#L41), [`src/renderer/behavior/proactive-engine.js`](src/renderer/behavior/proactive-engine.js#L5) |
| **Gemini 3 Flash** (REST) | Task enrichment — AI-based prompt analysis for task queue | [`src/main/task-queue/enricher.js`](src/main/task-queue/enricher.js#L6) |

**Google Cloud endpoints used:**
```
wss://generativelanguage.googleapis.com/ws/.../BidiGenerateContent  (native audio WebSocket)
https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent
https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
```

## Architecture

See [`architecture.md`](architecture.md) for the full ASCII diagram.

```
┌─────────────────────────────────────────────────────┐
│  USER: Mic · Screen · Keyboard · Clipboard          │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  RENDERER: Three.js Avatar · WebAudio · Gemini WS   │
│  Voice Pipeline: Capture → VAD → Gemini → Playback  │
│  UI: Bubbles · Timeline · Debug Panel · Tool Log    │
└──────────────────────┬──────────────────────────────┘
                       │ IPC (preload.js)
                       ▼
┌─────────────────────────────────────────────────────┐
│  MAIN PROCESS: Bootstrap · IPC · Module Wiring       │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │  Tools   │  Screen  │ Autonomy │  Tasks   │      │
│  │  21+     │  Capture │  Intent  │  Queue   │      │
│  │  built-  │  + Retina│  + Ghost │  + Kanban│      │
│  │  in      │  + Vision│  + Groq  │  + Coding│      │
│  ├──────────┼──────────┼──────────┼──────────┤      │
│  │  2FA     │  Vocab   │  Skills  │  Search  │      │
│  │  Detect  │  260+    │  Custom  │  Web +   │      │
│  │  + Fill  │  terms   │  JS/TS   │  Semantic│      │
│  └──────────┴──────────┴──────────┴──────────┘      │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌──────────┐  ┌──────────────┐  ┌─────────────────┐
│  Convex  │  │  ~/.iris/    │  │  External APIs   │
│  11 tbls │  │  settings    │  │  Gemini · Groq   │
│  vectors │  │  vocab · logs│  │  Ghost · MACP    │
└──────────┘  └──────────────┘  └─────────────────┘
```

## Reproducible Testing Instructions

### Prerequisites

- **macOS** (required — uses Accessibility API, AppleScript, screen capture)
- **Bun** (v1.0+): `curl -fsSL https://bun.sh/install | bash`
- **Node.js** (v20+)
- **API Keys** (set as environment variables):
  - `GEMINI_API_KEY` — Google AI Studio API key (**required** for voice + vision)
  - `GROQ_API_KEY` — Groq API key (for intent prediction, optional)
  - `CONVEX_URL` — Convex deployment URL (for persistence, optional)

### Quick Start

```bash
# 1. Clone and install
git clone https://github.com/LivioGama/iris-chan.git
cd iris-chan
bun install

# 2. Set your Gemini API key
export GEMINI_API_KEY=your_key_here

# 3. Run
bun run dev

# You should see:
#   - Transparent avatar window on your desktop
#   - Console logs showing module initialization
#   - Debug dots in bottom-right corner
#   - Avatar with procedural animations (blink, head look, lip sync)
```

### Test Voice Conversation

1. Launch with `bun run dev`
2. Grant **Microphone** permission when prompted
3. Grant **Screen Recording** in System Settings → Privacy & Security
4. Start speaking — Iris responds via Gemini native audio
5. Try: "Open Safari", "Search for the weather", "What do you see on my screen?"

### Test Desktop Automation

```bash
# Iris can control your Mac via voice or tool calls:
# "Open Terminal"           → activates Terminal.app
# "Type hello world"        → types text in focused field
# "Press cmd+c"             → keyboard shortcut
# "Take a screenshot"       → captures and analyzes screen
# "Click at 500, 300"       → clicks screen coordinates
```

### Test 2FA Auto-Fill

1. Grant **Accessibility** permission in System Settings → Privacy & Security → Accessibility
2. Navigate to any page with a 2FA/OTP input field
3. Send yourself a verification code via iMessage
4. Focus the 2FA field — Iris detects it, reads the code, and auto-fills

### Test Chess Module

```bash
# Open chess.com and start a game against computer
# Iris will analyze the board via Gemini Vision and make moves
```

### Run the Hackathon Demo

Iris can present herself with a fully narrated 26-step demo:

```bash
# During normal operation, say:
"Present yourself"
# or "Start demo" or "Show what you can do"
```

The demo showcases:
1. **Introduction** — Iris explains who she is
2. **Web Search** — Opens Safari, searches Google Images, identifies a person
3. **Chess** — Opens chess.com, makes e4 + d4 moves via vision + clicking
4. **Skill Creation** — Creates a skill, generates + edits an image
5. **2FA Auto-Fill** — Detects field, reads SMS code, auto-fills with confidence
6. **Closing** — Architecture recap

### macOS Permissions Required

| Permission | Location | Required For |
|-----------|----------|-------------|
| Screen Recording | System Settings → Privacy → Screen Recording | Screenshots, screen analysis |
| Accessibility | System Settings → Privacy → Accessibility | 2FA detection, automation, input monitoring |
| Microphone | Auto-prompted on first use | Voice conversation |

## Project Stats

- **~160 source files**, 30+ subsystems
- **21+ built-in tools** for Gemini function calling
- **11 Convex tables** with 1024-dim vector embeddings
- **260+ vocabulary terms** with fuzzy matching
- **5 Gemini API integrations** (WebSocket audio, vision, search, enrichment, detection)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron + Bun |
| 3D Avatar | Three.js + VRM |
| Voice | WebAudio (16kHz capture, 24kHz playback) |
| AI Chat | Gemini 2.5 Flash Native Audio (WebSocket) |
| Vision | Gemini 3 Flash (REST) |
| Intent | Groq LLaMA 3.3-70B |
| Coding | Claude Agent SDK |
| Database | Convex (11 tables, 1024-dim vectors) |
| Automation | AppleScript + CGEvent |
| Blog | Ghost CMS API |
| Multi-Agent | MACP Protocol |

## License

AGPL-3.0 — see [LICENSE](LICENSE)
