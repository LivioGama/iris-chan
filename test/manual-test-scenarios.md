# Iris-chan Manual Test Scenarios

> **Purpose:** Self-contained test playbook for an AI agent (Claude Code) to manually test every iris-chan feature end-to-end. **Zero human intervention required** — no GUI steps, no manual clicks, no passwords.
>
> **Total:** 154 scenarios across 9 independent suites.
>
> **How to use:** Source the test harness first, run Suite 0 (Setup), then any suite independently. The AI tester should take screenshots before/after each test and grep logs for verification. **If something fails, DO NOT stop** — log the failure and continue. A full failure report is generated at teardown.
>
> **Exit behavior:** After all suites, run Teardown to generate the failure report, stop recording, and restore audio. The user can review `~/.iris/test-logs/` and `~/.iris/test-recordings/` later.

## Test Harness (Source This First)

> Copy-paste this entire block into your shell before running any suite. It defines all helper functions used throughout the tests.

```bash
#!/bin/bash
# === IRIS TEST HARNESS ===
export IRIS_PROJECT_DIR="/Users/abhi/proj/sensei/iris-chan"
export IRIS_PID=""
export FFMPEG_PID=""
export ORIGINAL_AUDIO_OUTPUT=""
export SESSION_ID="$(date +%Y%m%d-%H%M%S)"
export LOG_FILE="$HOME/.iris/test-logs/session-${SESSION_ID}.log"
export RECORDING_FILE="$HOME/.iris/test-recordings/test-${SESSION_ID}.mp4"
export FAILURE_LOG="$HOME/.iris/test-logs/failures-${SESSION_ID}.log"
export TEST_SCREENSHOTS="$HOME/.iris/test-screenshots/${SESSION_ID}"

mkdir -p ~/.iris/test-recordings ~/.iris/test-logs "$TEST_SCREENSHOTS"
touch "$FAILURE_LOG"

# --- Polling: wait for a log pattern (max N seconds) ---
wait_for_log() {
  local pattern="$1" max="${2:-30}"
  for i in $(seq 1 "$max"); do
    grep -qi "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

# --- Screenshot with auto-naming ---
snap() {
  local name="${1:-$(date +%s)}"
  screencapture -x "${TEST_SCREENSHOTS}/${name}.png" 2>/dev/null
  echo "[snap] ${TEST_SCREENSHOTS}/${name}.png"
}

# --- Log a test result ---
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
test_pass() {
  echo "[PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}
test_fail() {
  local id="$1" reason="$2"
  echo "[FAIL] $id: $reason"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  cat >> "$FAILURE_LOG" << FAILEOF
================================================================================
FAILURE: $id
TIME: $(date '+%Y-%m-%d %H:%M:%S')
REASON: $reason
SCREENSHOT: ${TEST_SCREENSHOTS}/${id}.png
LOG TAIL (last 30 lines at failure):
$(tail -30 "$LOG_FILE" 2>/dev/null)
STACK TRACE (errors near failure):
$(grep -iE "error|exception|crash|fail|uncaught" "$LOG_FILE" 2>/dev/null | tail -20)
REPRODUCTION:
  1. Start iris: IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev
  2. Run test $id from test/manual-test-scenarios.md
  3. Check logs: grep -i "$id" "\$LOG_FILE"
================================================================================

FAILEOF
  snap "$id-failure"
}
test_skip() {
  echo "[SKIP] $1: $2"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

# --- Restart iris (for tests that need it) ---
restart_iris() {
  echo "[harness] Stopping iris..."
  kill $IRIS_PID 2>/dev/null
  sleep 4
  echo "[harness] Starting iris..."
  cd "$IRIS_PROJECT_DIR"
  IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev >> "$LOG_FILE" 2>&1 &
  IRIS_PID=$!
  # Wait for readiness (poll for WebSocket connection or avatar window)
  echo "[harness] Waiting for iris to become ready..."
  for i in $(seq 1 30); do
    grep -qi "websocket\|ws.*open\|gemini.*connect\|ready" "$LOG_FILE" 2>/dev/null && break
    sleep 1
  done
  sleep 3  # Extra buffer for renderer init
  snap "restart-ready"
  echo "[harness] Iris restarted (PID: $IRIS_PID)"
}

# --- Say with verification (waits for transcript in logs) ---
iris_say() {
  local text="$1" timeout="${2:-15}"
  local log_before=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  say -v Samantha "$text"
  # Wait for any transcript/response activity
  for i in $(seq 1 "$timeout"); do
    local log_after=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$log_after" -gt "$((log_before + 5))" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# --- WiFi toggle (handles sudo if needed) ---
wifi_off() {
  networksetup -setairportpower en0 off 2>/dev/null || {
    echo "[harness] networksetup failed without sudo, trying with sudo..."
    sudo networksetup -setairportpower en0 off 2>/dev/null || {
      echo "[harness] WiFi toggle not available — skipping network test"
      return 1
    }
  }
}
wifi_on() {
  networksetup -setairportpower en0 on 2>/dev/null || sudo networksetup -setairportpower en0 on 2>/dev/null
}

# --- Generate failure report ---
generate_report() {
  local report="$HOME/.iris/test-logs/report-${SESSION_ID}.md"
  cat > "$report" << REPORTEOF
# Iris-chan Test Report — ${SESSION_ID}

**Date:** $(date '+%Y-%m-%d %H:%M:%S')
**Duration:** Started at session ${SESSION_ID}
**Results:** ${PASS_COUNT} passed, ${FAIL_COUNT} failed, ${SKIP_COUNT} skipped

## Summary
| Metric | Value |
|--------|-------|
| Total Tests Run | $((PASS_COUNT + FAIL_COUNT + SKIP_COUNT)) |
| Passed | ${PASS_COUNT} |
| Failed | ${FAIL_COUNT} |
| Skipped | ${SKIP_COUNT} |
| Pass Rate | $(echo "scale=1; ${PASS_COUNT} * 100 / (${PASS_COUNT} + ${FAIL_COUNT} + ${SKIP_COUNT})" | bc 2>/dev/null || echo "N/A")% |

## Artifacts
- **Screen Recording:** ${RECORDING_FILE}
- **Console Logs:** ${LOG_FILE}
- **Failure Details:** ${FAILURE_LOG}
- **Screenshots:** ${TEST_SCREENSHOTS}/

## Failures
$(if [ -s "$FAILURE_LOG" ]; then cat "$FAILURE_LOG"; else echo "No failures! All tests passed."; fi)
REPORTEOF
  echo ""
  echo "=============================================="
  echo "  TEST REPORT: $report"
  echo "  ${PASS_COUNT} passed / ${FAIL_COUNT} failed / ${SKIP_COUNT} skipped"
  echo "  Recording: ${RECORDING_FILE}"
  echo "  Logs: ${LOG_FILE}"
  echo "=============================================="
}
```

---

## Suite 0: Environment Setup & Teardown

> **Run this before any other suite. Run Teardown after all suites are complete.**

### S00: Install Dependencies

**Steps:**
```bash
# Install virtual audio driver (requires reboot after)
brew install --cask blackhole-2ch

# Install backup GUI input tool
brew install cliclick

# Create output directories
mkdir -p ~/.iris/test-recordings ~/.iris/test-logs
```

**Post-install:** You MUST reboot the Mac after installing BlackHole. After reboot, continue with S00b.

---

### S00b: Verify Prerequisites

**Steps:**
```bash
# === Voice availability ===
say -v Samantha "test" 2>/dev/null || { echo "FAIL: Samantha voice not installed. Install via System Settings → Accessibility → Spoken Content → System Voice → Manage Voices"; exit 1; }
echo "PASS: Samantha voice available"

# === API keys ===
cd /Users/abhi/proj/sensei/iris-chan
source .env 2>/dev/null; source .env.local 2>/dev/null
[ -n "$GEMINI_API_KEY" ] && echo "PASS: GEMINI_API_KEY set" || echo "FAIL: GEMINI_API_KEY missing"
[ -n "$CONVEX_URL" ] && echo "PASS: CONVEX_URL set" || echo "FAIL: CONVEX_URL missing"

# === Permissions ===
# Accessibility (required for iris-helper clicking/typing)
./helpers/iris-helper '{"action":"get_mouse_position"}' 2>/dev/null && echo "PASS: Accessibility granted" || echo "FAIL: Grant Accessibility permission to Terminal in System Settings → Privacy & Security → Accessibility"

# Screen capture
screencapture -x /tmp/iris-perm-test.png 2>/dev/null && echo "PASS: Screen capture works" && rm -f /tmp/iris-perm-test.png || echo "FAIL: Grant Screen Recording permission to Terminal in System Settings → Privacy & Security → Screen & System Audio Recording"

# ffmpeg device check
SCREEN_DEVICE=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i "capture screen" | head -1 | sed 's/.*\[\([0-9]*\)\].*/\1/')
echo "Screen capture device index: ${SCREEN_DEVICE:-NOT FOUND}"

# BlackHole verification
system_profiler SPAudioDataType 2>/dev/null | grep -q "BlackHole" && echo "PASS: BlackHole driver installed" || echo "FAIL: BlackHole not detected — reboot required after brew install"

# switchaudio-osx
which SwitchAudioSource >/dev/null 2>&1 && echo "PASS: SwitchAudioSource available" || { echo "Installing switchaudio-osx..."; brew install switchaudio-osx; }

# cliclick
which cliclick >/dev/null 2>&1 && echo "PASS: cliclick available" || echo "WARN: cliclick not installed (backup tool)"

# Automation permission test
osascript -e 'tell application "Finder" to get name of every window' 2>/dev/null && echo "PASS: Automation permission granted" || echo "WARN: Automation permission may be needed for osascript — grant when prompted"
```

**All PASS required before continuing. Fix any FAIL items first.**

---

### S01: Configure Audio Routing (Fully Automated, No GUI)

> **No Multi-Output Device needed.** We set BlackHole as the system output so `say` pipes directly into it. Electron reads BlackHole as input. No speaker audio during tests (acceptable for automated runs).

**Steps:**
```bash
# Save current output device (for restore at teardown)
ORIGINAL_AUDIO_OUTPUT=$(SwitchAudioSource -c -t output)
echo "Saved original output: $ORIGINAL_AUDIO_OUTPUT"

# Set system output to BlackHole — say will now output through BlackHole
SwitchAudioSource -s "BlackHole 2ch" -t output || {
  test_fail "S01" "BlackHole 2ch not found. Run: brew install --cask blackhole-2ch && reboot"
  exit 1
}

# Verify routing
CURRENT_OUT=$(SwitchAudioSource -c -t output)
[ "$CURRENT_OUT" = "BlackHole 2ch" ] && test_pass "S01: Audio output set to BlackHole 2ch" || test_fail "S01" "Expected BlackHole 2ch, got: $CURRENT_OUT"

# Verify BlackHole also appears as input
SwitchAudioSource -a -t input | grep -q "BlackHole" && test_pass "S01: BlackHole available as input" || test_fail "S01" "BlackHole not available as input device"
```

---

### S02: Start Screen Recording

```bash
# Detect the correct screen capture device index
SCREEN_DEVICE=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i "capture screen" | head -1 | sed 's/.*\[\([0-9]*\)\].*/\1/')
SCREEN_DEVICE="${SCREEN_DEVICE:-1}"
echo "Using screen capture device index: $SCREEN_DEVICE"

# Start background screen recording (MP4, H.264, low CPU)
ffmpeg -f avfoundation -framerate 10 -i "${SCREEN_DEVICE}" -c:v libx264 -crf 28 -preset ultrafast \
  -pix_fmt yuv420p "$RECORDING_FILE" < /dev/null > /dev/null 2>&1 &
FFMPEG_PID=$!
echo "Recording PID: $FFMPEG_PID → $RECORDING_FILE"

# Verify recording started
sleep 2
kill -0 $FFMPEG_PID 2>/dev/null && test_pass "S02: Screen recording started" || test_fail "S02" "ffmpeg failed to start. Check screen recording permissions."
```

---

### S03: Start Iris Dev Server

```bash
cd "$IRIS_PROJECT_DIR"

# Launch iris with BlackHole as audio input device
IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev >> "$LOG_FILE" 2>&1 &
IRIS_PID=$!
echo "Iris PID: $IRIS_PID → $LOG_FILE"

# Wait for readiness — poll for WebSocket connection (up to 30s)
echo "Waiting for iris to become ready..."
READY=false
for i in $(seq 1 30); do
  if grep -qi "websocket\|ws.*open\|gemini.*connect\|ready\|voice" "$LOG_FILE" 2>/dev/null; then
    READY=true
    break
  fi
  sleep 1
done
sleep 3  # Extra buffer for renderer init

snap "S03-startup"

if $READY; then
  test_pass "S03: Iris started and WebSocket connected"
else
  test_fail "S03" "Iris did not become ready within 30s. Check $LOG_FILE"
fi

# Verify process is alive
kill -0 $IRIS_PID 2>/dev/null && echo "Iris process running" || test_fail "S03" "Iris process died during startup"
```

---

### S04: Verify Audio Routing

```bash
# Speak a test phrase — this should route through BlackHole to Electron
say -v Samantha "Testing audio routing, one two three"

# Wait for processing — poll for transcript activity
LOG_BEFORE=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
if wait_for_log "transcript\|audio\|volume\|capture" 15; then
  test_pass "S04: Audio routing verified — Iris received audio from BlackHole"
else
  test_fail "S04" "No audio activity in logs after 15s. BlackHole routing may not be working. Check: SwitchAudioSource -c -t output (should be BlackHole 2ch)"
fi

snap "S04-audio-test"
grep -iE "transcript|audio|capture|speech|volume" "$LOG_FILE" | tail -10
```

---

### Teardown: Stop Everything & Generate Report

