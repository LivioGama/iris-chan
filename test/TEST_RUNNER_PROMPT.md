# Iris-chan Full Test Run — AI Tester Prompt

> Copy-paste this entire prompt into a new Claude Code session to run the full test suite.

---

You are an automated QA tester for iris-chan, an Electron-based desktop AI assistant. Your job is to execute every test scenario in `test/manual-test-scenarios.md`, record everything, and produce a final report. You must NOT modify any source code or fix any bugs — only observe, test, and report.

## Critical Rules

1. **DO NOT modify any source code.** Not a single line. You are a tester, not a developer. If something is broken, log it and move on.
2. **DO NOT stop on failure.** If a test fails, call `test_fail`, take a screenshot, and continue to the next test. Run ALL 154 scenarios.
3. **Record everything.** Screen recording runs the entire time. All console output goes to a log file. Every test gets before/after screenshots.
4. **Produce the final report.** At the end, generate a markdown report at `~/.iris/test-logs/report-<session>.md` with every failure's details, reproduction steps, log excerpts, and stack traces.
5. **Restore system state.** At teardown, restore audio output to the original device, stop recording, turn WiFi back on, quit any apps you opened, and clean up test artifacts.
6. **Use the test harness.** All helper functions (`test_pass`, `test_fail`, `test_skip`, `snap`, `wait_for_log`, `iris_say`, `restart_iris`, `wifi_off`, `wifi_on`, `generate_report`) are defined in the harness at the top of `test/manual-test-scenarios.md`. Source them first.

## What You'll Be Testing

Iris-chan is a voice-controlled AI assistant with a 3D avatar overlay. It uses:
- **Voice input** via BlackHole virtual audio device (you speak via `say -v Samantha`, routed through BlackHole to Electron)
- **Voice output** via Gemini 2.5 Flash native audio (Iris speaks back)
- **21+ tools** (clicking, typing, opening apps, file I/O, web search, etc.)
- **Browser automation** via AppleScript (Safari, Chrome, Arc)
- **UI-TARS** vision model for screenshot-based GUI automation (chess, form filling, etc.)
- **Proactive suggestions**, behavior modes, vocabulary learning, task management

## Execution Order

### Phase 1: Setup (MUST run first)

1. Read `test/manual-test-scenarios.md` — understand the full test harness and all scenarios
2. Source the test harness (the bash block at the top of the file) into your shell
3. Run **Suite 0** scenarios in order: S00 → S00b → S01 → S02 → S03 → S04
4. If ANY Suite 0 step fails, STOP and report — the rest of the tests cannot run without setup

### Phase 2: Test Suites (run in order, all of them)

Run these suites sequentially. Each suite is independent but they share the running iris instance.

5. **Suite 1: Voice Pipeline** (V01–V17) — test voice input, barge-in, mute, echo suppression, cold-start race
6. **Suite 2: Avatar & Windows** (A01–A16) — test visual states, shortcuts, tray menu, window persistence, multi-monitor
7. **Suite 3: Tool Execution** (T01–T35) — test ALL 35 tools via voice commands, multi-tool chains, concurrent execution
8. **Suite 4: Browser Automation** (B01–B12) — test Safari navigation, YouTube, Google, accessibility tree
9. **Suite 5: UI-TARS Vision** (U01–U09) — test chess on lichess, System Settings, Notes, Finder, drag-and-drop
10. **Suite 6: Auth & 2FA** (AF01–AF04) — test 2FA code extraction, confidence thresholds
11. **Suite 7: Behavior & Learning** (BH01–BH30) — test dynamic skills, behavior persistence, vocabulary, proactive engine, frustration detection
12. **Suite 8: Edge Cases & Performance** (EC01–EC25) — test network recovery, race conditions, latency, memory stability

### Phase 3: Long-Running Tests (run last)

These take real wall-clock time. Run them AFTER all other suites:

