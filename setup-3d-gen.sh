#!/bin/bash
# One-command setup for DreamGaussian 3D generation in Iris-chan

set -e

echo "🚀 Setting up DreamGaussian 3D Generation for Iris-chan..."
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Install from python.org"
    exit 1
fi

python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Python $python_version"

if ! command -v nvidia-smi &> /dev/null; then
    echo "⚠️  NVIDIA GPU not detected. 3D generation will be VERY slow."
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    gpu_info=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)
    echo "✓ GPU detected: $gpu_info"
fi

# Install PyTorch with CUDA
echo ""
echo "📦 Installing PyTorch with CUDA support..."
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 -q

# Verify CUDA
cuda_available=$(python3 -c "import torch; print(torch.cuda.is_available())")
if [ "$cuda_available" = "True" ]; then
    echo "✓ CUDA available"
else
    echo "⚠️  CUDA not available (will use CPU - very slow)"
fi

# Install Iris 3D requirements
echo ""
echo "📦 Installing 3D generation dependencies..."
pip install -r requirements-3d.txt -q

# Install DreamGaussian
echo ""
echo "📦 Installing DreamGaussian..."
echo "   (This may take a few minutes...)"
pip install git+https://github.com/dreamgaussian/dreamgaussian.git -q

# Verify installation
echo ""
echo "✓ Testing installation..."
python3 -c "import dreamer_gaussian; print('✓ DreamGaussian verified')" || {
    echo "❌ DreamGaussian installation failed"
    exit 1
}

python3 -c "import torch; print(f'✓ PyTorch {torch.__version__}')"

# Create output directory
mkdir -p ~/Desktop/iris-3d-models
echo "✓ Created output directory: ~/Desktop/iris-3d-models"

echo ""
echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Restart Iris: pkill -f Electron; sleep 1; npx electron . &"
echo "   2. Try voice command: 'Generate a 3D model from /path/to/image.jpg'"
echo "   3. Or run manually: python3 scripts/dreamgaussian-gen.py /path/to/image.jpg"
echo ""
echo "📚 For more info: cat 3D_GENERATION_SETUP.md"
echo ""