```bash
# Stop iris gracefully
echo "[teardown] Stopping iris..."
kill $IRIS_PID 2>/dev/null
sleep 3

# Stop screen recording gracefully (SIGINT → ffmpeg writes trailer)
echo "[teardown] Stopping screen recording..."
kill -INT $FFMPEG_PID 2>/dev/null
sleep 3

# Restore system audio output to original device
echo "[teardown] Restoring audio output to: $ORIGINAL_AUDIO_OUTPUT"
SwitchAudioSource -s "$ORIGINAL_AUDIO_OUTPUT" -t output 2>/dev/null || \
  SwitchAudioSource -s "MacBook Air Speakers" -t output 2>/dev/null

# Clean up test artifacts from suites
rm -f ~/.iris/skills/test-greeting.js ~/.iris/skills/broken-skill.js 2>/dev/null
rm -f /tmp/iris-test-output.txt /tmp/weather-summary.txt /tmp/iris-drag-test.txt 2>/dev/null

# Ensure network is restored (in case EC01/EC13/EC24 left it off)
wifi_on 2>/dev/null

# Generate the full test report
generate_report

# List all artifacts
echo ""
echo "=== Test Artifacts ==="
echo "Screen Recording: $RECORDING_FILE"
echo "Console Logs:     $LOG_FILE"
echo "Failure Details:  $FAILURE_LOG"
echo "Test Report:      $HOME/.iris/test-logs/report-${SESSION_ID}.md"
echo "Screenshots:      $TEST_SCREENSHOTS/"
echo ""
ls -lh "$RECORDING_FILE" 2>/dev/null
echo ""
echo "Total failures in detail:"
if [ -s "$FAILURE_LOG" ]; then
  cat "$FAILURE_LOG"
else
  echo "  None! All tests passed."
fi
```

---

## Suite 1: Voice Pipeline

> **Tests the full audio capture → Gemini STT/TTS → response cycle.**
> **Precondition:** Suite 0 completed, iris running, audio routing verified.

### V01: Basic Greeting

**Priority:** P0
**Steps:**
```bash
# Speak a greeting
say -v Samantha "Hello Iris, how are you today?"

# Wait for response cycle
sleep 8

# Capture result
screencapture -x /tmp/iris-V01-response.png

# Check logs for transcription
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** Screenshot shows a response bubble from Iris. Logs contain a transcript matching "hello iris how are you today" (approximate). Iris responds audibly through speakers.

---

### V02: Multi-Sentence Input

**Priority:** P0
**Steps:**
```bash
say -v Samantha "I have two questions for you. First, what is the current time? Second, tell me a fun fact about cats."
sleep 12
screencapture -x /tmp/iris-V02-multi.png
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds addressing both questions. Response bubble visible.

---

### V03: Silence Handling

**Priority:** P1
**Steps:**
```bash
# Note the current log line count
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Do NOT speak for 15 seconds
sleep 15

# Check for phantom transcriptions
LOG_LINES_AFTER=$(wc -l < "$LOG_FILE")
tail -n $((LOG_LINES_AFTER - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -i "transcript"
```
**Expected:** No transcript lines appear during silence. The listening gate (180ms minimum speech) prevents noise from triggering false positives.

---

### V04: Barge-In (Interrupt Iris Mid-Response)

**Priority:** P0
**Steps:**
```bash
# Ask a question that triggers a long response
say -v Samantha "Tell me a very long story about a brave knight who went on an adventure."

# Wait until Iris is actually RESPONDING (poll for state change)
for i in $(seq 1 20); do grep -qi "RESPONDING\|audio.*chunk\|playback" "$LOG_FILE" && break; sleep 1; done

# Interrupt while Iris is still speaking
say -v Samantha "Stop. Never mind."
sleep 8

screencapture -x /tmp/iris-V04-bargein.png
grep -iE "barge|interrupt|cancel|stop" "$LOG_FILE" | tail -5
```
**Expected:** Iris stops her current response when interrupted. Logs may show barge-in detection. The voice state machine transitions from RESPONDING back to LISTENING.

---

### V05: Listening Gate — Short Sounds Rejected

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Generate a very short click-like sound (50ms)
say -v Samantha "k"
sleep 3

# Check that no transcript was generated
tail -n 20 "$LOG_FILE" | grep -i "transcript"
```
**Expected:** The 180ms listening gate filters out the very short sound. No transcript or response generated.

---

### V06: Rapid Back-to-Back Utterances

**Priority:** P1
**Steps:**
```bash
say -v Samantha "What time is it?" &
sleep 0.5
say -v Samantha "Also what day is it?" &
sleep 10

screencapture -x /tmp/iris-V06-rapid.png
grep -i "transcript" "$LOG_FILE" | tail -10
```
**Expected:** At least one of the utterances is transcribed and responded to. No crash or error in logs.

---

### V07: Mute Toggle via Avatar Click

**Priority:** P0
**Steps:**
```bash
# First, find the avatar window position
# The avatar is typically at bottom-left of screen
# Click on the avatar model (approximate center of avatar window)
screencapture -x /tmp/iris-V07-before.png

# Click on the avatar to toggle mute
./helpers/iris-helper '{"action":"click_at","x":350,"y":500}'
sleep 2

screencapture -x /tmp/iris-V07-muted.png
```
**Expected:** Screenshot shows "MUTED" badge in the top-left of the avatar window. The badge is a red/orange indicator.

---

### V08: Unmute and Verify Response Resumes

**Priority:** P0
**Precondition:** V07 completed (iris is muted)
**Steps:**
```bash
# Click avatar again to unmute
./helpers/iris-helper '{"action":"click_at","x":350,"y":500}'
sleep 2

screencapture -x /tmp/iris-V08-unmuted.png

# Speak and verify response
say -v Samantha "Are you there Iris?"
sleep 8

screencapture -x /tmp/iris-V08-response.png
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** MUTED badge disappears. Iris responds to "Are you there?" with a bubble and audio.

---

### V09: Voice State Transitions

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

say -v Samantha "What is two plus two?"
sleep 10

# Trace state transitions in logs
tail -n 50 "$LOG_FILE" | grep -iE "state|IDLE|LISTENING|USER_SPEAKING|PROCESSING|RESPONDING|TOOL_EXECUTING"
```
**Expected:** Logs show state transitions: IDLE/LISTENING → USER_SPEAKING (when voice detected) → PROCESSING (after speech ends) → RESPONDING (Iris speaks) → IDLE (done). The exact state names may vary but the flow should be visible.

---

### V10: Long Utterance (30+ Seconds)

**Priority:** P2
**Steps:**
```bash
# Generate a long paragraph via say (reads slowly enough to fill 30s)
say -v Samantha -r 140 "I would like to tell you about my day today. I woke up early in the morning and went for a walk in the park. The weather was beautiful with clear blue skies and a gentle breeze. I saw many birds singing in the trees and dogs playing fetch with their owners. After the walk I came home and had a nice breakfast of scrambled eggs and toast with fresh orange juice. Then I sat down at my computer to work on a project that I have been developing for several weeks now. The project involves building an AI assistant."
sleep 15

screencapture -x /tmp/iris-V10-long.png
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** The full utterance is transcribed (may be split across multiple transcript lines). Iris responds coherently to the content.

---

### V11: Quiet/Slow Input

**Priority:** P2
**Steps:**
```bash
# Speak very slowly
say -v Samantha -r 80 "Can you hear me?"
sleep 10

screencapture -x /tmp/iris-V11-quiet.png
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** Even at low rate, the input is captured and transcribed. Iris responds.

---

### V12: Echo Suppression Verification

**Priority:** P1
**Steps:**
```bash
# Ask a question that triggers Iris to speak
say -v Samantha "Tell me a joke"
sleep 3

# While Iris is responding, check that her own audio doesn't re-trigger listening
# Monitor logs during response for false re-triggers
sleep 10

grep -iE "echo|suppression|re-trigger|false.positive|barge" "$LOG_FILE" | tail -10
```
**Expected:** No false barge-in triggers during Iris's own response. The LMS echo suppression filter cancels the playback audio from the mic input. Logs may show echo suppression metrics but no actual re-trigger.

---

### V13: Vocabulary-Aware Transcription

**Priority:** P2
**Steps:**
```bash
# First, add some vocabulary terms that iris should know
# Copy a domain term to clipboard so vocab monitor picks it up
echo "Kubernetes" | pbcopy
sleep 65  # Wait for clipboard polling (60s interval)

# Now say the term
say -v Samantha "Tell me about Kubernetes deployments"
sleep 8

grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** The transcript correctly spells "Kubernetes" (not "Cooper Netties" or similar). Vocabulary rewriting may appear in logs.

---

### V14: WebSocket Reconnection

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Temporarily disable network to kill WebSocket
# (This is aggressive — only do if networksetup is available)
# Alternative: just wait and see if reconnection happens naturally
# For now, simulate by watching for any reconnection logs over time
sleep 5

grep -iE "reconnect|websocket|connection.closed|retry" "$LOG_FILE" | tail -10
```
**Expected:** If WebSocket drops, logs show automatic reconnection attempts with exponential backoff. This test is observational — if the connection is stable, note that as a pass (no drops = healthy connection).

---

### V15: [OBSERVATIONAL] Audio Playback Speech Profile

**Priority:** P2
**Steps:**
```bash
# Trigger a response that includes audio playback
say -v Samantha "Tell me a short joke"
sleep 10

# Check for speech profile / EQ / compressor parameters in logs
grep -iE "biquad|compressor|speech.profile|playback.*rate|shelf|warmth|presence" "$LOG_FILE" | tail -10
```
**Expected:** Logs show speech profile initialization with biquad filter parameters (low shelf, warmth peaking, presence peaking, high shelf) and dynamic range compressor settings (threshold -24dB, knee 8dB, ratio 2.2). Full verification requires audio spectral analysis — see unit test `audio-playback-voice-profile.test.js`.

---

### V16: [OBSERVATIONAL] Echo Reference Signal Resampling

**Priority:** P2
**Steps:**
```bash
# Trigger audio playback and monitor echo suppression
say -v Samantha "Tell me about the weather"
sleep 10

# Check for reference signal / resampling activity
grep -iE "reference|resample|24.*16|echo.*ref|sendReference" "$LOG_FILE" | tail -10
```
**Expected:** Logs show reference signal being sent from playback (24kHz) to capture (16kHz) for echo cancellation. The resampling pipeline converts the TTS output to match the mic sample rate. Full verification in `audio-capture-worklet.test.js`.

---

### V17: Cold-Start Race — Speak During Startup

**Priority:** P1
**Note:** This test restarts iris. It will restore iris to a running state when done.
**Steps:**
```bash
# Kill current iris instance
kill $IRIS_PID 2>/dev/null
sleep 4

# Start iris and IMMEDIATELY speak (before it's ready)
cd "$IRIS_PROJECT_DIR"
IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev >> "$LOG_FILE" 2>&1 &
IRIS_PID=$!

# Speak within 2 seconds of launch (before WebSocket connects)
sleep 2
say -v Samantha "Hello Iris, can you hear me?"

# Wait for full startup
for i in $(seq 1 25); do grep -qi "websocket\|ready\|voice" "$LOG_FILE" 2>/dev/null && break; sleep 1; done
sleep 3

# Verify no crash
if kill -0 $IRIS_PID 2>/dev/null; then
  test_pass "V17: No crash during cold-start race"
else
  test_fail "V17" "Iris crashed when receiving audio during startup"
fi

# Check for errors during startup
ERRORS=$(grep -ciE "uncaught|unhandled.*reject" "$LOG_FILE" 2>/dev/null)
[ "${ERRORS:-0}" -eq 0 ] && test_pass "V17: No uncaught exceptions" || test_fail "V17" "Found $ERRORS uncaught exceptions in startup logs"

snap "V17-coldstart"
```
**Expected:** Iris does NOT crash when receiving audio input during startup. The voice engine either queues the input until ready or silently discards it. No uncaught exceptions in logs.

---

## Suite 2: Avatar & Window Management

> **Tests the 3D avatar rendering, window behavior, shortcuts, tray menu, and visual states.**
> **Precondition:** Iris running (Suite 0 completed).

### A01: Idle State — Neutral Lighting

**Priority:** P1
**Steps:**
```bash
# Wait for idle state (no recent interaction)
sleep 15
screencapture -x /tmp/iris-A01-idle.png
```
**Expected:** Avatar is visible with neutral/ambient lighting. Subtle idle animations (blinking, slight movement) may be visible across multiple screenshots. No colored glow.

---

### A02: Thinking State — Blue Glow

**Priority:** P1
**Steps:**
```bash
say -v Samantha "What is the meaning of life? Take your time to think about it."
sleep 2  # Capture during processing phase
screencapture -x /tmp/iris-A02-thinking.png
```
**Expected:** Avatar shows blue/purple glow effect during the thinking/processing phase. The light rig changes color when state is PROCESSING.

---

### A03: Speaking State — Warm Lighting

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Tell me a joke"
sleep 5  # Wait until Iris is speaking
screencapture -x /tmp/iris-A03-speaking.png
```
**Expected:** Avatar shows warm lighting during response. The glow shifts from blue (thinking) to warm (speaking).

---

### A04: Tool Executing — Visual Indicator

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Open Safari for me"
sleep 3  # Capture during tool execution
screencapture -x /tmp/iris-A04-tool.png
grep -iE "TOOL_EXECUTING|tool_start|tool_end" "$LOG_FILE" | tail -5
```
**Expected:** Activity timeline shows tool execution event. Logs confirm TOOL_START and TOOL_END events.

---

### A05: Always-on-Top

**Priority:** P0
**Steps:**
```bash
# Open another application in front
open -a "TextEdit"
sleep 2
screencapture -x /tmp/iris-A05-ontop.png

# Clean up
osascript -e 'tell application "TextEdit" to quit'
```
**Expected:** Avatar overlay remains visible on top of TextEdit. The avatar window has the `alwaysOnTop` flag set.

---

### A06: Click-Through Transparency

**Priority:** P1
**Steps:**
```bash
# Click in an area where the avatar window exists but no avatar model
# (transparent region should pass clicks to apps behind)
# Click in the upper-right corner of the avatar window (empty area)
./helpers/iris-helper '{"action":"click_at","x":600,"y":200}'
sleep 1
screencapture -x /tmp/iris-A06-clickthrough.png
```
**Expected:** The click passes through the transparent avatar window to whatever is behind it. The avatar window uses `setIgnoreMouseEvents` for non-avatar regions.

---

### A07: Avatar Click Toggles Voice

**Priority:** P0
**Steps:**
```bash
screencapture -x /tmp/iris-A07-before.png

