import type { IrisModule, ModuleHealth } from './types';

type ModuleStatus = 'loading' | 'running' | 'stopped' | 'error';

interface RegisteredModule {
  instance: IrisModule;
  status: ModuleStatus;
  error?: string;
}

export class ModuleRegistry {
  private modules = new Map<string, RegisteredModule>();
  private capabilities = new Map<string, string>(); // capability -> module name

  register(mod: IrisModule): void {
    const name = mod.manifest.name;
    this.modules.set(name, { instance: mod, status: 'loading' });
    for (const cap of mod.manifest.capabilities) {
      this.capabilities.set(cap, name);
    }
  }

  setStatus(name: string, status: ModuleStatus, error?: string): void {
    const entry = this.modules.get(name);
    if (entry) {
      entry.status = status;
      entry.error = error;
    }
  }

  unregister(name: string): void {
    const entry = this.modules.get(name);
    if (entry) {
      for (const cap of entry.instance.manifest.capabilities) {
        if (this.capabilities.get(cap) === name) {
          this.capabilities.delete(cap);
        }
      }
      this.modules.delete(name);
    }
  }

  get(name: string): IrisModule | undefined {
    return this.modules.get(name)?.instance;
  }

  getByCapability(cap: string): IrisModule | undefined {
    const name = this.capabilities.get(cap);
    return name ? this.get(name) : undefined;
  }

  listAll(): Array<{ name: string; status: ModuleStatus; error?: string }> {
    return Array.from(this.modules.entries()).map(([name, entry]) => ({
      name,
      status: entry.status,
      error: entry.error,
    }));
  }

  getHealth(): Record<string, ModuleHealth> {
    const result: Record<string, ModuleHealth> = {};
    for (const [name, entry] of this.modules) {
      if (entry.status === 'running') {
        try {
          result[name] = entry.instance.getHealth();
        } catch {
          result[name] = { status: 'error', message: 'Health check threw' };
        }
      } else {
        result[name] = {
          status: entry.status === 'error' ? 'error' : 'degraded',
          message: entry.error ?? `Module is ${entry.status}`,
        };
      }
    }
    return result;
  }
}
