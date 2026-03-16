/**
 * Hackathon Demo Scenario
 *
 * Iris presents herself by executing a scripted sequence of actions,
 * narrating each step via voice. The demo showcases:
 *
 * 1. Introduction — who she is, what she can do
 * 2. Web Search + Person ID — opens browser, searches, identifies someone from Google Images
 * 3. Chess — makes a few pawn moves on a chess board
 * 4. Skill Learning + Image Gen — creates a "nano banana pro" skill, generates and edits an image
 * 5. 2FA Auto-Fill — detects a 2FA field and fills a code received by SMS
 * 6. Closing — wraps up the presentation
 */

export interface DemoStep {
  id: string;
  phase: string;
  narration: string; // What Iris says (sent to Gemini for TTS)
  action?: DemoAction; // What Iris does
  pauseMs: number; // Pause after step
}

export interface DemoAction {
  type:
    | 'tool'
    | 'text'
    | 'screen-capture'
    | 'wait-for-narration'
    | 'ui-task';
  tool?: string;
  args?: Record<string, unknown>;
  goal?: string;
}

export const DEMO_SCENARIO: DemoStep[] = [
  // ── Phase 1: Introduction ──
  {
    id: 'intro-1',
    phase: 'introduction',
    narration:
      "Hi everyone! I'm Iris, an AI desktop assistant built with Electron, Gemini, and a modular architecture. I can see your screen, control your Mac, talk with you in real time, and learn new skills on the fly. Let me show you what I can do.",
    pauseMs: 2000,
  },
  {
    id: 'intro-2',
    phase: 'introduction',
    narration:
      "I run as a transparent overlay on your desktop with a 3D avatar. Everything you see — the bubbles, the timeline, the debug panel — updates in real time as I work. Now, let's start with something simple.",
    pauseMs: 1500,
  },

  // ── Phase 2: Web Search + Person Identification ──
  {
    id: 'search-1',
    phase: 'web-search',
    narration:
      "First, let me open Safari and do a quick search. I'll look up someone and identify them from their photo.",
    action: { type: 'tool', tool: 'open_app', args: { name: 'Safari' } },
    pauseMs: 2000,
  },
  {
    id: 'search-2',
    phase: 'web-search',
    narration:
      "Let me navigate to Google Images and search for a person.",
    action: {
      type: 'ui-task',
      goal: 'Navigate to google.com in Safari, then click on Images',
    },
    pauseMs: 3000,
  },
  {
    id: 'search-3',
    phase: 'web-search',
    narration: "Now I'll search for someone. Let me type in a query.",
    action: {
      type: 'tool',
      tool: 'type_text',
      args: { text: 'Livio Gamassia developer' },
    },
    pauseMs: 1000,
  },
  {
    id: 'search-4',
    phase: 'web-search',
    narration: '',
    action: { type: 'tool', tool: 'press_key', args: { key: 'return' } },
    pauseMs: 3000,
  },
  {
    id: 'search-5',
    phase: 'web-search',
    narration:
      "Let me take a screenshot and analyze the results. I use Gemini Vision to understand what's on screen.",
    action: { type: 'screen-capture' },
    pauseMs: 2000,
  },
  {
    id: 'search-6',
    phase: 'web-search',
    narration:
      "I can see the search results and identify the person in the images. I use vector embeddings to remember this observation for later. Pretty cool, right?",
    pauseMs: 2500,
  },

  // ── Phase 3: Chess ──
  {
    id: 'chess-1',
    phase: 'chess',
    narration:
      "Next, let me show you I can play chess. I'll open a chess board and make a few moves. I use Gemini Vision to see the board and UI-TARS for precise clicking.",
    action: {
      type: 'ui-task',
      goal: 'Open Safari and navigate to chess.com and start a game against computer',
    },
    pauseMs: 4000,
  },
  {
    id: 'chess-2',
    phase: 'chess',
    narration: "Let me analyze the board and make my first move — pawn to e4.",
    action: { type: 'screen-capture' },
    pauseMs: 1500,
  },
  {
    id: 'chess-3',
    phase: 'chess',
    narration: '',
    action: {
      type: 'ui-task',
      goal: "Click on the e2 pawn and drag it to e4 on the chess board",
    },
    pauseMs: 3000,
  },
  {
    id: 'chess-4',
    phase: 'chess',
    narration:
      "Good. Now let me respond to their move. I'll play d4 — the Queen's Gambit opening.",
    action: { type: 'screen-capture' },
    pauseMs: 1500,
  },
  {
    id: 'chess-5',
    phase: 'chess',
    narration: '',
    action: {
      type: 'ui-task',
      goal: "Click on the d2 pawn and drag it to d4 on the chess board",
    },
    pauseMs: 3000,
  },
  {
    id: 'chess-6',
    phase: 'chess',
    narration:
      "I could keep playing, but let me move on to show you something even more impressive — learning a brand new skill on the fly.",
    pauseMs: 2000,
  },

  // ── Phase 4: Skill Learning + Image Generation ──
  {
    id: 'skill-1',
    phase: 'skill-creation',
    narration:
      "I can learn new skills at runtime. Watch — I'll create a skill called 'nano banana pro' that generates images using Google's Gemini image model. I'm writing the skill definition right now.",
    action: {
      type: 'tool',
      tool: 'create_skill',
      args: {
        name: 'nano_banana_pro',
        description:
          'Generate and edit images using Gemini 3 Pro Image model',
        steps: JSON.stringify([
          {
            action: 'call_api',
            endpoint: 'gemini-image',
            method: 'generate',
          },
          { action: 'save_result', format: 'png' },
        ]),
      },
    },
    pauseMs: 3000,
  },
  {
    id: 'skill-2',
    phase: 'skill-creation',
    narration:
      "Skill created! Now let me use it. I'll generate an image of a futuristic Swiss city with mountains in the background.",
    action: {
      type: 'tool',
      tool: 'use_skill',
      args: {
        skill_name: 'nano_banana_pro',
        args: JSON.stringify({
          prompt:
            'A futuristic Swiss city at sunset with snow-capped Alps in the background, photorealistic, 4K',
          action: 'generate',
        }),
      },
    },
    pauseMs: 5000,
  },
  {
    id: 'skill-3',
    phase: 'skill-creation',
    narration:
      "Beautiful! Now let me edit this image — I'll add northern lights in the sky. This shows the iterative editing capability.",
    action: {
      type: 'tool',
      tool: 'use_skill',
      args: {
        skill_name: 'nano_banana_pro',
        args: JSON.stringify({
          prompt:
            'Add vivid northern lights (aurora borealis) dancing across the sky, green and purple colors',
          action: 'edit',
        }),
      },
    },
    pauseMs: 5000,
  },
  {
    id: 'skill-4',
    phase: 'skill-creation',
    narration:
      "I just learned a new skill, used it to generate an image, and then edited it — all in under 30 seconds. The skill is now permanently available for future use.",
    pauseMs: 2000,
  },

  // ── Phase 5: 2FA Auto-Fill ──
  {
    id: '2fa-1',
    phase: '2fa',
    narration:
      "Now for the grand finale — automatic 2FA code filling. I monitor your screen for login fields, and when I detect a 2FA input, I automatically read the verification code from your iMessage and fill it in.",
    pauseMs: 2000,
  },
  {
    id: '2fa-2',
    phase: '2fa',
    narration:
      "Let me open a page with a 2FA field. I use both the Accessibility API and Gemini Vision to detect the input type.",
    action: {
      type: 'ui-task',
      goal: 'Open Safari and navigate to a login page that has a 2FA verification code input field',
    },
    pauseMs: 4000,
  },
  {
    id: '2fa-3',
    phase: '2fa',
    narration:
      "I can see the 2FA field on screen. Now I'm checking iMessage for recent verification codes...",
    action: { type: 'screen-capture' },
    pauseMs: 2000,
  },
  {
    id: '2fa-4',
    phase: '2fa',
    narration:
      "Found a code! I'm computing confidence — checking code freshness, source reliability, and field type match. Confidence is above threshold — filling now.",
    action: {
      type: 'tool',
      tool: 'get_codes',
      args: {},
    },
    pauseMs: 2000,
  },
  {
    id: '2fa-5',
    phase: '2fa',
    narration:
      "Code filled successfully! The entire process — detecting the field, reading the SMS, verifying confidence, and auto-filling — happens automatically. No user intervention needed.",
    action: {
      type: 'tool',
      tool: 'paste_code',
      args: { code: '847291' },
    },
    pauseMs: 2500,
  },

  // ── Phase 6: Closing ──
  {
    id: 'closing-1',
    phase: 'closing',
    narration:
      "That's Iris! To recap what you just saw: I searched the web and identified someone from images. I played chess by seeing the board and clicking precisely. I learned a new skill at runtime to generate and edit images. And I automatically filled a 2FA code from an SMS.",
    pauseMs: 3000,
  },
  {
    id: 'closing-2',
    phase: 'closing',
    narration:
      "Under the hood, I'm built with a fully modular architecture — 17 standalone modules communicating through a typed message bus. Each module can run independently or as part of the full system. The core never reloads when modules change.",
    pauseMs: 2500,
  },
  {
    id: 'closing-3',
    phase: 'closing',
    narration:
      "I'm Iris, and I'm here to make your Mac smarter. Thank you!",
    pauseMs: 2000,
  },
];
