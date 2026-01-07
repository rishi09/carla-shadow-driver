"""
Inspect model weights to understand architecture
"""
import torch

weights_path = "models/pilotnet_carla.pth"
state_dict = torch.load(weights_path, map_location='cpu')

print("Model Architecture from Weights:")
print("=" * 50)

for key, value in state_dict.items():
    print(f"{key:30s} {str(value.shape):20s}")

print("\n" + "=" * 50)
print(f"Total parameters: {len(state_dict)}")
