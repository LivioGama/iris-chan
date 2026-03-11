# Manual End-to-End Verification Plan

This document captures the gold-path manual verification flows for cross-app assist behavior.

## Preconditions

- Iris is running with microphone, screen capture, and clipboard permissions granted.
- The voice pipeline is connected and responsive.
- The target app content is fully visible before each spoken instruction.
- Any generated output that supports copy/export should be verified through the destination app or saved file, not only through the UI.

## Test 1 — Replying To A Message

Objective: Verify contextual message reply generation and clipboard interaction.

1. Open WhatsApp with a tense message visible.
2. Blink at the message.
3. Say: `Reply calmly with empathy.`
4. Expected: Three numbered reply options are displayed.
5. Say: `Use option 2.`
6. Expected: Option 2 is copied to the clipboard.
7. Paste into WhatsApp.
8. Verify: The pasted content exactly matches option 2.

## Test 2 — Code Improvement Verification

Objective: Validate code understanding, improvement, and copy workflow.

1. Open VS Code with a function visible.
2. Click on the code.
3. Say: `Give me a better implementation.`
4. Expected:
   - Improved code
   - Clear explanation of changes
5. Click the Copy button.
6. Expected: Code is copied to the clipboard.
7. Paste into VS Code.
8. Verify:
   - Syntax is valid
   - Code runs or passes linting

## Test 3 — Meeting Summary

Objective: Ensure structured summarization and export functionality.

1. Open a Zoom meeting transcript.
2. Click on the transcript.
3. Say: `Summarize.`
4. Expected: Structured summary including sections with:
   - `:dart: Objectives`
   - `:white_check_mark: Decisions`
   - `:pushpin: Key Points`
   - `:warning: Risks / Follow-ups`
5. Click the Export button.
6. Expected: Save dialog opens.
7. Save as `meeting-summary.md`.
8. Verify: File content exactly matches the generated summary.

## Test 4 — Writing Comments

Objective: Validate tone analysis and rewrite accuracy.

1. Open Mail with the email draft visible.
2. Blink at the email body.
3. Say: `Analyze my tone and make it professional.`
4. Expected:
   - Tone analysis
   - Three rewritten options
5. Say: `Copy option 1.`
6. Expected: Professional version is copied to the clipboard.
7. Paste into the email.
8. Verify: Tone is professional, neutral, and appropriate.

## Test 5 — Chart Analysis

Objective: Validate visual understanding and factual accuracy.

1. Open a PDF with a bar chart visible.
2. Blink at the chart.
3. Say: `Explain this chart in simple terms.`
4. Expected:
   - Trends
   - Key data points
   - Conclusions
   - Suggested title
5. Verify: Mentioned figures match the chart data.
6. Copy the suggested title.
7. Verify: Clipboard contains the correct title.

## Run Log Template

Use this table when executing the suite manually:

| Test | Pass/Fail | Notes | Evidence |
| --- | --- | --- | --- |
| Test 1 — Replying To A Message | | | |
| Test 2 — Code Improvement Verification | | | |
| Test 3 — Meeting Summary | | | |
| Test 4 — Writing Comments | | | |
| Test 5 — Chart Analysis | | | |