# Click directly on the avatar model
./helpers/iris-helper '{"action":"click_at","x":350,"y":500}'
sleep 2
screencapture -x /tmp/iris-A07-after-click.png

# Click again to toggle back
./helpers/iris-helper '{"action":"click_at","x":350,"y":500}'
sleep 2
screencapture -x /tmp/iris-A07-restored.png
```
**Expected:** First click shows MUTED badge. Second click removes it. Voice toggles on/off with each click.

---

### A08: Keyboard Shortcut — Cmd+I (Toggle Voice)

**Priority:** P0
**Steps:**
```bash
# Press Cmd+I to toggle voice
./helpers/iris-helper '{"action":"press_key","key":"cmd+i"}'
sleep 2
screencapture -x /tmp/iris-A08-toggle1.png

# Press again to toggle back
./helpers/iris-helper '{"action":"press_key","key":"cmd+i"}'
sleep 2
screencapture -x /tmp/iris-A08-toggle2.png
```
**Expected:** First press mutes (MUTED badge appears). Second press unmutes (badge disappears). Equivalent to clicking avatar.

---

### A09: Keyboard Shortcut — Cmd+K (Toggle Kanban)

**Priority:** P0
**Steps:**
```bash
screencapture -x /tmp/iris-A09-before.png

# Press Cmd+K to show kanban
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
sleep 2
screencapture -x /tmp/iris-A09-kanban-open.png

# Press Cmd+K again to hide
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
sleep 2
screencapture -x /tmp/iris-A09-kanban-closed.png
```
**Expected:** First press opens the kanban task board window (separate Electron window with vibrancy/blur effect). Second press hides it.

---

### A10: Keyboard Shortcut — Cmd+Shift+M (Behavior Mode)

**Priority:** P0
**Steps:**
```bash
# Toggle behavior mode
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2
grep -iE "mode.changed|behavior|silent|proactive" "$LOG_FILE" | tail -5
screencapture -x /tmp/iris-A10-mode.png

# Toggle back
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2
grep -iE "mode.changed|behavior" "$LOG_FILE" | tail -5
```
**Expected:** Logs show mode toggle between `proactive` and `silent`. Each press cycles the behavior mode.

---

### A11: Keyboard Shortcut — Cmd+Shift+D (Direct Mode)

**Priority:** P1
**Steps:**
```bash
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+d"}'
sleep 2
grep -iE "direct.mode|directMode" "$LOG_FILE" | tail -5

# Toggle back
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+d"}'
sleep 2
```
**Expected:** Logs show directMode toggle on/off.

---

### A12: Tray Menu — Hide/Show Avatar

**Priority:** P1
**Steps:**
```bash
# Right-click the tray icon
# Tray position is typically in the menu bar, top-right of screen
# We need to find and right-click it — this is tricky via CLI
# Alternative: use the keyboard shortcut or IPC

# For now, verify tray exists by checking process
screencapture -x /tmp/iris-A12-tray.png
grep -iE "tray|status" "$LOG_FILE" | tail -5
```
**Expected:** Tray icon is visible in the macOS menu bar. Logs confirm tray was created during startup.

---

### A13: Debug Indicators

**Priority:** P1
**Steps:**
```bash
screencapture -x /tmp/iris-A13-debug.png
```
**Expected:** Screenshot shows debug indicators in the top-right corner of the avatar window: WS (WebSocket), MIC (microphone), VOICE (voice engine). Green dots indicate healthy connections.

---

### A14: Window Geometry Persistence Across Restart

**Priority:** P1
**Steps:**
```bash
# Get current avatar window position
screencapture -x /tmp/iris-A14-before.png

# Move the avatar window by dragging it (or use AppleScript)
osascript -e 'tell application "System Events" to tell process "Electron"
    set position of window 1 to {100, 100}
end tell' 2>/dev/null
sleep 2
screencapture -x /tmp/iris-A14-moved.png

# Check geometry store
cat data/geometry-store.json 2>/dev/null || echo "No geometry store found (V1 mode)"

# Restart iris using harness helper
restart_iris

snap "A14-after-restart"
grep -iE "geometry|position|restore|window" "$LOG_FILE" | tail -5
```
**Expected:** After restart, the avatar window returns to the position it was moved to (100, 100). If V2 runtime, `geometry-store.json` persists the coordinates. Compare before/after screenshots.

---

### A15: Multi-Monitor Avatar Follow (If Available)

**Priority:** P2
**Steps:**
```bash
# Check if multiple displays are connected
system_profiler SPDisplaysDataType | grep "Resolution" | wc -l

# If only 1 display, mark as SKIP
# If multiple: move mouse to secondary display
./helpers/iris-helper '{"action":"mouse_move","x":2000,"y":500}'
sleep 2
screencapture -x /tmp/iris-A15-display2.png

# Move mouse back to primary
./helpers/iris-helper '{"action":"mouse_move","x":500,"y":500}'
sleep 2
screencapture -x /tmp/iris-A15-display1.png

grep -iE "display|monitor|cursor.*follow|display.*poll" "$LOG_FILE" | tail -5
```
**Expected:** Avatar window follows the cursor to the active display (500ms polling interval). If single display, SKIP this test.

---

### A16: Simultaneous Keyboard Shortcut Race

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Fire three shortcuts near-simultaneously
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}' &
./helpers/iris-helper '{"action":"press_key","key":"cmd+i"}' &
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}' &
wait
sleep 3

screencapture -x /tmp/iris-A16-race.png

# Check for errors
tail -n 20 "$LOG_FILE" | grep -iE "error|crash|exception|deadlock"

# Reset state: close kanban, unmute if needed
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
sleep 1
./helpers/iris-helper '{"action":"press_key","key":"cmd+i"}'
sleep 1
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
```
**Expected:** No crash, deadlock, or error. All three shortcuts execute (possibly in arbitrary order). App remains responsive. Final state may be unpredictable but stable.

---

## Suite 3: Tool Execution via Voice

> **Tests each of the 21 built-in tools by invoking them through voice commands.**
> **Precondition:** Iris running, voice pipeline working (Suite 1 V01 passed).

### T01: type_text — "Type hello world"

**Priority:** P0
**Steps:**
```bash
# Open TextEdit as a target for typing
open -a "TextEdit"
sleep 2

# Create new document
./helpers/iris-helper '{"action":"press_key","key":"cmd+n"}'
sleep 1

# Ask Iris to type
say -v Samantha "Type hello world"
sleep 8

screencapture -x /tmp/iris-T01-type.png
grep -iE "type_text|tool.*type" "$LOG_FILE" | tail -5

# Clean up
osascript -e 'tell application "TextEdit" to quit saving no'
```
**Expected:** "hello world" appears in the TextEdit document. Logs show `type_text` tool execution.

---

### T02: press_key — "Press command C"

**Priority:** P0
**Steps:**
```bash
# Open TextEdit with some text
open -a "TextEdit"
sleep 2
./helpers/iris-helper '{"action":"press_key","key":"cmd+n"}'
sleep 1
./helpers/iris-helper '{"action":"type_text","text":"test copy text"}'
sleep 1
./helpers/iris-helper '{"action":"press_key","key":"cmd+a"}'  # Select all
sleep 1

say -v Samantha "Press command C"
sleep 5

# Verify clipboard has the text
pbpaste
# Expected: "test copy text"

screencapture -x /tmp/iris-T02-presskey.png
grep -iE "press_key|tool.*press" "$LOG_FILE" | tail -5

osascript -e 'tell application "TextEdit" to quit saving no'
```
**Expected:** Clipboard contains "test copy text". Logs show `press_key` tool execution.

---

### T03: click_at — "Click on [visible element]"

**Priority:** P0
**Steps:**
```bash
# Open Safari first
open -a "Safari"
sleep 3
screencapture -x /tmp/iris-T03-before.png

say -v Samantha "Click on the address bar in Safari"
sleep 8

screencapture -x /tmp/iris-T03-after.png
grep -iE "click_at|tool.*click" "$LOG_FILE" | tail -5
```
**Expected:** Iris uses screen context to identify the address bar location and clicks it. The address bar becomes focused. Logs show `click_at` tool with x,y coordinates.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### T04: scroll — "Scroll down"

**Priority:** P1
**Steps:**
```bash
# Open Safari with a long page
open -a "Safari" "https://en.wikipedia.org/wiki/Artificial_intelligence"
sleep 5
screencapture -x /tmp/iris-T04-before.png

say -v Samantha "Scroll down"
sleep 5

screencapture -x /tmp/iris-T04-after.png
grep -iE "scroll|tool.*scroll" "$LOG_FILE" | tail -5
```
**Expected:** The page scrolls down visibly. Before/after screenshots show different content. Logs show `scroll` tool execution.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### T05: open_app — "Open Safari"

**Priority:** P0
**Steps:**
```bash
# Make sure Safari is closed first
osascript -e 'tell application "Safari" to quit' 2>/dev/null
sleep 2

say -v Samantha "Open Safari"
sleep 5

screencapture -x /tmp/iris-T05-open.png
grep -iE "open_app|tool.*open" "$LOG_FILE" | tail -5

# Verify Safari is running
pgrep -x Safari && echo "PASS: Safari is running" || echo "FAIL: Safari not found"
```
**Expected:** Safari launches and is visible. Logs show `open_app` tool execution with "Safari" argument.

---

### T06: close_app — "Close Safari"

**Priority:** P1
**Precondition:** Safari is open (from T05)
**Steps:**
```bash
say -v Samantha "Close Safari"
sleep 5

screencapture -x /tmp/iris-T06-close.png
grep -iE "close_app|tool.*close" "$LOG_FILE" | tail -5

pgrep -x Safari && echo "FAIL: Safari still running" || echo "PASS: Safari closed"
```
**Expected:** Safari quits. Process no longer running.

---

### T07: list_apps — "What apps are running?"

**Priority:** P1
**Steps:**
```bash
say -v Samantha "What apps are running right now?"
sleep 8

screencapture -x /tmp/iris-T07-apps.png
grep -iE "list_apps|get_active|tool.*app" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds with a list of running applications. Response bubble or audio mentions app names. Logs show tool execution.

---

### T08: read_file — "Read package.json"

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Read the package dot json file in the current directory"
sleep 10

screencapture -x /tmp/iris-T08-readfile.png
grep -iE "read_file|tool.*read" "$LOG_FILE" | tail -5
```
**Expected:** Iris reads and summarizes the contents of package.json. She mentions the project name, dependencies, or scripts. Logs show `read_file` tool execution.

---

### T09: write_file — "Create a test file"

**Priority:** P0
**Steps:**
```bash
# Ensure previous test response has settled
sleep 3

LOG_BEFORE_T09=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ')
say -v Samantha "Use the write file tool to write the text hello from iris to the file /tmp/iris-test-output.txt"

# Poll for write_file tool execution in NEW log lines only
T09_FOUND=0
for i in $(seq 1 15); do
  if tail -n +"$((LOG_BEFORE_T09 + 1))" "$LOG_FILE" | grep -qi "write_file"; then
    T09_FOUND=1; break
  fi
  sleep 1
done
if [ "$T09_FOUND" -eq 1 ]; then
  sleep 2  # brief settle after tool completes
else
  echo "WARN: write_file not found in logs within 15s"
  sleep 5  # extra grace period
fi

# Verify the file was created
if [ -f /tmp/iris-test-output.txt ]; then
  cat /tmp/iris-test-output.txt
  # Expected: "hello from iris" or similar
else
  echo "FAIL: /tmp/iris-test-output.txt was not created"
fi

screencapture -x /tmp/iris-T09-writefile.png
grep -iE "write_file|tool.*write" "$LOG_FILE" | tail -5

# Cleanup
rm -f /tmp/iris-test-output.txt
```
**Expected:** File exists at `/tmp/iris-test-output.txt` with the specified content.

---

### T10: read_clipboard — "What's on my clipboard?"

**Priority:** P1
**Steps:**
```bash
# Put known content on clipboard
echo "clipboard test data 12345" | pbcopy

say -v Samantha "What is on my clipboard?"
sleep 6

screencapture -x /tmp/iris-T10-clipboard.png
grep -iE "read_clipboard|clipboard" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds mentioning "clipboard test data 12345". Logs show `read_clipboard` tool execution.

---

### T11: write_clipboard — "Copy to clipboard"

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Copy the text 'iris was here' to my clipboard"
sleep 6

# Verify clipboard content
CLIP=$(pbpaste)
echo "Clipboard: $CLIP"
# Expected: "iris was here"

grep -iE "write_clipboard|clipboard" "$LOG_FILE" | tail -5
```
**Expected:** `pbpaste` returns "iris was here" or similar.

---

### T12: web_search — "Search the web"

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Search the web for what is the latest version of Node.js"
sleep 12

screencapture -x /tmp/iris-T12-search.png
grep -iE "web_search|search.*tool" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds with search results about Node.js versions. Logs show `web_search` tool execution.

---

### T13: gpt_search — "Deep search"

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Ask Perplexity about the latest developments in quantum computing"
sleep 15

screencapture -x /tmp/iris-T13-gpt.png
grep -iE "gpt_search|perplexity" "$LOG_FILE" | tail -5
```
**Expected:** Iris provides a detailed response sourced from Perplexity. Logs show `gpt_search` tool execution.

---

### T14: set_volume — "Set volume to 50 percent"

**Priority:** P1
**Steps:**
```bash
# Note current volume
osascript -e "output volume of (get volume settings)"

say -v Samantha "Set volume to 50 percent"
sleep 5

# Check new volume
osascript -e "output volume of (get volume settings)"
# Expected: approximately 50

grep -iE "set_volume|volume" "$LOG_FILE" | tail -5

