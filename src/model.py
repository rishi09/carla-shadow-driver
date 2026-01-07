"""
PilotNet Model - NVIDIA's end-to-end driving network

Architecture based on: https://arxiv.org/abs/1604.07316
"End to End Learning for Self-Driving Cars"

Input: RGB image (66 x 200 x 3)
Output: Steering angle prediction
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple
import yaml


class PilotNet(nn.Module):
    """
    NVIDIA PilotNet architecture for end-to-end steering prediction.

    The network learns to map raw camera images directly to steering commands.
    """

    def __init__(self):
        super().__init__()

        # Normalization layer
        self.normalize = nn.BatchNorm2d(3)

        # Convolutional layers (feature extraction)
        self.conv1 = nn.Conv2d(3, 24, kernel_size=5, stride=2)
        self.conv2 = nn.Conv2d(24, 36, kernel_size=5, stride=2)
        self.conv3 = nn.Conv2d(36, 48, kernel_size=5, stride=2)
        self.conv4 = nn.Conv2d(48, 64, kernel_size=3, stride=1)
        self.conv5 = nn.Conv2d(64, 64, kernel_size=3, stride=1)

        # Fully connected layers (decision making)
        self.fc1 = nn.Linear(64 * 1 * 18, 100)
        self.fc2 = nn.Linear(100, 50)
        self.fc3 = nn.Linear(50, 10)
        self.fc4 = nn.Linear(10, 1)

        # Dropout for regularization
        self.dropout = nn.Dropout(0.5)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.

        Args:
            x: Input tensor of shape (batch, 3, 66, 200)

        Returns:
            Steering prediction of shape (batch, 1)
        """
        # Normalize input
        x = self.normalize(x)

        # Convolutional feature extraction
        x = F.elu(self.conv1(x))
        x = F.elu(self.conv2(x))
        x = F.elu(self.conv3(x))
        x = F.elu(self.conv4(x))
        x = F.elu(self.conv5(x))

        # Flatten
        x = x.view(x.size(0), -1)

        # Fully connected layers
        x = self.dropout(F.elu(self.fc1(x)))
        x = self.dropout(F.elu(self.fc2(x)))
        x = F.elu(self.fc3(x))
        x = self.fc4(x)

        return x


class SteeringPredictor:
    """
    Wrapper for PilotNet inference with preprocessing.
    """

    def __init__(self, config_path: str = "configs/default.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)['model']

        self.device = self._get_device()
        self.model = self._load_model()
        self.input_size = tuple(self.config['input_size'])  # (66, 200)

    def _get_device(self) -> torch.device:
        """Get best available device."""
        device_name = self.config.get('device', 'auto')

        if device_name == 'auto':
            if torch.cuda.is_available():
                return torch.device('cuda')
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                return torch.device('mps')
            else:
                return torch.device('cpu')
        else:
            return torch.device(device_name)

    def _load_model(self) -> PilotNet:
        """Load model with optional pretrained weights."""
        model = PilotNet()

        weights_path = self.config.get('weights_path')
        if weights_path:
            try:
                state_dict = torch.load(weights_path, map_location=self.device)
                model.load_state_dict(state_dict)
                print(f"Loaded model weights from {weights_path}")
            except FileNotFoundError:
                print(f"No weights found at {weights_path}, using random initialization")
                print("  (This is expected for first run - model will give random predictions)")

        model = model.to(self.device)
        model.eval()
        return model

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        """
        Preprocess frame for model input.

        Args:
            frame: RGB numpy array of any size

        Returns:
            Tensor of shape (1, 3, 66, 200)
        """
        import cv2

        h, w = frame.shape[:2]

        # Crop top 35% (remove sky)
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]

        # Resize to model input size
        resized = cv2.resize(cropped, (self.input_size[1], self.input_size[0]))

        # Normalize to [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Convert to tensor: (H, W, C) -> (C, H, W)
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)

        # Add batch dimension
        return tensor.unsqueeze(0).to(self.device)

    @torch.no_grad()
    def predict(self, frame: np.ndarray) -> dict:
        """
        Predict steering from camera frame.

        Args:
            frame: RGB numpy array

        Returns:
            Dictionary with 'steering' and 'confidence' keys
        """
        # Preprocess
        input_tensor = self.preprocess(frame)

        # Inference
        output = self.model(input_tensor)

        # Convert to steering value [-1, 1]
        steering = float(torch.tanh(output[0, 0]).cpu())

        return {
            'steering': steering,
            'confidence': 0.5,  # Placeholder - would need uncertainty estimation
            'raw_output': float(output[0, 0].cpu())
        }

    def predict_batch(self, frames: list) -> list:
        """Predict steering for multiple frames."""
        return [self.predict(frame) for frame in frames]


def create_dummy_weights(save_path: str = "models/pilotnet.pt"):
    """Create dummy weights file for testing."""
    import os
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    model = PilotNet()
    torch.save(model.state_dict(), save_path)
    print(f"Created dummy weights at {save_path}")


if __name__ == "__main__":
    # Test the model
    print("Testing PilotNet...")

    # Create predictor
    predictor = SteeringPredictor()

    # Create dummy input
    dummy_frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)

    # Predict
    result = predictor.predict(dummy_frame)
    print(f"Prediction: steering={result['steering']:.3f}")
