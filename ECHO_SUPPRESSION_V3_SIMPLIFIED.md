# Echo Suppression - V3 (Simplified Gate-Based)

## What Changed

Completely simplified the approach using a **dual-method gate-based system** instead of relying on complex cross-correlation:

### Method 1: Reference Signal Suppression (When Playing)
When Iris plays audio:
1. Reference signal extracted from playback (24kHz → 16kHz)
2. Signal subtracted directly from microphone: `mic_output = mic_input - (gain * reference)`
3. Simple, direct, synchronous

### Method 2: Playback Gate Suppression (Safety Net)
When reference signal is unavailable:
1. Detect if playback recently occurred
2. Apply **quiet signal gate**: suppress signals below 0.02 RMS by 70%
3. Loud signals (your speech) pass through unaffected
4. This catches echo/ambient noise while preserving speech

## Why This Works Better

- **No complex correlation math**: Just direct subtraction
- **No timing issues**: Reference sent with audio enqueue
- **Fallback protection**: Gate suppresses echo even if reference fails
- **Speech-aware**: Loud speech isn't suppressed, only quiet background/echo

## How to Understand It

Think of it like noise gates in audio engineering:
- When Iris is speaking, we know exactly what's being played (reference signal)
- We subtract that from your microphone
- If subtraction fails, we just mute quiet sounds (where echo lives) and keep loud sounds (where speech lives)

## Configuration

Default behavior:
```javascript
suppressionGain = 1.0          // 100% reference subtraction
playbackGateThreshold = 0.02   // Suppress if signal < 0.02 RMS
quietSignalReduction = 0.3     // Reduce quiet signals to 30% (70% suppression)
```

Adjust if needed:
```javascript
pipeline.setEchoSuppressionGain(0.8);  // 80% if too aggressive
```

## Expected Result

- Iris no longer hears her own voice ✓
- System audio suppressed during playback ✓
- Your speech preserved ✓
- Simpler, more reliable code ✓

## How It Detects Playback Ended

1. Playback starts → `isPlaybackActive = true`
2. Reference signals arrive during playback
3. Playback ends → capture worklet receives `playbackStop` message
4. Gate mode activates for a few seconds as safety net

## Files Changed
- `src/renderer/voice/capture.js` - Dual-method suppression
- `src/renderer/voice/pipeline.js` - Added playback end notification

## Debug Info in Logs

Watch for:
```
[Echo] Echo cancellation active (browser AEC + software suppression at 100%)
[Renderer] [ECHO DEBUG] Ref signal present: true/false
```

If `Ref signal present: false`, the gate suppression activates automatically.

## Next: Test It

1. Start Iris
2. Have a conversation
3. During Iris's response, check if you still hear her in your mic
4. Adjust gain if needed

The simplicity of this approach should make it much more reliable!
