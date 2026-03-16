const MAX_EVENTS = 30;

type Phase =
  | 'thinking'
  | 'tool'
  | 'verify'
  | 'done'
  | '2fa'
  | 'interrupt'
  | 'db'
  | 'default';

interface TimelineEvent {
  type: string;
  title: string;
  message: string;
  timestamp: number;
}

const TYPE_TO_PHASE: Record<string, Phase> = {
  THINKING: 'thinking',
  TOOL_START: 'tool',
  TOOL_END: 'tool',
  ACTION_VERIFY_OK: 'verify',
  ACTION_VERIFY_FAIL: 'verify',
  TASK_DONE: 'done',
  TASK_MILESTONE: 'done',
  TWO_FA_FIELD_DETECTED: '2fa',
  TWO_FA_FILL_START: '2fa',
  TWO_FA_FILL_SUCCESS: '2fa',
  TWO_FA_FILL_FAILED: '2fa',
  TWO_FA_LOW_CONFIDENCE: '2fa',
  TWO_FA_NO_CODE: '2fa',
  INTERRUPT: 'interrupt',
  DB_HEALTH: 'db',
};

const container = () => document.getElementById('activity-timeline')!;

let lastDbCard: HTMLElement | null = null;

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const addTimelineEvent = (event: TimelineEvent): void => {
  const el = container();
  const phase = TYPE_TO_PHASE[event.type] ?? 'default';

  // DB_HEALTH replaces previous health card
  if (phase === 'db' && lastDbCard) {
    lastDbCard.remove();
  }

  const card = document.createElement('div');
  card.className = `tl-card phase-${phase}`;
  card.innerHTML = `
    <div class="tl-header">
      <span class="tl-title">${event.title}</span>
      <span class="tl-time">${formatTime(event.timestamp)}</span>
    </div>
    <div class="tl-body">${event.message}</div>
  `;

  el.appendChild(card);

  if (phase === 'db') {
    lastDbCard = card;
  }

  // Trim oldest
  while (el.children.length > MAX_EVENTS) {
    const oldest = el.firstElementChild;
    if (oldest === lastDbCard) lastDbCard = null;
    oldest?.remove();
  }

  // Scroll to bottom
  el.scrollTop = el.scrollHeight;
};

export const clearTimeline = (): void => {
  container().innerHTML = '';
  lastDbCard = null;
};
