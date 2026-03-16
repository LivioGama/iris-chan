# Iris v2 — Project Rules

## Architecture

This is a modular Electron desktop AI assistant. The architecture is:

- **packages/core/** — Minimal Electron shell. NEVER import module code here.
- **packages/bus/** — Typed pub/sub message bus (no Electron dependency).
- **packages/renderer/** — Avatar window + UI components (Three.js).
- **packages/mod-*/** — Feature modules. Each is standalone.

## Module Contract

Every module implements `IrisModule` (start/stop/getHealth) and has a `manifest.json`.
Modules communicate ONLY through the bus — no direct imports between modules.

## Development

```bash
bun run dev          # Launch Electron with hot-reload
bun run packages/mod-*/src/standalone.ts  # Run any module independently
```

## Rules

- Use bun, never npm/yarn
- Modules must never import from other modules directly
- Core must never import module code
- All cross-module communication goes through the bus
- Each module must clean up all resources in stop()
- New features = new module or extend existing module, never touch core
