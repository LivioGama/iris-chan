import { readdirSync, existsSync, readFileSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Bus } from '@iris/bus';
import { CH } from '@iris/bus';
import { ModuleRegistry } from './module-registry';
import { createLogger } from './logger';
import type {
  IrisModule,
  ModuleManifest,
  ModuleContext,
  IrisPaths,
  SettingsAccessor,
} from './types';

interface ModuleEntry {
  manifest: ModuleManifest;
  dir: string;
  entryPath: string;
}

const topologicalSort = (entries: ModuleEntry[]): ModuleEntry[] => {
  const nameMap = new Map(entries.map((e) => [e.manifest.name, e]));
  const visited = new Set<string>();
  const sorted: ModuleEntry[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const entry = nameMap.get(name);
    if (!entry) return;
    for (const dep of entry.manifest.dependencies) {
      visit(dep);
    }
    sorted.push(entry);
  };

  for (const entry of entries) {
    visit(entry.manifest.name);
  }

  return sorted;
};

export const createModuleLoader = (
  bus: Bus,
  registry: ModuleRegistry,
  settings: SettingsAccessor,
  paths: IrisPaths,
) => {
  const log = createLogger('module-loader');
  const loadedPaths = new Map<string, string>(); // module name -> entry path

  const discoverModules = (): ModuleEntry[] => {
    const packagesDir = resolve(paths.projectRoot, 'packages');
    const entries: ModuleEntry[] = [];

    for (const dir of readdirSync(packagesDir)) {
      if (!dir.startsWith('mod-')) continue;

      const modDir = join(packagesDir, dir);
      const manifestPath = join(modDir, 'manifest.json');

      if (!existsSync(manifestPath)) {
        log.warn(`Module ${dir} has no manifest.json, skipping`);
        continue;
      }

      try {
        const manifest: ModuleManifest = JSON.parse(
          readFileSync(manifestPath, 'utf-8'),
        );
        const entryPath = join(modDir, 'src', 'index.ts');

        if (!existsSync(entryPath)) {
          log.warn(`Module ${dir} has no src/index.ts, skipping`);
          continue;
        }

        entries.push({ manifest, dir: modDir, entryPath });
      } catch (e) {
        log.error(`Failed to parse manifest for ${dir}:`, e);
      }
    }

    return entries;
  };

  const createContext = (manifest: ModuleManifest): ModuleContext => ({
    bus: bus.createClient(manifest.name),
    settings,
    env: process.env as Record<string, string>,
    paths,
    logger: createLogger(manifest.name),
  });

  const loadModule = async (entry: ModuleEntry): Promise<void> => {
    const { manifest, entryPath } = entry;
    const name = manifest.name;

    log.info(`Loading module: ${name}`);

    try {
      const mod = require(entryPath);
      const moduleInstance: IrisModule =
        mod.default ?? mod.createModule?.() ?? mod;

      if (
        !moduleInstance.manifest ||
        !moduleInstance.start ||
        !moduleInstance.stop
      ) {
        throw new Error(
          `Module "${name}" does not implement IrisModule interface`,
        );
      }

      registry.register(moduleInstance);
      loadedPaths.set(name, entryPath);

      const ctx = createContext(manifest);
      await moduleInstance.start(ctx);

      registry.setStatus(name, 'running');
      bus.publish(CH.CORE_MODULE_LOADED, { name }, 'core');
      log.info(`Module loaded: ${name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Failed to load module "${name}": ${msg}`);
      registry.setStatus(name, 'error', msg);
    }
  };

  const clearRequireCache = (moduleDir: string) => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(moduleDir)) {
        delete require.cache[key];
      }
    }
  };

  return {
    async loadAll(): Promise<void> {
      const entries = discoverModules();
      const sorted = topologicalSort(entries);

      log.info(
        `Discovered ${sorted.length} modules: ${sorted.map((e) => e.manifest.name).join(', ')}`,
      );

      for (const entry of sorted) {
        await loadModule(entry);
      }
    },

    async reload(moduleName: string): Promise<void> {
      const mod = registry.get(moduleName);
      const entryPath = loadedPaths.get(moduleName);

      if (mod) {
        log.info(`Stopping module for reload: ${moduleName}`);
        try {
          await mod.stop();
        } catch (e) {
          log.error(`Error stopping module "${moduleName}":`, e);
        }
        registry.unregister(moduleName);
        bus.publish(CH.CORE_MODULE_UNLOADED, { name: moduleName }, 'core');
      }

      if (entryPath) {
        const modDir = resolve(entryPath, '..', '..');
        clearRequireCache(modDir);

        const manifestPath = join(modDir, 'manifest.json');
        const manifest: ModuleManifest = JSON.parse(
          readFileSync(manifestPath, 'utf-8'),
        );

        await loadModule({ manifest, dir: modDir, entryPath });
      }
    },

    async unload(moduleName: string): Promise<void> {
      const mod = registry.get(moduleName);
      if (mod) {
        await mod.stop();
        registry.unregister(moduleName);
        loadedPaths.delete(moduleName);
        bus.publish(CH.CORE_MODULE_UNLOADED, { name: moduleName }, 'core');
        log.info(`Unloaded module: ${moduleName}`);
      }
    },

    async stopAll(): Promise<void> {
      const modules = registry.listAll();
      for (const { name } of modules.reverse()) {
        const mod = registry.get(name);
        if (mod) {
          try {
            await mod.stop();
            registry.setStatus(name, 'stopped');
          } catch (e) {
            log.error(`Error stopping module "${name}":`, e);
          }
        }
      }
    },

    startDevWatcher(): void {
      const packagesDir = resolve(paths.projectRoot, 'packages');

      for (const dir of readdirSync(packagesDir)) {
        if (!dir.startsWith('mod-')) continue;
        const srcDir = join(packagesDir, dir, 'src');
        if (!existsSync(srcDir)) continue;

        const moduleName = dir.replace('mod-', '');
        let debounce: ReturnType<typeof setTimeout> | null = null;

        watch(srcDir, { recursive: true }, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            log.info(`File change detected in ${dir}, reloading...`);
            this.reload(moduleName).catch((e) =>
              log.error(`Reload failed for ${moduleName}:`, e),
            );
          }, 500);
        });

        log.info(`Watching ${dir}/src/ for changes`);
      }
    },
  };
};
