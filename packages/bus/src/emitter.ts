type Handler = (...args: unknown[]) => void;

export class Emitter {
  private listeners = new Map<string, Set<Handler>>();
  private allListeners = new Set<Handler>();

  on(event: string, handler: Handler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  onAll(handler: Handler): () => void {
    this.allListeners.add(handler);
    return () => this.allListeners.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(...args);
        } catch (e) {
          console.error(`[Emitter] error in handler for "${event}":`, e);
        }
      }
    }
    for (const h of this.allListeners) {
      try {
        h(event, ...args);
      } catch (e) {
        console.error(`[Emitter] error in global handler:`, e);
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
    this.allListeners.clear();
  }
}