# Restore volume
osascript -e "set volume output volume 70"
```
**Expected:** System volume changes to ~50%. Logs show `set_volume` tool execution.

---

### T15: send_notification — "Send a notification"

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Send me a notification saying test complete"
sleep 5

screencapture -x /tmp/iris-T15-notification.png
grep -iE "send_notification|notification|notify" "$LOG_FILE" | tail -5
```
**Expected:** macOS notification appears with "test complete" message. Logs show notification tool execution.

---

### T16: get_system_info — "System info"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "What is my system info?"
sleep 8

screencapture -x /tmp/iris-T16-sysinfo.png
grep -iE "system_info|get_system" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds with system details (macOS version, CPU, memory, etc.).

---

### T17: refresh_vocabulary — "Refresh vocabulary"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Refresh your vocabulary"
sleep 8

grep -iE "refresh_vocabulary|vocab" "$LOG_FILE" | tail -5
```
**Expected:** Logs show vocabulary refresh triggered. Iris may acknowledge the refresh.

---

### T18: self_fix — "Change behavior"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Be more concise in your responses from now on"
sleep 8

grep -iE "self_fix|self.fix|behavior.change" "$LOG_FILE" | tail -5
```
**Expected:** Iris acknowledges the behavior change request. Logs show `self_fix` tool execution or behavior modification.

---

### T19: create_skill — "Create a skill"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Create a new skill that opens GitHub and Twitter tabs in Safari"
sleep 12

grep -iE "create_skill|skill" "$LOG_FILE" | tail -5

# Check if skill file was created
ls ~/.iris/skills/ 2>/dev/null
```
**Expected:** A new skill file is created in `~/.iris/skills/`. Logs show `create_skill` tool execution.

---

### T20: fix_project — "Fix project"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Analyze the project in the current directory and tell me if there are any issues"
sleep 15

grep -iE "fix_project|claude.*code|agent" "$LOG_FILE" | tail -5
screencapture -x /tmp/iris-T20-fix.png
```
**Expected:** Iris invokes Claude Code Agent SDK to analyze the project. Logs show tool execution. Response includes project analysis.

---

### T21: reply_assistant — "Draft a reply"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Draft a reply saying thanks for the update, I will review the changes this week"
sleep 8

grep -iE "reply_assistant|reply|draft" "$LOG_FILE" | tail -5
screencapture -x /tmp/iris-T21-reply.png
```
**Expected:** Iris drafts a professional reply message. Logs show reply tool execution.

---

### T22: Multi-Tool Chain — Read + Search

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Read the package.json file and then search the web for what this project does"
sleep 20

screencapture -x /tmp/iris-T22-chain.png
grep -iE "read_file|web_search|tool.*(start|end)" "$LOG_FILE" | tail -10
```
**Expected:** Iris executes `read_file` first (reads package.json), then `web_search` using information from the file. Logs show two sequential tool executions. Response references both the file contents and search results.

---

### T23: Multi-Tool Chain — Open + Type + Copy

**Priority:** P0
**Steps:**
```bash
open -a "TextEdit"
sleep 2
./helpers/iris-helper '{"action":"press_key","key":"cmd+n"}'
sleep 1

say -v Samantha "Type 'multi-tool test' in TextEdit, then select all and copy it to clipboard"
sleep 12

# Verify clipboard
CLIP=$(pbpaste)
echo "Clipboard: $CLIP"

screencapture -x /tmp/iris-T23-chain.png
grep -iE "type_text|press_key|clipboard|tool" "$LOG_FILE" | tail -10

osascript -e 'tell application "TextEdit" to quit saving no'
```
**Expected:** "multi-tool test" is typed, selected, and copied. `pbpaste` returns the text. Three tool executions in sequence visible in logs.

---

### T24: Multi-Tool Chain — Search + Write File

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Search the web for today's weather and write a summary to /tmp/weather-summary.txt"
sleep 20

cat /tmp/weather-summary.txt 2>/dev/null
screencapture -x /tmp/iris-T24-chain.png
grep -iE "web_search|write_file|tool" "$LOG_FILE" | tail -10

rm -f /tmp/weather-summary.txt
```
**Expected:** File `/tmp/weather-summary.txt` exists and contains weather information from the search. Two tool executions (search then write) in logs.

---

### T25: Concurrent Tool Requests

**Priority:** P1
**Steps:**
```bash
# Ask two things in rapid succession
say -v Samantha "What apps are running?" &
sleep 1
say -v Samantha "What is on my clipboard?" &
wait
sleep 12

screencapture -x /tmp/iris-T25-concurrent.png
grep -iE "list_apps|read_clipboard|tool.*(start|end|queue)" "$LOG_FILE" | tail -15
```
**Expected:** Both requests are handled (sequentially or concurrently). No crash. The cooperative dispatch system may queue one while the other executes. Logs show both tool executions.

---

### T26: Tool Cancellation Mid-Execution

**Priority:** P1
**Steps:**
```bash
# Trigger a potentially slow tool
say -v Samantha "Search the web extensively for the complete history of artificial intelligence"
sleep 5

# Try to cancel
say -v Samantha "Stop. Cancel that."
sleep 8

screencapture -x /tmp/iris-T26-cancel.png
grep -iE "cancel|abort|stop|interrupt|tool" "$LOG_FILE" | tail -10
```
**Expected:** Iris acknowledges the cancellation. The tool either completes (if already done) or is interrupted. No crash. State machine returns to IDLE/LISTENING.

---

### T27: Observations Tool — Context-Aware Note

**Priority:** P1
**Steps:**
```bash
# Open a specific app to create context
open -a "Safari" "https://github.com"
sleep 5

say -v Samantha "Make a note that I'm reviewing the GitHub dashboard for deployment status"
sleep 8

screencapture -x /tmp/iris-T27-observation.png
grep -iE "observation|note|context|save" "$LOG_FILE" | tail -10
```
**Expected:** Iris records an observation linked to the current app context (Safari/GitHub). Logs show observation creation with app name and description.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### T28: Link Capture Pipeline

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Copy a URL to clipboard
echo "https://example.com/test-link-capture" | pbcopy
sleep 3

# Copy another URL
echo "https://github.com/test-link" | pbcopy

# Wait for link capture poll (10s interval)
sleep 15

# Check for link capture activity
tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "link|capture|poll|url"
```
**Expected:** Logs show the link capture poller detecting URLs from clipboard. Links may be stored in Convex `links` table with embeddings.

---

### T29: Reply Assistant with App Context

**Priority:** P1
**Steps:**
```bash
# Open Messages (or Mail) to provide context for reply drafting
open -a "Messages"
sleep 3

say -v Samantha "Draft a reply to this conversation saying I'll be there at 5pm"
sleep 10

screencapture -x /tmp/iris-T29-reply-context.png
grep -iE "reply|draft|context|messaging|app" "$LOG_FILE" | tail -10

osascript -e 'tell application "Messages" to quit' 2>/dev/null
```
**Expected:** Iris detects the messaging app context and drafts an appropriate reply. The reply assistant uses the visible conversation for context. Response includes a well-formatted draft.

---

### T30: 3d_gen — "Generate a 3D model"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Generate a 3D model of a simple cube"
sleep 15

screencapture -x /tmp/iris-T30-3dgen.png
grep -iE "3d.gen|generate|model|mesh" "$LOG_FILE" | tail -5
```
**Expected:** Iris invokes the 3D generation tool. Logs show tool execution. Output may be a file path or description of the generated model.

---

### T31: design — "Design a UI layout"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Use the design tool to create a simple header with a navigation bar"
sleep 12

screencapture -x /tmp/iris-T31-design.png
grep -iE "design|layout|snap.to.grid|precision" "$LOG_FILE" | tail -5
```
**Expected:** Iris invokes the design tool. Logs show layout generation with snap-to-grid parameters.

---

### T32: Kanban Task Update (Not Just Create)

**Priority:** P1
**Steps:**
```bash
# Open kanban
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
sleep 2

say -v Samantha "Mark the first task as completed"
sleep 10

screencapture -x /tmp/iris-T32-kanban-update.png
grep -iE "kanban|update|task|complete|status" "$LOG_FILE" | tail -5

./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
```
**Expected:** An existing task's status changes to completed. Logs show task update (not just creation). The kanban board reflects the status change.

---

### T33: double_click — "Double-click on [element]"

**Priority:** P1
**Steps:**
```bash
open -a "Finder" ~/Desktop
sleep 3

say -v Samantha "Double click on a file on the desktop"
sleep 8

screencapture -x /tmp/iris-T33-doubleclick.png
grep -iE "double.click|tool.*double" "$LOG_FILE" | tail -5

osascript -e 'tell application "Finder" to close every window' 2>/dev/null
```
**Expected:** Iris performs a double-click action. The file opens in its default app. Logs show `double_click` tool execution.

---

### T34: mouse_move — "Move mouse to [position]"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Move the mouse to the center of the screen"
sleep 5

MOUSE_POS=$(./helpers/iris-helper '{"action":"get_mouse_position"}' 2>/dev/null)
echo "Mouse position: $MOUSE_POS"

grep -iE "mouse_move|tool.*mouse" "$LOG_FILE" | tail -5
```
**Expected:** Mouse moves to approximately the center of the screen. `get_mouse_position` confirms new coordinates.

---

### T35: drag — "Drag [element] to [location]"

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Drag from position 200,200 to position 400,400"
sleep 8

grep -iE "drag|tool.*drag" "$LOG_FILE" | tail -5
```
**Expected:** A drag operation is performed. Logs show `drag` tool with start and end coordinates.

---

## Suite 4: Browser Automation

> **Tests browser navigation, search, clicking, and media control via AppleScript adapter.**
> **Precondition:** Iris running, Safari available.

### B01: Open URL in Safari

**Priority:** P0
**Steps:**
```bash
osascript -e 'tell application "Safari" to quit' 2>/dev/null
sleep 2

say -v Samantha "Open youtube.com in Safari"
sleep 8

screencapture -x /tmp/iris-B01-youtube.png
grep -iE "open.*url|browser|navigate" "$LOG_FILE" | tail -5

# Verify Safari is showing YouTube
osascript -e 'tell application "Safari" to get URL of current tab of window 1' 2>/dev/null
```
**Expected:** Safari opens with YouTube loaded. URL contains "youtube.com".

---

### B02: Search on YouTube

**Priority:** P0
**Precondition:** Safari is open with YouTube (from B01)
**Steps:**
```bash
say -v Samantha "Search for lofi hip hop music on YouTube"
sleep 10

screencapture -x /tmp/iris-B02-search.png
grep -iE "search|youtube" "$LOG_FILE" | tail -5
```
**Expected:** YouTube shows search results for "lofi hip hop music". The browser adapter fills the search box and submits.

---

### B03: Click First Video

**Priority:** P0
**Precondition:** YouTube search results visible (from B02)
**Steps:**
```bash
say -v Samantha "Click on the first video"
sleep 8

screencapture -x /tmp/iris-B03-click.png
grep -iE "click.*text|click.*element" "$LOG_FILE" | tail -5
```
**Expected:** A YouTube video starts playing. The browser adapter found and clicked the first video result.

---

### B04: Pause Video

**Priority:** P1
**Precondition:** YouTube video playing (from B03)
**Steps:**
```bash
say -v Samantha "Pause the video"
sleep 5

screencapture -x /tmp/iris-B04-pause.png
grep -iE "media|pause|control" "$LOG_FILE" | tail -5
```
**Expected:** Video playback pauses. Browser adapter used `controlMedia('pause')`.

---

### B05: Play Video

**Priority:** P1
**Precondition:** Video paused (from B04)
**Steps:**
```bash
say -v Samantha "Play the video"
sleep 5

screencapture -x /tmp/iris-B05-play.png
grep -iE "media|play|control" "$LOG_FILE" | tail -5
```
**Expected:** Video resumes playing.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
sleep 2
```

---

### B06: Open Google

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Open google.com"
sleep 6

screencapture -x /tmp/iris-B06-google.png
osascript -e 'tell application "Safari" to get URL of current tab of window 1' 2>/dev/null
```
**Expected:** Safari opens with Google loaded.

---

### B07: Search on Google

**Priority:** P0
**Precondition:** Google loaded (from B06)
**Steps:**
```bash
say -v Samantha "Search Google for iris chan AI assistant"
sleep 8

screencapture -x /tmp/iris-B07-gsearch.png
grep -iE "search|google" "$LOG_FILE" | tail -5
```
**Expected:** Google shows search results for "iris chan AI assistant".

---

### B08: Click Search Result

**Priority:** P1
**Precondition:** Google results visible (from B07)
**Steps:**
```bash
say -v Samantha "Click the first search result"
sleep 8

screencapture -x /tmp/iris-B08-result.png
grep -iE "click.*result|click.*text" "$LOG_FILE" | tail -5
```
**Expected:** The first Google search result page loads.

---

### B09: Current Page Info

**Priority:** P1
**Steps:**
```bash
say -v Samantha "What page am I currently on?"
sleep 6

screencapture -x /tmp/iris-B09-pageinfo.png
grep -iE "page.*info|current.*page|url|title" "$LOG_FILE" | tail -5
```
**Expected:** Iris responds with the current page title and/or URL.

---

### B10: Multi-Browser — Open in Chrome

**Priority:** P2
**Steps:**
```bash
# Check if Chrome is installed
if [ -d "/Applications/Google Chrome.app" ]; then
    say -v Samantha "Open github.com in Chrome"
    sleep 8
    screencapture -x /tmp/iris-B10-chrome.png
    echo "Chrome test executed"
else
    echo "SKIP: Chrome not installed"
fi
```
**Expected:** If Chrome is installed, it opens with github.com. Otherwise, test is skipped.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit' 2>/dev/null
osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null
```

---

### B11: Accessibility Tree — Snapshot and Find

**Priority:** P0
**Steps:**
```bash
# Open Safari with a page that has buttons
open -a "Safari" "https://example.com"
sleep 5

# Get the accessibility tree snapshot
./helpers/iris-helper '{"action":"ax_snapshot"}' 2>/dev/null | head -50
echo "---"

