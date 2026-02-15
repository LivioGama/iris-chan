#!/usr/bin/env python3
"""
DreamGaussian 3D model generator for Iris-chan
Converts images to high-quality GLB files using local diffusion models
"""

import argparse
import json
import sys
import torch
import numpy as np
from pathlib import Path
from PIL import Image
import traceback

# Check CUDA availability
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {DEVICE}", file=sys.stderr)

def load_image(image_path: str) -> Image.Image:
    """Load and validate image"""
    img = Image.open(image_path).convert("RGBA")
    print(f"Loaded image: {image_path} ({img.size})", file=sys.stderr)
    return img

def generate_3d_model(image_path: str, prompt: str = None, output_dir: str = "outputs") -> dict:
    """
    Generate 3D GLB model from image using DreamGaussian

    Args:
        image_path: Path to input image
        prompt: Optional guidance prompt
        output_dir: Output directory for GLB

    Returns:
        dict with status, paths, and metadata
    """

    try:
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True, parents=True)

        # Load image
        image = load_image(image_path)
        image_tensor = torch.from_numpy(np.array(image)).float().to(DEVICE) / 255.0

        print(f"Initializing DreamGaussian pipeline...", file=sys.stderr)

        # Import DreamGaussian (lazy load to avoid memory if not needed)
        try:
            from dreamer_gaussian import DreamGaussian
        except ImportError:
            return {
                "ok": False,
                "error": "DreamGaussian not installed. Run: pip install -r requirements-3d.txt"
            }

        # Initialize model
        model = DreamGaussian(device=DEVICE)

        print(f"Generating 3D model from image (this may take 5-10 minutes)...", file=sys.stderr)

        # Generate 3D (high quality settings)
        gaussian_result = model.generate(
            image=image_tensor,
            prompt=prompt or "High quality 3D model, detailed, professional quality",
            negative_prompt="blurry, low quality, distorted, artifacts",
            num_steps=50,
            guidance_scale=7.5,
            seed=42
        )

        # Save gaussian splat (PLY format)
        ply_path = output_path / "model.ply"
        model.save_gaussian(gaussian_result, str(ply_path))
        print(f"Saved Gaussian splat: {ply_path}", file=sys.stderr)

        # Export to GLB
        glb_path = output_path / "model.glb"
        model.export_to_glb(gaussian_result, str(glb_path))
        print(f"Exported GLB: {glb_path}", file=sys.stderr)

        # Generate thumbnail
        thumb_path = output_path / "preview.png"
        model.save_preview(gaussian_result, str(thumb_path))

        return {
            "ok": True,
            "glb_path": str(glb_path),
            "ply_path": str(ply_path),
            "preview_path": str(thumb_path),
            "message": f"✓ Generated 3D model: {glb_path}"
        }

    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

def main():
    parser = argparse.ArgumentParser(description="Generate 3D GLB from image")
    parser.add_argument("image", help="Input image path")
    parser.add_argument("--prompt", help="Guidance prompt for generation")
    parser.add_argument("--output", default="outputs", help="Output directory")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    result = generate_3d_model(args.image, args.prompt, args.output)

    if args.json:
        print(json.dumps(result))
    else:
        if result["ok"]:
            print(result["message"])
        else:
            print(f"Error: {result['error']}", file=sys.stderr)
            if "traceback" in result:
                print(result["traceback"], file=sys.stderr)

    sys.exit(0 if result["ok"] else 1)

if __name__ == "__main__":
    main()
