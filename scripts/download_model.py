"""
Download pre-trained PilotNet weights from HuggingFace

This script downloads the pre-trained model weights trained on CARLA data.
The model was trained on 59.6k examples from the CARLA simulator.
"""
from huggingface_hub import hf_hub_download
import os

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


if __name__ == "__main__":
    download_pilotnet_weights()