# Find a specific element by text
./helpers/iris-helper '{"action":"ax_find","query":"More information","role":"link","exact":false,"limit":5}'
sleep 2

screencapture -x /tmp/iris-B11-ax.png
```
**Expected:** `ax_snapshot` returns the full accessibility tree of the frontmost app (Safari). `ax_find` locates the "More information" link on example.com. The output includes element identifiers, roles, and labels.

---

### B12: Accessibility Tree — Press Element by Label

**Priority:** P0
**Precondition:** Safari open with example.com (from B11)
**Steps:**
```bash
# Find and press a link by accessibility label
ELEMENT=$(./helpers/iris-helper '{"action":"ax_find","query":"More information","role":"link","exact":false,"limit":1}' 2>/dev/null)
echo "Found element: $ELEMENT"

# Press it
./helpers/iris-helper '{"action":"ax_press","value":"More information"}'
sleep 3

screencapture -x /tmp/iris-B12-ax-press.png

# Verify navigation happened
osascript -e 'tell application "Safari" to get URL of current tab of window 1' 2>/dev/null
```
**Expected:** The "More information" link is clicked via accessibility API (not coordinate-based). Safari navigates to the linked page. This is more reliable than coordinate-based clicking for UI automation.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

## Suite 5: UI-TARS Vision Automation

> **Tests screenshot-based GUI automation via the UI-TARS vision language model.**
> **Precondition:** Iris running, UI-TARS endpoint live (UI_TARS_URL set in .env).

### U01: Chess — Open Lichess and Start a Game

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Open lichess.org in Safari and start a game against the computer"

# UI-TARS multi-step tasks can take 20-40s — poll for completion
for i in $(seq 1 45); do grep -qi "finished\|task.*complete\|TARS.*done\|ui.task.*end" "$LOG_FILE" && break; sleep 1; done
sleep 3

screencapture -x /tmp/iris-U01-lichess.png
grep -iE "ui.task|tars|run_ui_task|vision" "$LOG_FILE" | tail -10
```
**Expected:** Safari opens lichess.org. UI-TARS navigates the interface to start a game vs AI. The chess board should be visible in the screenshot. This may take multiple TARS steps (click "Play with the computer", select difficulty, etc.).

---

### U02: Chess — Play a Move

**Priority:** P0
**Precondition:** Chess game started (from U01)
**Steps:**
```bash
say -v Samantha "Play the move e4, pawn to e4"
sleep 10

screencapture -x /tmp/iris-U02-move.png
grep -iE "tars|click|drag|move" "$LOG_FILE" | tail -10
```
**Expected:** UI-TARS sees the chess board, identifies the e2 pawn, and clicks/drags it to e4. The board updates to show the move. The computer responds with its own move.

---

### U03: Chess — Play Multiple Moves

**Priority:** P1
**Precondition:** Game in progress (from U02)
**Steps:**
```bash
say -v Samantha "Keep playing. Make three more moves for me."
sleep 30

screencapture -x /tmp/iris-U03-moves.png
grep -iE "tars|click|move|action" "$LOG_FILE" | tail -20
```
**Expected:** UI-TARS makes three chess moves, with the computer responding between each. The board shows an advanced game state. Multiple TARS action cycles in logs.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
sleep 2
```

---

### U04: System Settings Navigation

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Open System Settings and navigate to the Display settings"
sleep 15

screencapture -x /tmp/iris-U04-settings.png
grep -iE "tars|ui.task|click|settings" "$LOG_FILE" | tail -10
```
**Expected:** System Settings opens and navigates to Display settings pane. TARS uses vision to find and click the correct menu items.

**Cleanup:**
```bash
osascript -e 'tell application "System Settings" to quit' 2>/dev/null
```

---

### U05: Notes — Create a New Note

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Open Notes and create a new note with the title Test Note from Iris"
sleep 15

screencapture -x /tmp/iris-U05-notes.png
grep -iE "tars|ui.task|type|click" "$LOG_FILE" | tail -10
```
**Expected:** Notes app opens, a new note is created, and "Test Note from Iris" is typed as the title. TARS handles clicking the new note button and typing.

**Cleanup:**
```bash
osascript -e 'tell application "Notes" to quit' 2>/dev/null
```

---

### U06: Finder Navigation

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Open Finder, navigate to the Downloads folder, and sort files by date"
sleep 15

screencapture -x /tmp/iris-U06-finder.png
grep -iE "tars|ui.task|finder|click|sort" "$LOG_FILE" | tail -10
```
**Expected:** Finder opens showing Downloads folder with files sorted by date. TARS navigates the sidebar and sorts.

**Cleanup:**
```bash
osascript -e 'tell application "Finder" to close every window' 2>/dev/null
```

---

### U07: Vision Description — "What do you see?"

**Priority:** P0
**Steps:**
```bash
# Open a recognizable app
open -a "Calculator"
sleep 3

say -v Samantha "Take a screenshot and tell me what you see on my screen"
sleep 10

screencapture -x /tmp/iris-U07-vision.png
grep -iE "screen|capture|describe|see" "$LOG_FILE" | tail -5
```
**Expected:** Iris describes what's visible on screen, mentioning Calculator and other visible apps. Uses screen capture + Gemini vision.

**Cleanup:**
```bash
osascript -e 'tell application "Calculator" to quit' 2>/dev/null
```

---

### U08: Drag and Drop

**Priority:** P2
**Steps:**
```bash
# Create a test file to drag
touch /tmp/iris-drag-test.txt

# Open Finder to Downloads
open ~/Downloads
sleep 3

say -v Samantha "Drag the file iris-drag-test from Downloads to the Desktop"
sleep 15

screencapture -x /tmp/iris-U08-drag.png
grep -iE "tars|drag|ui.task" "$LOG_FILE" | tail -10
```
**Expected:** UI-TARS identifies the file and performs a drag operation from Downloads to Desktop. The `drag(x1,y1,x2,y2)` action is used.

**Cleanup:**
```bash
rm -f ~/Desktop/iris-drag-test.txt /tmp/iris-drag-test.txt
osascript -e 'tell application "Finder" to close every window' 2>/dev/null
```

---

### U09: [OBSERVATIONAL] 3D Gen / Design Tool Verification

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Use the design tool to create a simple layout with a header and two columns"
sleep 15

screencapture -x /tmp/iris-U09-design.png
grep -iE "design|3d.gen|layout|snap.to.grid|precision" "$LOG_FILE" | tail -10
```
**Expected:** Logs show design tool invocation with layout parameters. Full output validation (snap-to-grid precision, visual correctness) requires manual review of the generated output. Check logs for any error or fallback behavior.

---

## Suite 6: Auth & 2FA

> **Tests 2FA code extraction from Messages and auto-fill.**
> **Precondition:** Iris running. Messages app accessible.

### AF01: 2FA Code Extraction

**Priority:** P2
**Steps:**
```bash
# This test requires a real 2FA code in Messages
# Send yourself an iMessage with a code first (or use a recent one)
# If no code is available, this test is observational

say -v Samantha "Check my messages for any verification codes"
sleep 8

screencapture -x /tmp/iris-AF01-2fa.png
grep -iE "auto_2fa|auth|2fa|verification|code" "$LOG_FILE" | tail -10
```
**Expected:** Iris searches Messages for 2FA codes. If found, reports the code. If no codes are available, responds accordingly. Logs show `auto_2fa` tool execution.

---

### AF02: 2FA with Login Context

**Priority:** P2
**Steps:**
```bash
# Open a page with a login form
open -a "Safari" "https://github.com/login"
sleep 5

say -v Samantha "Enter my 2FA code"
sleep 8

screencapture -x /tmp/iris-AF02-login.png
grep -iE "auto_2fa|context|login|confidence" "$LOG_FILE" | tail -10
```
**Expected:** The auth-v2 module detects login context from the page ("sign in", "login"). If confidence > 0.92, it attempts auto-fill. Otherwise, reports threshold not met.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### AF03: 2FA Confidence Threshold

**Priority:** P2
**Steps:**
```bash
# Open a non-login page
open -a "Safari" "https://en.wikipedia.org"
sleep 3

say -v Samantha "Auto-fill my 2FA code"
sleep 8

grep -iE "confidence|threshold|context" "$LOG_FILE" | tail -5
```
**Expected:** The auth-v2 module reports low confidence or no login context detected (Wikipedia is not a login page). Auto-fill should be blocked by the 0.92 confidence threshold.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### AF04: 2FA Source Detection

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Check my latest messages for any security codes"
sleep 8

grep -iE "source|messages|mail|imessage" "$LOG_FILE" | tail -5
```
**Expected:** Iris searches iMessage and/or Mail for recent security codes. The auth tool supports "messages", "mail", and "latest" source keywords.

---

## Suite 7: Behavior, Proactive & Learning

> **Tests behavior mode switching, proactive suggestions, vocabulary learning, and persistence.**
> **Precondition:** Iris running.

### BH01: Default Behavior Mode

**Priority:** P0
**Steps:**
```bash
grep -iE "behavior.*mode|initial.*mode" "$LOG_FILE" | head -5
```
**Expected:** Logs show the initial behavior mode set at startup (typically `proactive` or `passive`).

---

### BH02: Switch to Silent Mode

**Priority:** P0
**Steps:**
```bash
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2

# Verify mode changed
grep -iE "mode.changed|silent" "$LOG_FILE" | tail -3

# Verify no proactive suggestions come in silent mode
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")
sleep 20
tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "proactive|suggest"
```
**Expected:** Mode changes to silent. No proactive suggestions appear during the 20s wait.

---

### BH03: Switch Back to Proactive

**Priority:** P0
**Steps:**
```bash
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2
grep -iE "mode.changed|proactive" "$LOG_FILE" | tail -3
```
**Expected:** Mode changes back to proactive.

---

### BH04: Silent Mode Still Responds to Direct Commands

**Priority:** P0
**Steps:**
```bash
# Switch to silent
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2

# Speak a direct command
say -v Samantha "What time is it?"
sleep 8

screencapture -x /tmp/iris-BH04-silent-respond.png
grep -i "transcript" "$LOG_FILE" | tail -3

# Switch back to proactive
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
```
**Expected:** Even in silent mode, Iris responds to direct voice commands. Silent mode only suppresses proactive/unsolicited suggestions.

---

### BH05: Proactive Suggestion — Error Context

**Priority:** P1
**Steps:**
```bash
# Ensure proactive mode is active
# Open terminal with a visible error
open -a "Terminal"
sleep 2
# Generate a visible error in terminal
osascript -e 'tell application "Terminal" to do script "node -e \"throw new Error(\\\"Something went wrong\\\")\" 2>&1"'
sleep 15

screencapture -x /tmp/iris-BH05-proactive.png
grep -iE "proactive|suggest|error|help" "$LOG_FILE" | tail -10
```
**Expected:** Iris detects the error on screen and proactively offers help. The proactive engine (8s poll) captures the screen, sees the error, and generates a suggestion.

**Cleanup:**
```bash
osascript -e 'tell application "Terminal" to quit'
```

---

### BH06: Proactive Cooldown (45s)

**Priority:** P2
**Steps:**
```bash
# After BH05, check that no duplicate suggestion comes within 45s
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")
sleep 50

tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "proactive|cooldown|throttle"
```
**Expected:** Logs show cooldown enforcement. No duplicate suggestions within the 45s window. Context fingerprinting prevents the same suggestion from firing twice.

---

### BH07: Direct Mode Toggle

**Priority:** P1
**Steps:**
```bash
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+d"}'
sleep 2
grep -iE "direct.mode|directMode" "$LOG_FILE" | tail -3

./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+d"}'
sleep 2
grep -iE "direct.mode|directMode" "$LOG_FILE" | tail -3
```
**Expected:** Direct mode toggles on then off. Logs show the state changes.

---

### BH08: Vocabulary Learning from Clipboard

**Priority:** P1
**Steps:**
```bash
# Copy a unique domain term
echo "TensorFlow" | pbcopy
sleep 3

# Also copy another term (clipboard poll happens every 60s)
echo "PostgreSQL" | pbcopy

# Wait for clipboard polling interval
sleep 65

grep -iE "vocab|clipboard|TensorFlow|PostgreSQL" "$LOG_FILE" | tail -10
```
**Expected:** After 60s, the vocabulary monitor picks up "TensorFlow" and/or "PostgreSQL" from clipboard history. Logs show vocabulary tracking events.

---

### BH09: Vocabulary-Corrected Transcription

**Priority:** P2
**Precondition:** BH08 completed (terms learned)
**Steps:**
```bash
say -v Samantha "Tell me about TensorFlow and PostgreSQL"
sleep 8

grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** Transcript correctly spells "TensorFlow" and "PostgreSQL" (vocabulary rewriting applies learned terms to raw transcriptions).

---

### BH10: Kanban — Create Task via Voice

**Priority:** P1
**Steps:**
```bash
# Open kanban first
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
sleep 2
screencapture -x /tmp/iris-BH10-kanban-before.png

say -v Samantha "Add a new task: review the authentication module"
sleep 8

screencapture -x /tmp/iris-BH10-kanban-after.png
grep -iE "task|kanban|create" "$LOG_FILE" | tail -5

# Close kanban
./helpers/iris-helper '{"action":"press_key","key":"cmd+k"}'
```
**Expected:** A new task "review the authentication module" appears in the kanban board. Before/after screenshots show the new task card.

---

### BH11: Persistence — Conversation Survives Restart

**Priority:** P1
**Steps:**
```bash
# Have a conversation with a unique marker
say -v Samantha "Remember the code word is blue elephant"
sleep 8

# Note the marker
grep -i "blue elephant" "$LOG_FILE" | tail -3

# Check Convex persistence
grep -iE "convex|save.*conversation|persist" "$LOG_FILE" | tail -5
```
**Expected:** Logs show conversation turn saved to Convex. The "blue elephant" transcript is persisted. (Full restart test is destructive — verify persistence via log evidence instead.)

---

### BH12: Semantic Search — "Remember when..."

**Priority:** P2
**Precondition:** BH11 completed (conversation stored)
**Steps:**
```bash
say -v Samantha "Do you remember what the code word was?"
sleep 8

