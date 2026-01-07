"""
Download pre-trained model weights from HuggingFace

Supported models:
- PilotNet (sergiopaniego/OptimizedPilotNet) - 6.4 MB
- Alpamayo (nvidia/Alpamayo-R1-10B) - ~20 GB, requires 24GB+ VRAM
"""
from huggingface_hub import hf_hub_download, snapshot_download
import os
import argparse

def download_pilotnet_weights(output_dir: str = "models"):
    """Download pre-trained PilotNet weights from HuggingFace."""

    os.makedirs(output_dir, exist_ok=True)

    print("Downloading pre-trained PilotNet weights...")
    print("Source: sergiopaniego/OptimizedPilotNet (trained on CARLA)")
    print("Training data: 59.6k examples")
    print("")

    try:
        # Download PyTorch weights
        model_path = hf_hub_download(
            repo_id="sergiopaniego/OptimizedPilotNet",
            filename="pytorch/pilotnet_model.pth",
            local_dir=output_dir,
            local_dir_use_symlinks=False
        )

        # Move to expected location
        import shutil
        final_path = os.path.join(output_dir, "pilotnet_carla.pth")
        shutil.move(model_path, final_path)

        # Clean up pytorch folder
        pytorch_dir = os.path.join(output_dir, "pytorch")
        if os.path.exists(pytorch_dir):
            shutil.rmtree(pytorch_dir)

        print(f"✓ Downloaded to: {final_path}")
        print(f"  Size: {os.path.getsize(final_path) / (1024*1024):.2f} MB")
        print("")
        print("This model is ready to use!")
        print("It will predict steering angles from CARLA camera images.")

        return final_path

    except Exception as e:
        print(f"Error downloading: {e}")
        print("")
        print("Alternative: Train your own model on CARLA data")
        print("  or use random weights for demonstration")
        return None


def download_alpamayo(output_dir: str = "models"):
    """
    Download NVIDIA Alpamayo-R1-10B from HuggingFace.

    WARNING: This model is ~20GB and requires:
    - 24GB+ VRAM (RTX 3090/4090/H100)
    - transformers >= 4.57.1
    - deepspeed >= 0.17.4

    The model will be cached by HuggingFace Hub.
    """
    print("=" * 60)
    print("NVIDIA Alpamayo-R1-10B Download")
    print("=" * 60)
    print("")
    print("Model: nvidia/Alpamayo-R1-10B")
    print("Size: ~20 GB")
    print("Type: Vision-Language-Action (VLA) model")
    print("")
    print("Requirements:")
    print("  - 24GB+ VRAM (RTX 3090, RTX 4090, H100)")
    print("  - transformers >= 4.57.1")
    print("  - deepspeed >= 0.17.4")
    print("")

    alpamayo_dir = os.path.join(output_dir, "alpamayo")
    os.makedirs(alpamayo_dir, exist_ok=True)

    try:
        print("Downloading Alpamayo model files...")
        print("(This may take 10-30 minutes depending on your connection)")
        print("")

        # Download the model
        snapshot_download(
            repo_id="nvidia/Alpamayo-R1-10B",
            local_dir=alpamayo_dir,
            ignore_patterns=["*.md", "*.txt", "*.rst"],
            resume_download=True
        )

        print("")
        print(f"✓ Downloaded to: {alpamayo_dir}")
        print("")
        print("Usage:")
        print("  from src.model_manager import ModelManager")
        print("  manager = ModelManager()")
        print("  manager.load_model('alpamayo')")
        print("")
        print("Note: Model will be loaded from HuggingFace cache by default.")

        return alpamayo_dir

    except Exception as e:
        print(f"Error downloading Alpamayo: {e}")
        print("")
        print("Make sure you have:")
        print("  1. Sufficient disk space (~25GB)")
        print("  2. huggingface_hub installed")
        print("  3. Internet connection")
        return None


def main():
    parser = argparse.ArgumentParser(description="Download driving models from HuggingFace")
    parser.add_argument(
        "model",
        choices=["pilotnet", "alpamayo", "all"],
        default="pilotnet",
        nargs="?",
        help="Model to download (default: pilotnet)"
    )
    parser.add_argument(
        "--output-dir",
        default="models",
        help="Output directory for model files"
    )

    args = parser.parse_args()

    if args.model == "pilotnet":
        download_pilotnet_weights(args.output_dir)
    elif args.model == "alpamayo":
        download_alpamayo(args.output_dir)
    elif args.model == "all":
        download_pilotnet_weights(args.output_dir)
        print("\n" + "=" * 60 + "\n")
        download_alpamayo(args.output_dir)


if __name__ == "__main__":
    main()
