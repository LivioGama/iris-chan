type Indicator =
  | 'ws'
  | 'mic'
  | 'voice'
  | 'send'
  | 'think'
  | 'speak'
  | 'tool'
  | 'srch'
  | 'auto'
  | '2fa';

const dots = new Map<Indicator, HTMLElement>();

export const initIndicators = (): void => {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;

  for (const el of panel.querySelectorAll('.dbg-dot')) {
    const classes = Array.from(el.classList);
    const indicator = classes
      .find((c) => c.startsWith('dbg-') && c !== 'dbg-dot')
      ?.replace('dbg-', '') as Indicator | undefined;
    if (indicator) {
      dots.set(indicator, el as HTMLElement);
    }
  }
};

export const setIndicator = (name: Indicator, active: boolean): void => {
  const dot = dots.get(name);
  if (!dot) return;
  dot.classList.toggle('active', active);
};

export const setIndicators = (
  updates: Partial<Record<Indicator, boolean>>,
): void => {
  for (const [name, active] of Object.entries(updates)) {
    setIndicator(name as Indicator, active!);
  }
};