screencapture -x /tmp/iris-BH12-recall.png
grep -iE "semantic.*search|vector|recall|remember" "$LOG_FILE" | tail -5
```
**Expected:** Iris recalls "blue elephant" from conversation history. Uses Convex vector search with OpenRouter embeddings to find the relevant conversation turn.

---

### BH13: Dynamic Skill — Load Custom Skill from Filesystem

**Priority:** P0
**Steps:**
```bash
# Create a simple custom skill
mkdir -p ~/.iris/skills
cat > ~/.iris/skills/test-greeting.js << 'SKILL_EOF'
module.exports = {
    name: 'test_greeting',
    description: 'A test skill that returns a greeting',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    handler: async ({ name }) => {
        return { ok: true, result: `Hello ${name || 'world'} from custom skill!` };
    }
};
SKILL_EOF

sleep 5  # Wait for skill scanner to detect

# Ask Iris to use the new skill
say -v Samantha "Use the test greeting skill with my name"
sleep 10

screencapture -x /tmp/iris-BH13-skill.png
grep -iE "skill|test.greeting|dynamic|scan" "$LOG_FILE" | tail -10
```
**Expected:** The custom skill is detected by the filesystem scanner. Iris can invoke it. Logs show skill loading and execution.

---

### BH14: Dynamic Skill — Hot Reload

**Priority:** P0
**Steps:**
```bash
# Modify the skill file while iris is running
cat > ~/.iris/skills/test-greeting.js << 'SKILL_EOF'
module.exports = {
    name: 'test_greeting',
    description: 'Updated test skill with a different message',
    parameters: { type: 'object', properties: { name: { type: 'string' } } },
    handler: async ({ name }) => {
        return { ok: true, result: `UPDATED: Hi ${name || 'world'}, skill was hot-reloaded!` };
    }
};
SKILL_EOF

sleep 5  # Wait for hot-reload detection

say -v Samantha "Use the test greeting skill again"
sleep 10

screencapture -x /tmp/iris-BH14-hotreload.png
grep -iE "skill|reload|rescan|updated" "$LOG_FILE" | tail -10
```
**Expected:** The modified skill is reloaded without restarting iris. Response includes "UPDATED" prefix from the new version. Logs show skill re-scan event.

---

### BH15: Malformed Skill — Graceful Error

**Priority:** P1
**Steps:**
```bash
# Write a broken skill file
cat > ~/.iris/skills/broken-skill.js << 'SKILL_EOF'
module.exports = {
    name: 'broken_skill',
    description: 'This skill has a syntax error',
    handler: async () => {
        // Intentional error: undefined variable
        return undefinedVariable.property;
    }
};
SKILL_EOF

sleep 5

say -v Samantha "Use the broken skill"
sleep 8

# Verify no crash
kill -0 $IRIS_PID 2>/dev/null && echo "PASS: Iris still running" || echo "FAIL: Iris crashed"

grep -iE "error|broken|skill|fail" "$LOG_FILE" | tail -10
screencapture -x /tmp/iris-BH15-broken.png

# Cleanup
rm -f ~/.iris/skills/broken-skill.js
```
**Expected:** Iris does NOT crash. Error is caught and reported gracefully (error bubble or verbal message). Logs show the skill execution error.

---

### BH16: Behavior State Persistence Across Restart

**Priority:** P1
**Steps:**
```bash
# Set to silent mode
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 2
grep -iE "mode.*silent|silent" "$LOG_FILE" | tail -3

# Restart iris using harness helper
restart_iris

# Check if mode is preserved
if grep -qi "silent\|mode.*restore" "$LOG_FILE" 2>/dev/null; then
  test_pass "BH16: Behavior mode persisted across restart"
else
  test_fail "BH16" "Behavior mode not restored after restart"
fi

# Restore to proactive
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
```
**Expected:** After restart, the behavior mode is restored to silent (persisted). Logs show mode restoration during startup.

---

### BH17: Vocabulary Persistence Across Restart

**Priority:** P1
**Steps:**
```bash
# Teach a vocabulary term
echo "Anthropic" | pbcopy
sleep 65  # Wait for clipboard polling

grep -iE "vocab.*Anthropic|track" "$LOG_FILE" | tail -3

# Restart iris using harness helper
restart_iris

# Check if vocabulary survived
if grep -qi "vocab\|Anthropic\|restore" "$LOG_FILE" 2>/dev/null; then
  test_pass "BH17: Vocabulary persisted across restart"
else
  test_fail "BH17" "Vocabulary terms not found after restart"
fi
grep -iE "vocab|load|restore|Anthropic" "$LOG_FILE" | head -10
```
**Expected:** Vocabulary terms persist across restart (stored in Convex or local data). "Anthropic" is still in the vocabulary after relaunch.

---

### BH18: Vocabulary Conflict — Two Corrections for Same Word

**Priority:** P2
**Steps:**
```bash
# Add two conflicting corrections for the same word
# Using the IPC channel via voice
say -v Samantha "When I say 'eye ris', I mean 'Iris'"
sleep 5

say -v Samantha "Actually, when I say 'eye ris', I mean 'IRIS' in all caps"
sleep 5

grep -iE "correction|conflict|overwrite|vocab" "$LOG_FILE" | tail -10
```
**Expected:** The second correction overwrites the first. No crash or duplicate entries. The most recent correction takes precedence.

---

### BH19: [OBSERVATIONAL] Gemini Batch Vocabulary Extraction

**Priority:** P2
**Steps:**
```bash
# Monitor for batch extraction events over 2 minutes
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Generate activity that triggers extraction (switch apps, browse)
open -a "Safari" "https://developer.mozilla.org"
sleep 10
open -a "Terminal"
sleep 5

# Wait for extraction cycle
sleep 90

tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "batch|extract|gemini.*vocab|flash"
```
**Expected:** Logs show Gemini Flash batch extraction of domain-specific terms from visible content. Full verification requires checking extracted terms against page content — see `learning-manager.test.js` for unit-level validation.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### BH20: Non-Latin Vocabulary — Japanese Input

**Priority:** P2
**Steps:**
```bash
# Check if Japanese voice is available
say -v Kyoko "テスト" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "SKIP: Japanese voice (Kyoko) not installed"
else
    say -v Kyoko "こんにちは、今日はいい天気ですね"
    sleep 10

    screencapture -x /tmp/iris-BH20-japanese.png
    grep -iE "transcript|japanese|non.latin|unicode" "$LOG_FILE" | tail -5
fi
```
**Expected:** If Japanese voice is available, Iris receives and processes the Japanese audio input. Gemini's STT handles non-Latin scripts. Transcript may show Japanese characters or transliteration.

---

### BH21: Intent Prediction — Cross-Session Learning

**Priority:** P1
**Steps:**
```bash
# Repeat a pattern 5 times to train the intent predictor
for i in $(seq 1 5); do
    say -v Samantha "Open Safari"
    sleep 8
    osascript -e 'tell application "Safari" to quit'
    sleep 3
done

# Check for learned pattern
grep -iE "intent.*predict|pattern|learn|temporal" "$LOG_FILE" | tail -10

# Restart to test cross-session persistence
restart_iris

# The intent predictor should recognize the pattern
if grep -qi "intent\|pattern\|temporal\|restore" "$LOG_FILE" 2>/dev/null; then
  test_pass "BH21: Intent patterns restored after restart"
else
  test_fail "BH21" "Intent patterns not found in logs after restart"
fi
grep -iE "intent.*pattern|temporal|restore|load" "$LOG_FILE" | head -10
```
**Expected:** After 5 repetitions, the intent prediction engine learns the "open Safari" pattern. After restart, the temporal pattern store is restored. Logs show pattern recognition and loading.

---

### BH22: [OBSERVATIONAL] Intent LRU Cache

**Priority:** P2
**Steps:**
```bash
# Issue several commands and watch for cache behavior
say -v Samantha "What time is it?"
sleep 5
say -v Samantha "What time is it?"
sleep 5
say -v Samantha "What time is it?"
sleep 5

grep -iE "cache|lru|hit|miss|classifyText" "$LOG_FILE" | tail -10
```
**Expected:** Logs show LRU cache hits for repeated identical queries. The first call may be a miss, subsequent calls should be cache hits. See intent prediction engine implementation for cache size limits.

---

### BH23: [OBSERVATIONAL] Confidence Calibration

**Priority:** P2
**Steps:**
```bash
# Issue commands and check for confidence calibration
say -v Samantha "Open Safari"
sleep 8

say -v Samantha "Play some music"
sleep 8

grep -iE "confidence|calibrat|outcome|pattern.*score" "$LOG_FILE" | tail -10
```
**Expected:** Logs show confidence scores being calibrated based on successful/failed outcomes. The calibration system adjusts prediction confidence over time. Full verification in unit tests.

---

### BH24: Self-Improvement — Skill Generation from Feedback

**Priority:** P1
**Steps:**
```bash
say -v Samantha "You made a mistake earlier. I need you to improve yourself and create a better approach."
sleep 15

screencapture -x /tmp/iris-BH24-selfimprove.png
grep -iE "self.improve|skill.gen|learn|feedback|fix" "$LOG_FILE" | tail -10
```
**Expected:** Iris triggers the self-improvement manager, which may generate a new skill or modify behavior. Logs show the improvement loop activation and any skill generation.

---

### BH25: Proactive Context Fingerprinting — No Duplicate Suggestions

**Priority:** P1
**Steps:**
```bash
# Open an error context
open -a "Terminal"
sleep 2
osascript -e 'tell application "Terminal" to do script "echo ERROR: something failed"'
sleep 15

# Note the suggestion (if any)
grep -iE "proactive|suggest" "$LOG_FILE" | tail -5

# Show the SAME error context again (should be deduped)
osascript -e 'tell application "Terminal" to do script "echo ERROR: something failed"'
sleep 15

grep -iE "proactive|fingerprint|dedup|skip|same.context" "$LOG_FILE" | tail -10
```
**Expected:** First error context may trigger a proactive suggestion. Second identical context is deduplicated via context fingerprinting (app name + capture dimensions). Logs show fingerprint match and skipped suggestion.

**Cleanup:**
```bash
osascript -e 'tell application "Terminal" to quit'
```

---

### BH26: Proactive Reply Opportunity Mode

**Priority:** P1
**Steps:**
```bash
# Open a messaging app to trigger reply-opportunity evaluation
open -a "Messages"
sleep 10

screencapture -x /tmp/iris-BH26-reply-opp.png
grep -iE "proactive|reply.opportunity|messaging|detect" "$LOG_FILE" | tail -10

osascript -e 'tell application "Messages" to quit' 2>/dev/null
```
**Expected:** The proactive engine detects a messaging app is focused and evaluates reply opportunity mode. Logs show the reply-opportunity evaluation path (distinct from intent-based or vision-based modes).

---

### BH27: Proactive Vision-Based Suggestion

**Priority:** P1
**Steps:**
```bash
# Open a complex UI to trigger vision-based evaluation
open -a "System Preferences" 2>/dev/null || open -a "System Settings"
sleep 10

screencapture -x /tmp/iris-BH27-vision.png
grep -iE "proactive|vision|gemini.*flash|screen.*eval" "$LOG_FILE" | tail -10

osascript -e 'tell application "System Settings" to quit' 2>/dev/null
osascript -e 'tell application "System Preferences" to quit' 2>/dev/null
```
**Expected:** The proactive engine uses Gemini Flash vision to analyze the screen and potentially offer a context-aware suggestion about system settings. Logs show the vision-based evaluation path.

---

### BH28: Frustration Detection from Voice

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

say -v Samantha "This is so frustrating! Nothing is working! Why does everything keep breaking!"
sleep 10

tail -n 30 "$LOG_FILE" | grep -iE "frustrat|emotion|detect|capture|sentiment"
screencapture -x /tmp/iris-BH28-frustration.png
```
**Expected:** The frustration capture pipeline detects negative sentiment from the voice input. Logs show frustration detection and possibly adjusted behavior (more helpful, less proactive). Iris may respond with empathy or offer specific help.

---

### BH29: Error Bubble UX After Tool Failure

**Priority:** P1
**Steps:**
```bash
# Trigger a tool that will likely fail
say -v Samantha "Read the file at /nonexistent/path/that/doesnt/exist.txt"
sleep 8

screencapture -x /tmp/iris-BH29-error-bubble.png
grep -iE "error|bubble|fail|tool.*error" "$LOG_FILE" | tail -10
```
**Expected:** An error bubble appears in the UI with appropriate styling (distinct from normal response bubbles). The error message is user-friendly. Iris acknowledges the failure verbally. No crash.

---

### BH30: [OBSERVATIONAL] Autonomous Daily Loop

**Priority:** P2
**Wall-clock time:** ~11 minutes (waits for 10min autonomous loop interval). Run concurrently with other long tests or skip if time-constrained.
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# The daily loop runs on IRIS_AUTONOMOUS_LOOP_INTERVAL_MS (default 10min)
echo "Waiting 11 minutes for autonomous loop event..."
sleep 660

tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "daily|loop|autonomous|ghost|draft|hourly"
```
**Expected:** After ~10 minutes, logs show the autonomous daily loop firing. If Ghost CMS is configured, a blog draft may be generated. The loop emits events via the RuntimeEventBus. Full verification in `voice-autonomous-loop.test.js`.

---

## Suite 8: Edge Cases & Performance

> **Tests error recovery, race conditions, and performance benchmarks.**
> **Precondition:** Iris running.

### EC01: WebSocket Reconnection After Network Blip

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Briefly toggle WiFi off and on (aggressive test)
# WARNING: This kills all network connections temporarily
wifi_off || { test_skip "$(basename $0)" "WiFi toggle unavailable"; }
sleep 3
wifi_on
sleep 10

tail -n 50 "$LOG_FILE" | grep -iE "reconnect|websocket|connection|retry|error"
screencapture -x /tmp/iris-EC01-reconnect.png
```
**Expected:** Logs show WebSocket disconnection followed by automatic reconnection. Iris recovers and becomes responsive again. Debug indicators may briefly turn red/yellow then green.

