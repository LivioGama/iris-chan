type Lane = 'chat' | 'context' | 'thinking';
type Role = 'user' | 'iris';

interface BubbleOptions {
  text: string;
  lane?: Lane;
  role?: Role;
  durationMs?: number;
}

const container = () => document.getElementById('bubbles')!;

const AUTO_HIDE_BASE: Record<Lane, number> = {
  chat: 2600,
  context: 1800,
  thinking: 2000,
};

const AUTO_HIDE_MAX: Record<Lane, number> = {
  chat: 32000,
  context: 24000,
  thinking: 28000,
};

const calcDuration = (text: string, lane: Lane): number => {
  const base = AUTO_HIDE_BASE[lane];
  const max = AUTO_HIDE_MAX[lane];
  const charBonus = text.length * 30;
  const wordBonus = text.split(/\s+/).length * 85;
  const punctBonus = (text.match(/[.!?,;:]/g)?.length ?? 0) * 90;
  return Math.min(max, base + charBonus + wordBonus + punctBonus);
};

const activeTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

const fadeOut = (el: HTMLElement) => {
  el.style.opacity = '0';
  el.style.transform = 'scale(0.98)';
  setTimeout(() => el.remove(), 300);
};

export const showBubble = (opts: BubbleOptions): HTMLElement => {
  const { text, lane = 'chat', role = 'iris' } = opts;

  const el = document.createElement('div');
  el.className = `bubble lane-${lane} role-${role}`;
  el.textContent = text;
  container().appendChild(el);

  // Force reflow then animate in
  el.offsetHeight;
  el.style.opacity = '1';

  const duration = opts.durationMs ?? calcDuration(text, lane);
  const timer = setTimeout(() => {
    fadeOut(el);
    activeTimers.delete(el);
  }, duration);
  activeTimers.set(el, timer);

  return el;
};

let streamingBubble: HTMLElement | null = null;

export const showStreamingBubble = (
  token: string,
  lane: Lane = 'chat',
  role: Role = 'iris',
): HTMLElement => {
  if (!streamingBubble) {
    streamingBubble = document.createElement('div');
    streamingBubble.className = `bubble lane-${lane} role-${role}`;
    streamingBubble.textContent = '';
    container().appendChild(streamingBubble);
    streamingBubble.offsetHeight;
    streamingBubble.style.opacity = '1';
  }
  streamingBubble.textContent += token;
  return streamingBubble;
};

export const finalizeStreamingBubble = (): void => {
  if (!streamingBubble) return;
  const el = streamingBubble;
  streamingBubble = null;

  const duration = calcDuration(el.textContent ?? '', 'chat');
  const timer = setTimeout(() => {
    fadeOut(el);
    activeTimers.delete(el);
  }, duration);
  activeTimers.set(el, timer);
};

export const clearBubbles = (): void => {
  for (const [el, timer] of activeTimers) {
    clearTimeout(timer);
    el.remove();
  }
  activeTimers.clear();
  streamingBubble = null;
  container().innerHTML = '';
};
