# Echo Cancellation - Quick Start

## What Was Implemented

Your Iris app now has **dual-layer acoustic echo cancellation** to prevent her from hearing:
- Her own voice playback (responses)
- System audio from other apps
- Microphone feedback/echo

## How to Test It

1. **Start Iris** - The app is already running with echo cancellation enabled
2. **Check logs** - You should see:
   ```
   [Echo] Echo cancellation active (browser AEC + software suppression at 80%)
   ```

## Control It

### From JavaScript (in DevTools or code)
```javascript
// Access the pipeline from the renderer
window.electronAPI.voicePipeline // (if exposed via preload)

// Or directly in pipeline initialization:
pipeline.setEchoSuppressionEnabled(true);    // Enable/disable
pipeline.setEchoSuppressionGain(0.8);        // Set strength (0-1)
```

### Levels of Echo Cancellation
1. **Browser AEC** - Always on (in `getUserMedia` constraints)
   - Handles most common echo scenarios
   - Provided by browser's WebRTC implementation

2. **Software Suppression** - Configurable
   - Detects playback echoing in microphone
   - Subtracts detected echo signal
   - Default: 80% suppression

## If It's Not Working

### Iris still hears her own voice?
Try increasing suppression:
```javascript
pipeline.setEchoSuppressionGain(0.95);  // Stronger suppression
```

### Iris isn't picking up your voice?
Try decreasing suppression or disabling:
```javascript
pipeline.setEchoSuppressionGain(0.5);   // Weaker suppression
pipeline.setEchoSuppressionEnabled(false);  // Use only browser AEC
```

### Intermittent issues?
- Lower your speaker volume
- Keep microphone away from speakers
- Close other audio apps (music, calls, etc.)

## How It Works (Technical)

### Step 1: Capture Reference Signal
- AudioPlayback monitors the audio being played (24kHz)
- Resamples it to 16kHz to match microphone capture

### Step 2: Detect Echo
- AudioWorklet compares microphone input vs playback signal
- Computes cross-correlation to find similarity
- If correlation > 0.5 → echo detected

### Step 3: Suppress Echo
- Subtracts the playback signal from microphone
- Amount controlled by `suppressionGain`
- Clean audio sent to Gemini

## Files Changed
- ✅ `src/renderer/voice/capture.js` - Added echo suppression logic
- ✅ `src/renderer/voice/playback.js` - Added reference signal extraction
- ✅ `src/renderer/voice/pipeline.js` - Wired components + control methods

## Logs to Watch
```
[Echo] Echo cancellation active (browser AEC + software suppression at 80%)
[Echo] Echo suppression enabled
[Echo] Echo suppression disabled
[Echo] Echo suppression gain set to 50%
```

## Next Steps to Tune
1. Test with your microphone and speakers
2. Adjust suppression gain based on results
3. Check `~/Desktop/consolidated_messages.log` for echo-related messages
4. Optional: Implement UI controls for real-time adjustment