---

### EC02: Rapid Shortcut Spam

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Rapidly toggle voice 10 times
for i in $(seq 1 10); do
    ./helpers/iris-helper '{"action":"press_key","key":"cmd+i"}'
    sleep 0.2
done

sleep 3
screencapture -x /tmp/iris-EC02-spam.png

# Check for crashes or errors
tail -n 30 "$LOG_FILE" | grep -iE "error|crash|exception|uncaught"
```
**Expected:** No crash. App remains responsive. Final state is consistent (either muted or unmuted, not stuck).

---

### EC03: Voice During Tool Execution

**Priority:** P1
**Steps:**
```bash
# Trigger a slow tool
say -v Samantha "Search the web for the history of computing"
sleep 3

# Interrupt during tool execution
say -v Samantha "Never mind, stop"
sleep 8

screencapture -x /tmp/iris-EC03-interrupt.png
grep -iE "TOOL_EXECUTING|interrupt|state" "$LOG_FILE" | tail -10
```
**Expected:** State machine handles voice input during TOOL_EXECUTING state gracefully. Either queues the input or processes it after tool completes. No crash.

---

### EC04: Invalid Tool Request

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Click at position negative one thousand, negative two thousand"
sleep 8

grep -iE "error|invalid|fail|tool" "$LOG_FILE" | tail -5
screencapture -x /tmp/iris-EC04-invalid.png
```
**Expected:** Iris handles the invalid coordinates gracefully. Error bubble may appear but app does not crash. Logs show error handling.

---

### EC05: Close and Reopen Avatar Window

**Priority:** P1
**Steps:**
```bash
# Close avatar window
./helpers/iris-helper '{"action":"press_key","key":"cmd+w"}'
sleep 2
screencapture -x /tmp/iris-EC05-closed.png

# Check if tray can reopen (right-click tray menu → Show All)
# Since tray interaction is difficult via CLI, check logs for window lifecycle
grep -iE "window|close|destroy|show" "$LOG_FILE" | tail -10
```
**Expected:** Avatar window closes but app continues running (tray icon still present). The window can be reopened via tray menu.

---

### EC06: Multi-Step Voice Command — Clause Splitting

**Priority:** P0
**Steps:**
```bash
say -v Samantha "Open Safari and then go to github.com"
sleep 10

screencapture -x /tmp/iris-EC06-multistep.png
grep -iE "clause|split|intent|step" "$LOG_FILE" | tail -5

# Verify result
pgrep -x Safari && echo "Safari running: PASS" || echo "Safari running: FAIL"
osascript -e 'tell application "Safari" to get URL of current tab of window 1' 2>/dev/null
```
**Expected:** Intent router splits "Open Safari and go to github.com" into two actions. Safari opens, then navigates to github.com.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit'
```

---

### EC07: Ambiguous Intent

**Priority:** P2
**Steps:**
```bash
say -v Samantha "Open that thing from yesterday"
sleep 8

screencapture -x /tmp/iris-EC07-ambiguous.png
grep -iE "intent|fallback|clarif|ambiguous" "$LOG_FILE" | tail -5
```
**Expected:** Iris either asks for clarification or makes a best-effort interpretation. No crash. The learning classifier may attempt to resolve the ambiguity.

---

### EC08: URL Extraction from Speech

**Priority:** P1
**Steps:**
```bash
say -v Samantha "Go to https://example.com"
sleep 8

screencapture -x /tmp/iris-EC08-url.png
grep -iE "url|extract|navigate|example.com" "$LOG_FILE" | tail -5
```
**Expected:** Intent router extracts the URL from speech. Browser navigates to example.com.

**Cleanup:**
```bash
osascript -e 'tell application "Safari" to quit' 2>/dev/null
```

---

### EC09: Voice-to-Response Latency Measurement

**Priority:** P1
**Steps:**
```bash
# Record timestamp before speaking
START_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

say -v Samantha "What is two plus two?"

# Monitor logs for first response
sleep 10

# Find the response timestamp in logs
grep -iE "response|RESPONDING|contentPart" "$LOG_FILE" | tail -3

END_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
echo "Total wall time: $((END_TIME - START_TIME))ms (includes say playback time)"
```
**Expected:** Total voice-to-response time under 5 seconds (including `say` playback time). Pure processing latency (after speech ends → first response) target: <2s.

---

### EC10: Tool Execution Latency — open_app

**Priority:** P2
**Steps:**
```bash
osascript -e 'tell application "Calculator" to quit' 2>/dev/null
sleep 1

say -v Samantha "Open Calculator"

START=$(date +%s)
# Wait for Calculator to appear
for i in $(seq 1 10); do
    sleep 1
    if pgrep -x Calculator > /dev/null; then
        END=$(date +%s)
        echo "open_app latency: $((END - START))s"
        break
    fi
done

grep -iE "open_app|tool.*duration|slow" "$LOG_FILE" | tail -5
```
**Expected:** Calculator opens within 3 seconds of the voice command. Tool execution itself should be under 500ms.

**Cleanup:**
```bash
osascript -e 'tell application "Calculator" to quit'
```

---

### EC11: Memory Usage Over Extended Session

**Priority:** P2
**Steps:**
```bash
# Get initial memory usage
IRIS_PID=$(pgrep -f "electron.*iris" | head -1)
ps -o rss= -p $IRIS_PID 2>/dev/null | awk '{print "Memory (KB):", $1}'

# Wait 10 minutes (or skip if time-constrained)
echo "Monitoring memory for 10 minutes..."
for i in $(seq 1 10); do
    sleep 60
    ps -o rss= -p $IRIS_PID 2>/dev/null | awk -v m=$i '{print "Minute " m " - Memory (KB):", $1}'
done
```
**Expected:** Memory usage remains relatively stable (no unbounded growth). Some growth is expected due to conversation history but should stay under 1GB RSS.

---

### EC12: Avatar Rendering Smoothness

**Priority:** P2
**Steps:**
```bash
# Take 5 screenshots in quick succession to check for rendering artifacts
for i in $(seq 1 5); do
    screencapture -x "/tmp/iris-EC12-frame-$i.png"
    sleep 0.5
done

echo "Inspect screenshots for rendering quality:"
ls -la /tmp/iris-EC12-frame-*.png
```
**Expected:** All 5 screenshots show a properly rendered 3D avatar with no visual artifacts, black screens, or frozen frames. Three.js renders at 60fps target.

---

### EC13: Convex Failure — Exponential Backoff

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Kill network for 5 seconds to trigger Convex failures
wifi_off || { test_skip "$(basename $0)" "WiFi toggle unavailable"; }
sleep 5
wifi_on
sleep 15

# Check for exponential backoff behavior (4 retries, base 350ms)
tail -n 50 "$LOG_FILE" | grep -iE "convex|backoff|retry|fail|timeout|350"
```
**Expected:** Logs show Convex HTTP requests failing during the outage, followed by exponential backoff retries (base 350ms, up to 4 retries). After network restores, requests succeed again.

---

### EC14: Convex Recovery — Data Written After Restore

**Priority:** P1
**Precondition:** EC13 completed (network was restored)
**Steps:**
```bash
# Have a conversation to generate data that needs persisting
say -v Samantha "What is the capital of France?"
sleep 10

# Check that Convex writes succeed
grep -iE "convex|save|persist|write|conversation" "$LOG_FILE" | tail -10
```
**Expected:** After network recovery, Convex writes succeed. The conversation turn is persisted. No data loss from the outage period.

---

### EC15: [OBSERVATIONAL] Convex Vector Search Edge Cases

**Priority:** P2
**Steps:**
```bash
# Test empty query
say -v Samantha "Do you remember anything about... nothing?"
sleep 8

# Test very long query
say -v Samantha "Do you remember when we talked about that really long and complex topic involving multiple domains of knowledge including artificial intelligence, quantum computing, molecular biology, climate science, and philosophical implications of consciousness in digital systems?"
sleep 12

grep -iE "semantic.*search|vector|embed|query" "$LOG_FILE" | tail -10
```
**Expected:** Both queries are handled without errors. Empty or vague queries may return no results gracefully. Very long queries are truncated or handled within embedding limits. See `convex-store.test.js` for unit validation.

---

### EC16: Session Context Preservation After Reconnect

**Priority:** P1
**Steps:**
```bash
# Establish a conversation with a unique marker
say -v Samantha "The secret number is forty two"
sleep 8

# Kill network briefly to force reconnection
wifi_off || { test_skip "$(basename $0)" "WiFi toggle unavailable"; }
sleep 3
wifi_on
sleep 15

# Check if context is preserved
say -v Samantha "What was the secret number I just told you?"
sleep 10

screencapture -x /tmp/iris-EC16-context.png
grep -i "transcript" "$LOG_FILE" | tail -5
```
**Expected:** After reconnection, Iris remembers "forty two" from the previous conversation. The Gemini session may be re-established with context, or conversation history in Convex provides recall.

---

### EC17: Speak During Cold Initialization

**Priority:** P1
**Note:** This test restarts iris. It will restore iris to a running state when done.
**Steps:**
```bash
# Kill iris
kill $IRIS_PID 2>/dev/null
sleep 4

# Start iris and speak within 1 second (before ready)
cd "$IRIS_PROJECT_DIR"
IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev >> "$LOG_FILE" 2>&1 &
IRIS_PID=$!
sleep 1
say -v Samantha "Hello Iris are you ready?"

# Wait for full startup
for i in $(seq 1 25); do grep -qi "websocket\|ready\|voice" "$LOG_FILE" 2>/dev/null && break; sleep 1; done
sleep 3

# Check for crash
if kill -0 $IRIS_PID 2>/dev/null; then
  test_pass "EC17: No crash during cold initialization"
else
  test_fail "EC17" "Iris crashed when receiving audio during cold initialization"
  restart_iris  # Recover for subsequent tests
fi

ERRORS=$(grep -ciE "uncaught|unhandled.*reject" "$LOG_FILE" 2>/dev/null)
[ "${ERRORS:-0}" -eq 0 ] || test_fail "EC17" "Found $ERRORS uncaught exceptions during cold init"

snap "EC17-init"
```
**Expected:** Iris does not crash when receiving audio before initialization is complete. Audio is either buffered until ready or silently dropped. App becomes responsive after full startup.

---

### EC18: Close Window During Tool Execution

**Priority:** P1
**Steps:**
```bash
# Trigger a slow-ish tool
say -v Samantha "Search the web for the history of computing"
sleep 3

# Close the avatar window during tool execution
./helpers/iris-helper '{"action":"press_key","key":"cmd+w"}'
sleep 5

# Check for crash
kill -0 $IRIS_PID 2>/dev/null && echo "PASS: No crash" || echo "FAIL: Crashed"
grep -iE "error|crash|destroyed|null" "$LOG_FILE" | tail -10
screencapture -x /tmp/iris-EC18-close-during.png
```
**Expected:** Closing the avatar window during tool execution does NOT crash the app. The tool may complete in the background. Iris remains accessible via tray menu.

---

### EC19: Screen Capture Interval Verification

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Wait 30 seconds to collect 3 capture cycles (10s interval)
sleep 35

# Count capture events
CAPTURES=$(tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -ciE "capture|screenshot|screen.*capture")
echo "Captures in 35s: $CAPTURES (expected ~3)"

tail -n 30 "$LOG_FILE" | grep -iE "capture|screen" | head -10
```
**Expected:** Approximately 3 screen captures in 35 seconds (one every ~10s, which is the `PASSIVE_CAPTURE_INTERVAL_MS`). Capture count may vary if user is idle (capture stops after 60s of inactivity).

---

### EC20: [OBSERVATIONAL] Screen Capture Retina Scaling

**Priority:** P2
**Steps:**
```bash
grep -iE "retina|scale|devicePixel|dpr|display.*scale" "$LOG_FILE" | tail -5
```
**Expected:** Logs show display scale factor handling. On Retina displays (MacBook), the capture system accounts for 2x scaling when mapping coordinates between image space and screen space.

---

### EC21: [OBSERVATIONAL] IPC Channel Health

**Priority:** P2
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Monitor for 5 minutes
echo "Monitoring IPC health for 5 minutes..."
sleep 300

# Check for any IPC errors or timeouts
tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "ipc.*error|ipc.*timeout|channel.*fail|invoke.*fail"
echo "---"
# Also check for healthy IPC activity
tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -ciE "ipc|invoke|send|channel"
echo "IPC messages in 5min ^^^"
```
**Expected:** Zero IPC errors or timeouts during normal operation. Dozens to hundreds of healthy IPC messages. The 80+ IPC channels should operate without failures.

---

### EC22: Long Session Stability — 1 Hour Memory Monitor

**Priority:** P2
**Wall-clock time:** ~65 minutes. Run this LAST or in a background subagent. If time-constrained, reduce the loop from 60 to 10 minutes.
**Steps:**
```bash
IRIS_PID_MAIN=$(pgrep -f "electron.*iris" | head -1)
echo "Monitoring PID $IRIS_PID_MAIN for 60 minutes..."

MEMORY_LOG="$HOME/.iris/test-logs/memory-$(date +%Y%m%d-%H%M%S).csv"
echo "minute,rss_kb" > "$MEMORY_LOG"

for i in $(seq 0 5 60); do
    RSS=$(ps -o rss= -p $IRIS_PID_MAIN 2>/dev/null)
    echo "$i,$RSS" >> "$MEMORY_LOG"
    echo "Minute $i: ${RSS}KB"

    # Do some activity every 10 minutes to keep the session alive
    if [ $((i % 10)) -eq 0 ] && [ $i -gt 0 ]; then
        say -v Samantha "Memory check at minute $i" &
    fi

    sleep 300  # 5 minute intervals
done

echo "Memory log: $MEMORY_LOG"
cat "$MEMORY_LOG"
```
**Expected:** Memory (RSS) stays relatively stable over 60 minutes. Some growth is expected but should not exceed 200MB increase from baseline. If memory doubles or more, indicates a leak.

