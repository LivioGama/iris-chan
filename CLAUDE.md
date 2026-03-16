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

<!-- MACP-MCP:START -->
## MACP Coordination

MACP is active for this project. The shared project id is `iris-chan`. The MCP server auto-registers this session on startup and auto-joins the default channel `iris-chan`.

Normal workflow:
- do not run SQL directly
- do not manually attach another MACP server inside the agent loop
- call `macp_poll` regularly to stay aware of peer work
- call `macp_send_channel` for shared updates and `macp_send_direct` for one-to-one requests
- call `macp_ack` after acting on a delivery
- use `macp_ext_claim_files`, shared memory, tasks, goals, and vault tools when this project requires them

If this project uses shared memory, tasks, goals, or the vault, follow the local instructions in this file and use those tools as part of normal work.
<!-- MACP-MCP:END -->
