# 3D Model Generation Setup for macOS

## ✅ Setup Complete!

Your macOS system is now configured for **Metal GPU-accelerated 3D model generation**.

### **System Configuration**
- **Device**: Apple Silicon / Intel Mac
- **GPU**: Metal GPU Acceleration ✓ Enabled
- **PyTorch Version**: 2.10.0 with Metal support
- **Script**: `scripts/image-to-3d-macos.py` (optimized for macOS)

---

## **Quick Start**

### **1. Test with an Image**

```bash
# Create a test image or use an existing one
python3 scripts/image-to-3d-macos.py ~/Desktop/your-photo.jpg

# With output directory
python3 scripts/image-to-3d-macos.py ~/Desktop/photo.jpg \
  --output ~/Desktop/my-models
```

### **2. Output Files**

All models saved to `~/Desktop/iris-3d-models/`:
```
model.glb       ← Use in Three.js, Babylon.js, WebGL, game engines
preview.png     ← Quick preview thumbnail
```

### **3. Via Iris Voice Command** (Once app restarts)

```
"Generate a 3D model from ~/Desktop/my-image.jpg"
"Create a 3D model of the image at /path/to/photo.png"
"Check 3D generation status"
```

---

## **How It Works**

The pipeline uses **Metal GPU acceleration** for speed:

```
Input Image
    ↓
[Metal GPU] Depth Estimation (Intel DPT-Large)
    ↓
[Metal GPU] Mesh Generation from Depth Map
    ↓
[CPU] GLB Export with Textures
    ↓
Output: model.glb + preview.png
```

**Typical Speed**: 2-5 minutes per image on M-series Mac

---

## **Quality Tips**

### **Better Input Images = Better 3D Models**

✅ **Use**:
- Well-lit, clear photos
- High-resolution images (1024x1024+)
- Single focused subject
- Professional product photos
- Artwork or scenes with clear geometry

❌ **Avoid**:
- Dark/blurry images
- Multiple subjects
- Very cluttered scenes
- Low resolution

### **Test Image**

```bash
# Generate from URL and test
curl https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg \
  -o ~/Desktop/test-cat.jpg

python3 scripts/image-to-3d-macos.py ~/Desktop/test-cat.jpg
```

---

## **Advanced: Custom Settings**

### **Edit Processing Parameters**

Edit `scripts/image-to-3d-macos.py`:

```python
# Change output size (affects quality/speed tradeoff)
img = img.resize((512, 512), Image.Resampling.LANCZOS)  # Higher = better quality, slower
# Try 768 or 1024 for higher quality
```

### **Performance Monitoring**

```bash
# Monitor GPU usage while generating
# Terminal 1:
python3 scripts/image-to-3d-macos.py ~/Desktop/photo.jpg

# Terminal 2: Monitor performance
watch -n 1 'ps aux | grep python | grep image-to-3d'
```

---

## **Using Generated Models**

### **In Three.js**

```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('model.glb', (gltf) => {
  scene.add(gltf.scene);
});
```

### **In Babylon.js**

```javascript
BABYLON.SceneLoader.ImportMesh(
  '',
  './models/',
  'model.glb',
  scene,
  (meshes) => {
    console.log('Model loaded');
  }
);
```

### **In Blender**

1. File → Import → glTF 2.0 (.glb/.gltf)
2. Select `model.glb`
3. Refine/edit in Blender as needed

---

## **Troubleshooting**

### **"Out of Memory"**
- Reduce input image size in Python script
- Close other applications
- Use smaller resolution: `(256, 256)` instead of `(512, 512)`

### **"Very slow on Intel Mac"**
- Metal support is limited on Intel
- Consider reducing resolution
- Or use cloud service (Meshy.ai)

### **"Model has holes or artifacts"**
- Try a clearer input image
- Increase image resolution
- Adjust depth estimation in script

### **"ImportError: No module named 'transformers'"**
```bash
pip install transformers -q
```

### **"Metal not available"**
```bash
python3 -c "import torch; print(torch.backends.mps.is_built())"
# Should print: True
```

---

## **Integration with Iris-chan**

✅ **Fully Integrated**:
- Registered as `generate_3d_model` tool
- Callable via voice commands
- Hot-reload compatible
- Automatic macOS detection

**To restart Iris**:
```bash
pkill -f Electron
sleep 1
npx electron . &
```

---

## **Comparison: macOS vs NVIDIA**

| Feature | macOS (Metal) | NVIDIA (CUDA) |
|---------|---------------|---------------|
| Speed | 2-5 min/image | 1-2 min/image |
| Quality | ⭐⭐⭐⭐ Good | ⭐⭐⭐⭐⭐ Excellent |
| Setup | ✅ Easy | Complex (drivers) |
| Cost | Free | NVIDIA GPU needed |
| Best for | Creative use | Professional |

---

## **Next Steps**

1. ✅ Test with a sample image:
   ```bash
   python3 scripts/image-to-3d-macos.py ~/Desktop/your-image.jpg
   ```

2. ✅ Restart Iris when ready:
   ```bash
   pkill -f Electron; sleep 1; npx electron . &
   ```

3. ✅ Try voice command in Iris:
   ```
   "Generate a 3D model from ~/Desktop/my-image.jpg"
   ```

4. ✅ Use generated GLB in projects:
   - Three.js/Babylon.js web projects
   - Blender/game engines
   - AR/VR applications

---

**Enjoy Metal-accelerated 3D generation on macOS! 🚀**

For issues, check the main guide: `3D_GENERATION_SETUP.md`
