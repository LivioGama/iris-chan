# Echo Cancellation System

## Overview

Iris now has a **dual-layer acoustic echo cancellation (AEC)** system that prevents her from hearing her own audio output and system sounds:

1. **Browser-level AEC**: Enabled via `echoCancellation: true` in `getUserMedia()` constraints
2. **Software-based echo suppression**: Cross-correlation detection + spectral subtraction

## How It Works

### Layer 1: Browser Echo Cancellation
- Automatically enabled when microphone is requested with `echoCancellation: true`
- Handled by the browser's WebRTC implementation
- Works for most common echo scenarios

### Layer 2: Software Echo Suppression
The software layer provides additional echo rejection:

1. **Reference Signal Extraction**
   - AudioPlayback captures the audio being played (24kHz)
   - Resamples to 16kHz to match microphone capture rate
   - Sends reference signal to the capture worklet

2. **Cross-Correlation Detection**
   - Worklet detects correlation between playback and microphone signals
   - High correlation (>0.5) = echo detected
   - Low correlation = no echo or actual user speech

3. **Spectral Subtraction**
   - When echo is detected, the playback signal is subtracted from microphone
   - Subtraction amount controlled by `suppressionGain` (0-1)
   - Default: 0.8 (80% suppression)

## Configuration

### In Code
Adjust settings in `src/renderer/voice/pipeline.js` constructor:

```javascript
this._echoSuppressionEnabled = true;      // Enable/disable
this._echoSuppressionGain = 0.8;          // 0-1 (default 80%)
```

### At Runtime
The VoicePipeline exposes these methods:

```javascript
// Enable/disable software echo suppression
pipeline.setEchoSuppressionEnabled(true);
pipeline.setEchoSuppressionEnabled(false);

// Set suppression aggressiveness (0-1)
pipeline.setEchoSuppressionGain(0.6);  // 60% suppression
pipeline.setEchoSuppressionGain(1.0);  // Maximum suppression

// Query current settings
const enabled = pipeline.getEchoSuppressionEnabled();
const gain = pipeline.getEchoSuppressionGain();
```

## Tuning Guidelines

### If Iris is still hearing her own voice:
- Increase `suppressionGain`: `setEchoSuppressionGain(0.9)` or `1.0`
- Note: Higher values may also suppress legitimate user speech at low volumes

### If Iris isn't hearing you properly:
- Decrease `suppressionGain`: `setEchoSuppressionGain(0.5)` or `0.6`
- Disable software suppression: `setEchoSuppressionEnabled(false)` (rely on browser AEC)

### If you're getting intermittent issues:
- Check system audio levels (speaker volume too high?)
- Verify microphone placement (not too close to speakers)
- Disable other audio inputs (VoIP apps, music)

## Technical Details

### Worklet Message Protocol
The capture worklet accepts these messages:

```javascript
// Send reference signal from playback (audio to suppress)
{ type: 'reference', samples: Float32Array }

// Enable/disable echo suppression
{ type: 'setEchoSuppression', enabled: boolean }

// Set suppression gain (0-1)
{ type: 'setSuppressionGain', gain: number }
```

### Sample Rates
- Microphone capture: 16kHz (captured, processed, sent to Gemini)
- Playback: 24kHz (from Gemini, but resampled to 16kHz for echo suppression)
- Linear interpolation used for 24kHz → 16kHz resampling

## Logs
When echo cancellation activates, you'll see:
```
Echo: Echo cancellation active (browser AEC + software suppression at 80%)
Echo: Echo suppression enabled
Echo: Echo suppression gain set to 80%
```

## Files Modified
- `src/renderer/voice/capture.js` - Worklet echo suppression logic + API
- `src/renderer/voice/playback.js` - Reference signal extraction + resampling
- `src/renderer/voice/pipeline.js` - Wiring + control methods

## Future Improvements
- [ ] Adaptive gain (automatically adjust based on detected echo strength)
- [ ] Per-frequency echo suppression (avoid suppressing voice frequencies)
- [ ] UI controls for echo suppression parameters
- [ ] Echo path estimation (better alignment of reference signal with actual echo)