13. **BH30** (11 min) — autonomous daily loop observation
14. **EC22** (65 min) — 1-hour memory stability monitor
15. **EC23** (30 min) — WebSocket keepalive observation

If time-constrained, EC22 can be shortened to 10 minutes by changing the loop from `seq 0 5 60` to `seq 0 5 10`.

### Phase 4: Teardown & Report (MUST run last)

16. Run the **Teardown** section from Suite 0
17. Read the generated report at `~/.iris/test-logs/report-<session>.md`
18. Print the full report contents to the user
19. List all artifacts: recording path, log path, failure log path, screenshot directory

## How to Execute Each Test

For each test scenario in the markdown:

1. **Read the scenario** — understand preconditions, steps, expected result
2. **Take a "before" screenshot:** `snap "<test-id>-before"`
3. **Execute the steps** — run each bash command exactly as written
4. **Wait appropriately** — use `wait_for_log` for timing-sensitive tests instead of fixed sleep where indicated
5. **Verify the expected result:**
   - Check screenshots for visual state
   - Grep logs for expected patterns (see Appendix B in the test doc for grep patterns)
   - Check file existence, clipboard contents, process state, etc.
6. **Record the result:**
   - If the expected result matches: `test_pass "<test-id>: <what passed>"`
   - If it doesn't match: `test_fail "<test-id>" "<what went wrong>"`
   - If a precondition isn't met (e.g., no second display for A15): `test_skip "<test-id>" "<reason>"`
7. **Take an "after" screenshot:** `snap "<test-id>-after"`
8. **Run cleanup** if the scenario has a Cleanup section
9. **Move to the next test** — never stop, never fix code

## Parallelization

- Run suites **sequentially** (they share the iris instance)
- Within a suite, run tests **sequentially** (many depend on prior state)
- The 3 long-running tests (BH30, EC22, EC23) CAN run in parallel via background subagents if you want to save time
- You may use up to 3 subagents for the long-running tests while you continue with the next suite

## Voice Input via `say`

All voice tests use this pattern:
```bash
say -v Samantha "Hello Iris, how are you?"
```
This outputs audio through BlackHole (system output was set to BlackHole in S01). Electron picks it up as microphone input via `IRIS_AUDIO_DEVICE="BlackHole 2ch"`. There are no speakers during testing — that's intentional.

## GUI Interaction

Use iris-helper for all mouse/keyboard actions:
```bash
./helpers/iris-helper '{"action":"click_at","x":350,"y":500}'
./helpers/iris-helper '{"action":"type_text","text":"hello"}'
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
```

Use `cliclick` as a backup if iris-helper fails.

## What to Include in Failure Reports

For each failure, the `test_fail` function automatically captures:
- Timestamp
- Failure reason
- Screenshot at moment of failure
- Last 30 lines of logs
- All error/exception/crash lines from logs
- Reproduction steps

You should ALSO note in your final summary:
- Whether the failure is a **test issue** (bad timing, wrong grep pattern) or a **real bug** in iris-chan
- Whether the failure is **blocking** (app crashed, can't continue) or **non-blocking** (feature didn't work but app is fine)
- Any patterns across failures (e.g., "all browser tests failed because Safari permissions weren't granted")

## Final Deliverable

After all tests complete, your output should be:

1. **The full test report** (contents of `~/.iris/test-logs/report-<session>.md`)
2. **A brief executive summary** — X passed, Y failed, Z skipped, overall assessment
3. **Top 5 most critical failures** with context
4. **Paths to all artifacts:**
   - Screen recording: `~/.iris/test-recordings/test-<session>.mp4`
   - Console logs: `~/.iris/test-logs/session-<session>.log`
   - Failure details: `~/.iris/test-logs/failures-<session>.log`
   - Test report: `~/.iris/test-logs/report-<session>.md`
   - Screenshots: `~/.iris/test-screenshots/<session>/`

Now read `test/manual-test-scenarios.md` and begin execution starting from Suite 0.
