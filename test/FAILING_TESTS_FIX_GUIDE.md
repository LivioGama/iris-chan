# Failing Tests — Verified Status

> Last verified: 2026-03-16 13:32 NPT
> All responses cross-checked against actual system state.

## Verified PASS (correct responses confirmed)

| Test | Iris Said | Actual | Verdict |
|------|-----------|--------|---------|
| **P01** | "1:32 PM here in Kathmandu, 2+2=4" | 01:31 PM +0545, 4 | **PASS** — correct time, location, math |
| **P02** | "Monday, March 16, 2026, 3x7=21" | Monday March 16, 21 | **PASS** — correct day, math |
| **P07** | Same as P01 pattern | — | **PASS** — parallel segments work |
| **T05** | `open_app(Safari)` executed, Safari running | pgrep confirms | **PASS** — but tool execution delayed ~15s |

## Remaining Issues

### WebSocket Partial Leak (P01 cosmetic)
First audio chunk still leaks: `[IRIS] The current time is` (4 words) before preemptive suppression kicks in. The parallel response then shows the correct answer. Not blocking — user sees the correct bubble.

### Session Degradation After ~4 Turns
The WebSocket session degrades after ~4 voice turns, causing `heard_but_backend_failed`. Before fix: degraded after 1-2 turns. After payload limit increase: degrades after 4 turns. The REST salvage provides correct answers as fallback.

### T09/T24: STT Mangles File Paths
Gemini STT cannot reliably transcribe Unix file paths. `/tmp/iris-test-output.txt` becomes `test_output.txt`, `attempt_virus_test_output.txt`, or "Temp Iris test output TXT". The `write_file` tool works correctly when given the right path — the problem is the transcription.

This is a fundamental Gemini STT limitation, not a code bug. Workarounds:
- Use clipboard for file paths: `echo "/tmp/foo.txt" | pbcopy` → "write to the path on my clipboard"
- Add path vocabulary corrections (partial mitigation)
