# Iris-chan Project Rules

## After code changes
Tool modules in `src/main/tools/` hot-reload automatically via a file watcher — no restart needed.
For changes to other files (main process, renderer, preload), restart the Electron app:
```bash
pkill -f "Electron" 2>/dev/null; sleep 1; npx electron . &
```