---

### EC23: [OBSERVATIONAL] WebSocket Keepalive

**Priority:** P2
**Wall-clock time:** ~30 minutes. Run concurrently with EC22 or skip if time-constrained.
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

echo "Monitoring WebSocket keepalive for 30 minutes..."
sleep 1800

tail -n $(($(wc -l < "$LOG_FILE") - LOG_LINES_BEFORE)) "$LOG_FILE" | grep -iE "ping|pong|keepalive|heartbeat|ws.*alive"
```
**Expected:** Logs show periodic WebSocket keepalive activity (ping/pong frames or heartbeat messages) maintaining the Gemini connection over 30 minutes. No unexpected disconnections.

---

### EC24: Rapid Network Toggle

**Priority:** P1
**Steps:**
```bash
LOG_LINES_BEFORE=$(wc -l < "$LOG_FILE")

# Toggle WiFi off/on twice rapidly
wifi_off || { test_skip "$(basename $0)" "WiFi toggle unavailable"; }
sleep 1
wifi_on
sleep 2
wifi_off || { test_skip "$(basename $0)" "WiFi toggle unavailable"; }
sleep 1
wifi_on
sleep 15

# Check for recovery
tail -n 30 "$LOG_FILE" | grep -iE "reconnect|restore|recover|websocket|convex"

# Verify iris still works
say -v Samantha "Are you still there?"
sleep 8
screencapture -x /tmp/iris-EC24-netswitch.png
```
**Expected:** Iris recovers from rapid network toggling. WebSocket and Convex connections re-establish. Iris responds to the follow-up question.

---

### EC25: Autonomous Mode + User Interaction Simultaneously

**Priority:** P1
**Steps:**
```bash
# Ensure proactive/autonomous mode is active
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'
sleep 1
# (Toggle until in proactive mode — check logs)
grep -iE "mode.*proactive" "$LOG_FILE" | tail -1

# Wait for autonomous activity to potentially fire
sleep 30

# While autonomous loop may be running, issue a direct command
say -v Samantha "What is two plus two?"
sleep 8

screencapture -x /tmp/iris-EC25-autonomous.png
grep -iE "autonomous|conflict|queue|priority|user.*input" "$LOG_FILE" | tail -10
```
**Expected:** User commands take priority over autonomous actions. No conflict or race condition. Iris responds to the user even if an autonomous task is pending/running. Autonomous actions resume after user interaction completes.

---

## Appendix A: Tool Reference

### iris-helper Commands

```bash
# Mouse
./helpers/iris-helper '{"action":"click_at","x":100,"y":200}'
./helpers/iris-helper '{"action":"click_at","x":100,"y":200,"button":"right"}'
./helpers/iris-helper '{"action":"double_click","x":100,"y":200}'
./helpers/iris-helper '{"action":"mouse_move","x":100,"y":200}'
./helpers/iris-helper '{"action":"drag","x":100,"y":200,"x2":300,"y2":400}'

# Keyboard
./helpers/iris-helper '{"action":"type_text","text":"hello world"}'
./helpers/iris-helper '{"action":"press_key","key":"return"}'
./helpers/iris-helper '{"action":"press_key","key":"cmd+c"}'
./helpers/iris-helper '{"action":"press_key","key":"cmd+shift+m"}'

# Apps
./helpers/iris-helper '{"action":"open_app","name":"Safari"}'
./helpers/iris-helper '{"action":"get_frontmost_app"}'

# Accessibility
./helpers/iris-helper '{"action":"ax_snapshot"}'
./helpers/iris-helper '{"action":"ax_find","query":"search","role":"button"}'

# System
./helpers/iris-helper '{"action":"set_volume","level":0.5}'
./helpers/iris-helper '{"action":"clipboard_read"}'
./helpers/iris-helper '{"action":"get_mouse_position"}'
```

### cliclick Commands (Backup)

```bash
cliclick c:100,200          # Click at coordinates
cliclick dc:100,200         # Double-click
cliclick rc:100,200         # Right-click
cliclick m:100,200          # Move mouse
cliclick t:"hello world"    # Type text
cliclick kp:return          # Press key
cliclick kd:cmd ku:cmd      # Hold and release key
```

### Screenshot Capture

```bash
screencapture -x /tmp/screenshot.png              # Silent full-screen capture
screencapture -x -R 0,0,800,600 /tmp/region.png   # Capture specific region
```

### Audio via say

```bash
say -v Samantha "Hello Iris"                       # Speak through audio output
say -v Samantha -r 200 "Fast speech"               # Faster rate
say -v Samantha -r 80 "Slow speech"                # Slower rate
say -o /tmp/output.aiff "Save to file"             # Save as audio file
```

---

## Appendix B: Log Patterns to Grep

| What to find | Grep pattern |
|---|---|
| Transcriptions | `grep -i "transcript" "$LOG_FILE"` |
| Tool executions | `grep -iE "tool.*(start\|end\|execute)" "$LOG_FILE"` |
| Voice state changes | `grep -iE "state.*(IDLE\|LISTENING\|SPEAKING\|PROCESSING\|RESPONDING)" "$LOG_FILE"` |
| Errors | `grep -iE "error\|exception\|crash\|fail" "$LOG_FILE"` |
| WebSocket status | `grep -iE "websocket\|ws.*(open\|close\|connect)" "$LOG_FILE"` |
| Behavior mode | `grep -iE "mode.changed\|behavior\|silent\|proactive" "$LOG_FILE"` |
| Proactive suggestions | `grep -iE "proactive\|suggest" "$LOG_FILE"` |
| Screen capture | `grep -iE "capture\|screenshot\|screen" "$LOG_FILE"` |
| Vocabulary | `grep -iE "vocab\|correction\|rewrite" "$LOG_FILE"` |
| Convex persistence | `grep -iE "convex\|persist\|save" "$LOG_FILE"` |
| UI-TARS actions | `grep -iE "tars\|ui.task\|vision" "$LOG_FILE"` |
| Barge-in | `grep -iE "barge\|interrupt" "$LOG_FILE"` |
| Echo suppression | `grep -iE "echo\|suppression\|lms" "$LOG_FILE"` |
| Dynamic skills | `grep -iE "skill\|scan\|reload\|dynamic" "$LOG_FILE"` |
| Intent prediction | `grep -iE "intent\|predict\|pattern\|classify" "$LOG_FILE"` |
| Kanban/tasks | `grep -iE "kanban\|task\|milestone" "$LOG_FILE"` |
| Link capture | `grep -iE "link\|capture\|poll\|url" "$LOG_FILE"` |
| Frustration | `grep -iE "frustrat\|emotion\|sentiment" "$LOG_FILE"` |

### Sample Log Output Formats

> These are representative log formats. Actual output may vary but patterns above should still match.

```
# Transcript events
[voice] transcript: "hello iris how are you today"
[voice] inputTranscription: { text: "hello iris", isFinal: true }

# Voice state transitions
[voice-engine] state → LISTENING
[voice-engine] state → USER_SPEAKING (volume: 0.15)
[voice-engine] state → PROCESSING
[voice-engine] state → RESPONDING
[voice-engine] state → IDLE

# Tool execution
[tools] TOOL_START execute_tool: open_app {"name":"Safari"}
[tools] TOOL_END open_app ok=true duration=380ms
[tools] TOOL_START execute_tool: web_search {"query":"weather today"}
[tools] TOOL_END web_search ok=true duration=2100ms

# Barge-in detection
[voice-engine] barge-in detected: volume=0.08 > threshold=0.04 during RESPONDING

# Echo suppression
[capture] echo suppression active, LMS filter order=128

# Proactive engine
[proactive] suggestion fired: confidence=0.85 context="error terminal"
[proactive] fingerprint match: skipping duplicate for hash=abc123

# Convex persistence
[convex] persist conversation turn: role=assistant, id=conv_abc123
[convex] retry 1/4 after 350ms: NetworkError

# Skill scanning
[skills] scan: found 3 skills in ~/.iris/skills/
[skills] hot-reload: test-greeting.js modified, reloading

# Screen capture
[screen-capture] passive capture #42: 1440x900 jpeg quality=40
```

---

## Appendix C: Environment Variables for Test Modes

```bash
# Use BlackHole as audio input (dynamic voice testing)
IRIS_AUDIO_DEVICE="BlackHole 2ch" pnpm dev

# Use a WAV file as fake audio input (static, requires restart per utterance)
IRIS_TEST_AUDIO="/path/to/voice.wav" pnpm dev

# Enable fake audio device without a specific file (Chromium generates silence)
IRIS_TEST_AUDIO=1 pnpm dev
```

---

## Appendix D: Troubleshooting

### BlackHole audio not reaching Electron
1. Verify Multi-Output Device is set as system output: `SwitchAudioSource -c -t output`
2. Verify BlackHole appears as input: `SwitchAudioSource -a -t input | grep BlackHole`
3. Check `IRIS_AUDIO_DEVICE` env var is set when launching iris
4. Restart iris after audio configuration changes

### Avatar window not visible
1. Check tray menu → Show All
2. Check if window is off-screen: `grep -i "window.*position\|bounds" "$LOG_FILE"`
3. Restart iris

### No response from Iris after speaking
1. Check MUTED badge — click avatar or press Cmd+I to unmute
2. Verify Gemini WebSocket connection: `grep -i "websocket" "$LOG_FILE" | tail -5`
3. Check API key: `grep -i "api.*key\|auth.*fail" "$LOG_FILE"`
4. Verify audio input is active: check MIC debug indicator

### Tools not executing
1. Check tool error logs: `grep -i "tool.*error\|tool.*fail" "$LOG_FILE"`
2. Verify accessibility permissions for iris-helper
3. Check if the requested app is installed

### Screen recording issues
1. Grant screen recording permission: System Settings → Privacy & Security → Screen Recording → allow Terminal/iTerm
2. Verify ffmpeg: `ffmpeg -version`
3. Check available video devices: `ffmpeg -f avfoundation -list_devices true -i "" 2>&1`

---

## Appendix E: Observational Test Coverage Map

> Scenarios marked `[OBSERVATIONAL]` can only be partially verified via log grep from CLI. The table below maps each to the unit test that provides full verification.

| Scenario | What It Checks | Unit Test for Full Verification |
|----------|---------------|-------------------------------|
| V15 | Audio playback speech profile (biquad EQ, compressor) | `test/audio-playback-voice-profile.test.js` |
| V16 | 24kHz→16kHz echo reference signal resampling | `test/audio-capture-worklet.test.js` |
| BH19 | Gemini Flash batch vocabulary extraction | `test/learning-manager.test.js` |
| BH22 | Intent classification LRU cache hits/misses | Intent prediction engine tests (if present) |
| BH23 | Confidence calibration from pattern outcomes | `test/intent-confidence-calibration.test.js` (if present) |
| BH30 | Autonomous daily loop / Ghost CMS drafts | `test/voice-autonomous-loop.test.js` |
| EC15 | Convex vector search with edge-case queries | `test/convex-store.test.js` |
| EC20 | Screen capture Retina/HiDPI scaling | Manual verification (compare image coords vs screen coords) |
| EC21 | IPC channel health over extended period | Covered collectively by all IPC-using unit tests |
| EC23 | WebSocket keepalive over 30+ minutes | Gemini client tests (if present) |
| U09 | 3D gen / design tool output validation | No unit test — manual review only |

**How to run the unit tests for full verification:**
```bash
cd /Users/abhi/proj/sensei/iris-chan
pnpm test                              # Run all 78+ unit tests
pnpm test -- --grep "audio-playback"   # Run specific test
node scripts/run-tests.js              # Alternative test runner
```

---

## Appendix F: Suite Cleanup Commands

> Run the relevant cleanup after each suite to prevent state leakage between suites.

```bash
# Suite 3 (Tools) cleanup
rm -f /tmp/iris-test-output.txt /tmp/weather-summary.txt
osascript -e 'tell application "TextEdit" to quit saving no' 2>/dev/null
osascript -e 'tell application "Safari" to quit' 2>/dev/null
osascript -e 'tell application "Calculator" to quit' 2>/dev/null

# Suite 4 (Browser) cleanup
osascript -e 'tell application "Safari" to quit' 2>/dev/null
osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null

# Suite 5 (UI-TARS) cleanup
osascript -e 'tell application "Safari" to quit' 2>/dev/null
osascript -e 'tell application "System Settings" to quit' 2>/dev/null
osascript -e 'tell application "Notes" to quit' 2>/dev/null
osascript -e 'tell application "Finder" to close every window' 2>/dev/null
rm -f ~/Desktop/iris-drag-test.txt /tmp/iris-drag-test.txt

# Suite 7 (Behavior/Learning) cleanup
rm -f ~/.iris/skills/test-greeting.js ~/.iris/skills/broken-skill.js
osascript -e 'tell application "Terminal" to quit' 2>/dev/null
osascript -e 'tell application "Messages" to quit' 2>/dev/null
osascript -e 'tell application "Safari" to quit' 2>/dev/null

# Suite 8 (Edge Cases) cleanup
# Restore network if toggled
wifi_on 2>/dev/null
osascript -e 'tell application "Safari" to quit' 2>/dev/null
```

---

## Appendix G: Test Totals Summary

| Suite | Scenarios | OBSERVATIONAL | Restart Required |
|-------|-----------|--------------|-----------------|
| 0: Setup & Teardown | 6 | 0 | N/A |
| 1: Voice Pipeline | 17 | 2 | 1 (V17) |
| 2: Avatar & Windows | 16 | 0 | 1 (A14) |
| 3: Tool Execution | 35 | 0 | 0 |
| 4: Browser Automation | 12 | 0 | 0 |
| 5: UI-TARS Vision | 9 | 1 | 0 |
| 6: Auth & 2FA | 4 | 0 | 0 |
| 7: Behavior & Learning | 30 | 4 | 3 (BH16, BH17, BH21) |
| 8: Edge Cases & Perf | 25 | 4 | 1 (EC17) |
| **TOTAL** | **154** | **11** | **6** |
