# Echo Suppression - Aggressive Mode (V2)

## What Changed

Upgraded the echo suppression to be much more aggressive after initial testing:

### 1. Direct Reference Signal Extraction
- **Before**: Used deprecated ScriptProcessor with timing issues
- **After**: Extract reference signal directly when audio is enqueued
- **Impact**: Reference signal is now in sync with actual playback, much more reliable

### 2. More Aggressive Detection
- **Before**: Only suppress if correlation > 0.5 (needed strong echo)
- **After**: Suppress if ANY reference signal detected (RMS > 0.001)
- **Impact**: Catches much weaker echoes earlier

### 3. Maximum Suppression Gain
- **Before**: Default 0.8 (80% suppression)
- **After**: Default 1.0 (100% suppression)
- **Impact**: More aggressive echo removal

### 4. Power-Law Weighting
- Applied stronger subtraction at higher signal levels
- Avoids over-suppression of quiet signals
- Preserves quiet user speech better

## How It Works Now

1. **Enqueue Phase**: When Iris sends audio
   - Audio converted to float32 (24kHz)
   - Immediately resampled to 16kHz
   - Sent as reference signal to microphone capture

2. **Capture Phase**: In real-time as you speak
   - Reference signal received in worklet
   - RMS level checked (even low RMS triggers suppression)
   - Spectral subtraction applied: `output = mic - (1.0 * reference)`
   - Clean audio sent to Gemini

3. **Correlation Boost**: If patterns match
   - Strong correlation (>0.2) increases suppression further
   - Prevents legitimate speech from being suppressed

## Expected Improvements

- Iris should no longer hear her own responses
- System audio should be significantly reduced
- Your voice should still be clear

## If Still Hearing Echo

You can fine-tune:

```javascript
// Reduce suppression if it's affecting your voice too much
pipeline.setEchoSuppressionGain(0.7);

// Or disable temporarily to test
pipeline.setEchoSuppressionEnabled(false);
```

## Debug: How to Tell It's Working

Check logs for:
```
[Echo] Echo cancellation active (browser AEC + software suppression at 100%)
```

And you should see the reference signals being sent when Iris plays audio.

## Technical Details

### Reference Signal Timing
- Extracted at enqueue time (synchronous with audio playback)
- No processing delay like ScriptProcessor
- Resampling: Linear interpolation from 24kHz → 16kHz

### Suppression Formula
```
output[i] = mic[i] - (suppressionGain * reference[i])
where suppressionGain = 1.0 (100%)
```

### Correlation-Based Boost
```
if correlation(mic, ref) > 0.2:
    alpha = min(1.0, suppressionGain * (0.5 + correlation))
```

## Files Modified
- `src/renderer/voice/playback.js` - Direct reference extraction on enqueue
- `src/renderer/voice/capture.js` - More aggressive echo detection algorithm
- `src/renderer/voice/pipeline.js` - 100% default suppression gain

## Next Steps if Issues Persist

1. **Check volume levels**: Speaker too loud? Reduce it
2. **Microphone placement**: Keep away from speakers
3. **Test with suppression disabled**: `setEchoSuppressionEnabled(false)`
4. **Try lower gain**: `setEchoSuppressionGain(0.6)` if voice quality suffers
