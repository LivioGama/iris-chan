# 3D Model Generation Setup Guide for Iris-chan

Generate high-quality 3D GLB models from images using **DreamGaussian** locally. This guide covers installation and usage.

## Overview

- **Tool**: `generate_3d_model` (voice-callable)
- **Backend**: DreamGaussian (local diffusion-based 3D generation)
- **Output**: GLB files (3D models) + preview images
- **Quality**: ⭐⭐⭐⭐⭐ High quality, slow (5-10 min per image)
- **Requirements**: NVIDIA GPU with ≥10GB VRAM, CUDA 11.8+

---

## Installation

### 1. **Check Prerequisites**

```bash
# Check Python
python3 --version  # Should be 3.8+

# Check NVIDIA GPU (required!)
nvidia-smi
# You should see GPU memory available

# Check CUDA
python3 -c "import torch; print(torch.cuda.is_available())"
# Should print: True
```

### 2. **Install Dependencies**

```bash
cd ~/Desktop/iris-chan

# Install PyTorch with CUDA support
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install Iris 3D requirements
pip install -r requirements-3d.txt

# Install DreamGaussian from GitHub
pip install git+https://github.com/dreamgaussian/dreamgaussian.git

# Verify installation
python3 -c "import dreamer_gaussian; print('✓ DreamGaussian installed')"
```

### 3. **Test Setup from Iris**

Start the Iris app and use:

```
"Check if 3D generation is set up"
```

Or manually:

```bash
python3 scripts/dreamgaussian-gen.py --help
```

---

## Usage

### **Option A: Via Iris Voice Commands**

```
"Generate a 3D model from ~/Desktop/my-image.jpg"
"Create a 3D model of the image at /path/to/photo.png with prompt: high quality, detailed"
"Check 3D generation status"
```

### **Option B: Direct Python**

```bash
# Simple generation
python3 scripts/dreamgaussian-gen.py ~/Desktop/image.jpg

# With quality prompt
python3 scripts/dreamgaussian-gen.py ~/Desktop/image.jpg \
  --prompt "High quality, detailed 3D model, professional textures, studio lighting"

# Custom output directory
python3 scripts/dreamgaussian-gen.py ~/Desktop/image.jpg \
  --output ~/Desktop/my-models
```

### **Option C: Via Node.js (Internal)**

The tool is registered in Iris's tool system:

```javascript
// In any Iris context
iris.tools.execute('generate_3d_model', {
  image_path: '/path/to/image.jpg',
  prompt: 'High quality 3D model',
  output_dir: '~/Desktop/iris-3d-models/'
})
```

---

## Output Files

Generated models are saved to `~/Desktop/iris-3d-models/` by default:

```
iris-3d-models/
├── model.glb           # ✓ Main 3D model (import into Three.js, Babylon.js, etc)
├── model.ply           # Gaussian splat (for advanced uses)
└── preview.png         # Thumbnail preview
```

### **Using the GLB in Projects**

```javascript
// Three.js example
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('model.glb', (gltf) => {
  scene.add(gltf.scene);
});
```

---

## Quality Settings

### **Speed vs Quality Tradeoff**

**Edit `scripts/dreamgaussian-gen.py`** to adjust:

```python
gaussian_result = model.generate(
    num_steps=50,         # ← Increase to 100+ for higher quality (slower)
    guidance_scale=7.5,   # ← Increase to 10-15 for stronger prompt adherence
    seed=42               # ← Change for different results
)
```

### **Optimization Tips**

1. **Better Prompts** = Better Results:
   ```
   "Ultra-detailed, photorealistic 3D model, professional quality,
    high resolution textures, clean geometry, studio lighting, 8K"
   ```

2. **Input Image Quality**:
   - Use well-lit, high-resolution photos
   - Avoid blurry or overexposed images
   - Clear subject in focus works best

3. **VRAM Management**:
   - Model requires ~10GB VRAM
   - Close other GPU apps before running
   - Monitor with: `nvidia-smi -l 1` (refresh every 1s)

---

## Troubleshooting

### **"CUDA not available"**
```bash
# Install CUDA 11.8
# macOS: Not supported (use CPU, but very slow)
# Linux/Windows: Download from nvidia.com

# Reinstall PyTorch with correct CUDA
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 --force-reinstall
```

### **"Out of memory"**
```bash
# Reduce batch size in dreamgaussian-gen.py
# Or upgrade GPU (RTX 3060 Ti minimum recommended, RTX 4080 ideal)
```

### **"Generation takes too long"**
- This is normal! First generation downloads models (~10GB)
- Subsequent generations are faster (~5-10 min)
- Monitor with: `nvidia-smi`

### **"Model quality is poor"**
- Improve input image (clear, well-lit)
- Add quality prompt (see "Quality Settings" above)
- Increase `num_steps` to 100+

---

## Integration with Iris-chan

The tool is fully integrated:

1. ✅ Registered in `src/main/tools/3d-gen.js`
2. ✅ Tool declarations in `src/renderer/gemini/tool-declarations.js`
3. ✅ Callable via voice commands
4. ✅ Hot-reload compatible (no restart needed after script edits)

### **To call from Iris system:**

```javascript
// In pipeline or anywhere with tool access
const result = await window.electronAPI.executeTool('generate_3d_model', {
  image_path: '/path/to/image.jpg',
  prompt: 'High quality, detailed 3D model'
});

console.log(result);
// { ok: true, glb_path: '...', ply_path: '...', preview_path: '...' }
```

---

## Advanced: Alternative Models

### **Faster Alternative: Instant3D**
- ⚡ 30 seconds per image
- ⭐⭐⭐ Moderate quality
- 📦 Lighter requirements

### **Higher Quality: Zero-1-to-3 + NeRF**
- ⭐⭐⭐⭐⭐ Excellent quality
- ⏱️ 15-20 minutes per image
- 💾 12GB+ VRAM required

To switch models, modify `scripts/dreamgaussian-gen.py` imports and pipeline setup.

---

## Next Steps

1. ✅ Install dependencies: `pip install -r requirements-3d.txt`
2. ✅ Install DreamGaussian: `pip install git+https://github.com/dreamgaussian/dreamgaussian.git`
3. ✅ Test: `python3 -c "import dreamer_gaussian; print('OK')"`
4. ✅ Restart Iris: `pkill -f Electron; sleep 1; npx electron . &`
5. ✅ Try voice command: "Generate a 3D model from [image path]"

**Enjoy high-quality 3D generation! 🚀**
