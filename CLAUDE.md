# Iris-chan Project Rules

## Mandatory: Verify before declaring done
Never assume a feature works. Before telling the user it's done:
1. Write a concrete end-to-end test (even a throwaway script) that proves the feature works
2. Check actual output/logs/recordings — not just "process started successfully"
3. For audio/video pipelines: record a sample, verify it contains actual data (not silence/empty)
4. For IPC chains: verify data flows through every hop with logged evidence
5. If you can't fully verify from CLI, state exactly what's unverified and why

## Development

```bash
bun run dev
```
