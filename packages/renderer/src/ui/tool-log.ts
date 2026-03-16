const MAX_ENTRIES = 5;
const AUTO_HIDE_MS = 2000;

interface ToolEntry {
  id: string;
  name: string;
  detail?: string;
  counter?: string; // e.g. "[1/5]"
  status: 'running' | 'success' | 'attention';
}

const container = () => document.getElementById('tool-log')!;

const activeEntries = new Map<string, HTMLElement>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const STATUS_ICON: Record<string, string> = {
  running: '⟳',
  success: '✓',
  attention: '⚠',
};

const show = () => {
  container().style.display = 'block';
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

const scheduleHide = () => {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    container().style.display = 'none';
    activeEntries.clear();
    container().innerHTML = '';
  }, AUTO_HIDE_MS);
};

export const addToolEntry = (entry: ToolEntry): void => {
  show();

  let el = activeEntries.get(entry.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'tool-entry';
    container().appendChild(el);
    activeEntries.set(entry.id, el);

    // Trim oldest
    while (container().children.length > MAX_ENTRIES) {
      const oldest = container().firstElementChild as HTMLElement;
      if (oldest) {
        for (const [id, elem] of activeEntries) {
          if (elem === oldest) {
            activeEntries.delete(id);
            break;
          }
        }
        oldest.remove();
      }
    }
  }

  el.className = `tool-entry tool-${entry.status}`;
  el.innerHTML = `
    <span class="tool-icon ${entry.status === 'running' ? 'tool-spin' : ''}">${STATUS_ICON[entry.status]}</span>
    ${entry.counter ? `<span class="tool-counter">${entry.counter}</span>` : ''}
    <span class="tool-name">${entry.name}</span>
    ${entry.detail ? `<span class="tool-detail">${entry.detail}</span>` : ''}
  `;
};

export const updateToolStatus = (
  id: string,
  status: 'success' | 'attention',
): void => {
  const el = activeEntries.get(id);
  if (el) {
    el.className = `tool-entry tool-${status}`;
    const icon = el.querySelector('.tool-icon');
    if (icon) {
      icon.textContent = STATUS_ICON[status];
      icon.classList.remove('tool-spin');
    }
  }

  // Check if all are done
  const allDone = Array.from(activeEntries.values()).every((e) =>
    e.classList.contains('tool-success') || e.classList.contains('tool-attention'),
  );
  if (allDone) scheduleHide();
};
