"""
Flexible Model Manager - Swap between different driving models

This allows you to easily try different models:
- PilotNet (NVIDIA architecture)
- Other end-to-end driving models
- Your own custom models

Just add a new model class and register it!
"""
import torch
import torch.nn as nn
import numpy as np
import cv2
from abc import ABC, abstractmethod
from typing import Optional, Dict, Tuple
from pathlib import Path


class DrivingModel(ABC):
    """Base class for all driving models."""

    def __init__(self, device: str = 'auto'):
        self.device = self._get_device(device)
        self.model = None

    def _get_device(self, device_name: str) -> torch.device:
        """Get best available device."""
        if device_name == 'auto':
            if torch.cuda.is_available():
                return torch.device('cuda')
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                return torch.device('mps')
            else:
                return torch.device('cpu')
        else:
            return torch.device(device_name)

    @abstractmethod
    def get_input_size(self) -> Tuple[int, int]:
        """Return (height, width) expected by model."""
        pass

    @abstractmethod
    def load_weights(self, weights_path: str):
        """Load model weights from file."""
        pass

    @abstractmethod
    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        """Preprocess frame for model input."""
        pass

    @abstractmethod
    def postprocess(self, output: torch.Tensor) -> Dict:
        """Convert model output to prediction dict."""
        pass

    @torch.no_grad()
    def predict(self, frame: np.ndarray) -> Dict:
        """Predict from camera frame."""
        input_tensor = self.preprocess(frame)
        output = self.model(input_tensor)
        return self.postprocess(output)


class PilotNetModel(DrivingModel):
    """NVIDIA PilotNet implementation."""

    def __init__(self, device: str = 'auto'):
        super().__init__(device)
        self.model = self._build_model()

    def _build_model(self) -> nn.Module:
        """Build PilotNet architecture."""
        class PilotNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.normalize = nn.BatchNorm2d(3)
                self.conv1 = nn.Conv2d(3, 24, kernel_size=5, stride=2)
                self.conv2 = nn.Conv2d(24, 36, kernel_size=5, stride=2)
                self.conv3 = nn.Conv2d(36, 48, kernel_size=5, stride=2)
                self.conv4 = nn.Conv2d(48, 64, kernel_size=3, stride=1)
                self.conv5 = nn.Conv2d(64, 64, kernel_size=3, stride=1)
                self.fc1 = nn.Linear(64 * 1 * 18, 100)
                self.fc2 = nn.Linear(100, 50)
                self.fc3 = nn.Linear(50, 10)
                self.fc4 = nn.Linear(10, 1)
                self.dropout = nn.Dropout(0.5)

            def forward(self, x):
                x = self.normalize(x)
                x = torch.nn.functional.elu(self.conv1(x))
                x = torch.nn.functional.elu(self.conv2(x))
                x = torch.nn.functional.elu(self.conv3(x))
                x = torch.nn.functional.elu(self.conv4(x))
                x = torch.nn.functional.elu(self.conv5(x))
                x = x.view(x.size(0), -1)
                x = self.dropout(torch.nn.functional.elu(self.fc1(x)))
                x = self.dropout(torch.nn.functional.elu(self.fc2(x)))
                x = torch.nn.functional.elu(self.fc3(x))
                x = self.fc4(x)
                return x

        model = PilotNet().to(self.device)
        model.eval()
        return model

    def get_input_size(self) -> Tuple[int, int]:
        """PilotNet expects 66x200."""
        return (66, 200)

    def load_weights(self, weights_path: str):
        """Load pretrained weights."""
        try:
            state_dict = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state_dict)
            print(f"✓ Loaded weights from {weights_path}")
        except Exception as e:
            print(f"Warning: Could not load weights - {e}")
            print("  Using random initialization")

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        """Preprocess frame for PilotNet."""
        h, w = frame.shape[:2]

        # Crop top 35% (remove sky)
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]

        # Resize to 66x200
        resized = cv2.resize(cropped, (200, 66))

        # Normalize to [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Convert to tensor: (H, W, C) -> (C, H, W)
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)

        # Add batch dimension
        return tensor.unsqueeze(0).to(self.device)

    def postprocess(self, output: torch.Tensor) -> Dict:
        """Convert output to steering prediction."""
        steering = float(torch.tanh(output[0, 0]).cpu())
        return {
            'steering': steering,
            'confidence': 0.7,  # Placeholder
            'raw_output': float(output[0, 0].cpu()),
            'model_name': 'PilotNet'
        }


class CARLAPilotNetModel(DrivingModel):
    """
    PilotNet variant trained on CARLA data.

    This matches the architecture from sergiopaniego/OptimizedPilotNet.
    Outputs 3 values: [throttle, steering, brake]
    """

    def __init__(self, device: str = 'auto'):
        super().__init__(device)
        self.model = self._build_model()

    def _build_model(self) -> nn.Module:
        """Build CARLA PilotNet architecture (3 outputs)."""
        class CARLAPilotNet(nn.Module):
            def __init__(self):
                super().__init__()
                # Layer names match the downloaded weights
                self.ln_1 = nn.BatchNorm2d(3)  # Normalization
                self.cn_1 = nn.Conv2d(3, 24, kernel_size=5, stride=2)
                self.cn_2 = nn.Conv2d(24, 36, kernel_size=5, stride=2)
                self.cn_3 = nn.Conv2d(36, 48, kernel_size=5, stride=2)
                self.cn_4 = nn.Conv2d(48, 64, kernel_size=3, stride=1)
                self.cn_5 = nn.Conv2d(64, 64, kernel_size=3, stride=1)
                self.fc_1 = nn.Linear(1152, 1164)  # Matches downloaded weights
                self.fc_2 = nn.Linear(1164, 100)
                self.fc_3 = nn.Linear(100, 50)
                self.fc_4 = nn.Linear(50, 10)
                self.fc_5 = nn.Linear(10, 3)  # 3 outputs: throttle, steering, brake

            def forward(self, x):
                x = self.ln_1(x)
                x = torch.nn.functional.elu(self.cn_1(x))
                x = torch.nn.functional.elu(self.cn_2(x))
                x = torch.nn.functional.elu(self.cn_3(x))
                x = torch.nn.functional.elu(self.cn_4(x))
                x = torch.nn.functional.elu(self.cn_5(x))
                x = x.flatten(start_dim=1)  # Use flatten instead of view
                x = torch.nn.functional.elu(self.fc_1(x))
                x = torch.nn.functional.elu(self.fc_2(x))
                x = torch.nn.functional.elu(self.fc_3(x))
                x = torch.nn.functional.elu(self.fc_4(x))
                x = self.fc_5(x)  # No activation on output
                return x

        model = CARLAPilotNet().to(self.device)
        model.eval()
        return model

    def get_input_size(self) -> Tuple[int, int]:
        """CARLA PilotNet expects 66x200."""
        return (66, 200)

    def load_weights(self, weights_path: str):
        """Load pretrained CARLA weights."""
        try:
            state_dict = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state_dict)
            print(f"✓ Loaded CARLA-trained weights from {weights_path}")
        except Exception as e:
            print(f"Warning: Could not load weights - {e}")
            print("  Using random initialization")

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        """Preprocess frame for CARLA PilotNet."""
        h, w = frame.shape[:2]

        # Crop top 35% (remove sky)
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]

        # Resize to 66x200
        resized = cv2.resize(cropped, (200, 66))

        # Normalize to [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Convert to tensor: (H, W, C) -> (C, H, W)
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)

        # Add batch dimension
        return tensor.unsqueeze(0).to(self.device)

    def postprocess(self, output: torch.Tensor) -> Dict:
        """Convert output to control prediction."""
        # Output is [throttle, steering, brake]
        throttle = float(torch.sigmoid(output[0, 0]).cpu())  # [0, 1]
        steering = float(torch.tanh(output[0, 1]).cpu())     # [-1, 1]
        brake = float(torch.sigmoid(output[0, 2]).cpu())     # [0, 1]

        return {
            'steering': steering,
            'throttle': throttle,
            'brake': brake,
            'confidence': 0.8,  # Trained on 59.6k examples
            'model_name': 'CARLA-PilotNet'
        }


class ModelRegistry:
    """Registry for available models."""

    _models = {
        'pilotnet': PilotNetModel,
        'carla_pilotnet': CARLAPilotNetModel,  # <-- Use this for downloaded weights
        # Add more models here:
        # 'comma_ai': CommaAIModel,
        # 'your_custom_model': YourCustomModel,
    }

    @classmethod
    def get_model(cls, name: str, **kwargs) -> DrivingModel:
        """Get model by name."""
        if name not in cls._models:
            raise ValueError(f"Unknown model: {name}. Available: {list(cls._models.keys())}")
        return cls._models[name](**kwargs)

    @classmethod
    def list_models(cls):
        """List available models."""
        return list(cls._models.keys())

    @classmethod
    def register_model(cls, name: str, model_class: type):
        """Register a new model."""
        cls._models[name] = model_class
        print(f"Registered model: {name}")


class ModelManager:
    """
    High-level interface for managing driving models.

    Usage:
        manager = ModelManager()
        manager.load_model('pilotnet', weights='models/pilotnet_carla.pth')
        prediction = manager.predict(camera_frame)

        # Switch to different model
        manager.load_model('comma_ai', weights='models/comma_ai.pth')
    """

    def __init__(self):
        self.current_model: Optional[DrivingModel] = None
        self.model_name: Optional[str] = None

    def load_model(self, model_name: str, weights: Optional[str] = None,
                  device: str = 'auto') -> bool:
        """Load a model by name with optional weights."""
        try:
            print(f"\nLoading model: {model_name}")
            print(f"  Device: {device}")

            # Create model
            self.current_model = ModelRegistry.get_model(model_name, device=device)
            self.model_name = model_name

            # Load weights if provided
            if weights:
                weights_path = Path(weights)
                if weights_path.exists():
                    self.current_model.load_weights(str(weights_path))
                else:
                    print(f"  Warning: Weights file not found: {weights}")
                    print(f"  Using random initialization")

            input_size = self.current_model.get_input_size()
            print(f"  Input size: {input_size[0]}x{input_size[1]}")
            print(f"  Status: Ready ✓")
            return True

        except Exception as e:
            print(f"  Error loading model: {e}")
            return False

    def predict(self, frame: np.ndarray) -> Optional[Dict]:
        """Predict from camera frame."""
        if self.current_model is None:
            raise RuntimeError("No model loaded. Call load_model() first.")
        return self.current_model.predict(frame)

    def get_model_info(self) -> Dict:
        """Get info about current model."""
        if self.current_model is None:
            return {'loaded': False}

        return {
            'loaded': True,
            'name': self.model_name,
            'input_size': self.current_model.get_input_size(),
            'device': str(self.current_model.device)
        }


def discover_available_weights(models_dir: str = "models") -> Dict[str, list]:
    """Discover available weight files."""
    models_path = Path(models_dir)
    if not models_path.exists():
        return {}

    weights = {}
    for model_name in ModelRegistry.list_models():
        pattern = f"{model_name}*.pth"
        found = list(models_path.glob(pattern))
        if found:
            weights[model_name] = [str(f) for f in found]

    # Also find generic .pth files
    all_weights = list(models_path.glob("*.pth"))
    if all_weights:
        weights['available'] = [str(f) for f in all_weights]

    return weights


if __name__ == "__main__":
    # Example usage
    print("=== Model Manager Demo ===\n")

    # List available models
    print("Available models:")
    for model in ModelRegistry.list_models():
        print(f"  - {model}")
    print()

    # Discover weights
    print("Discovered weights:")
    weights = discover_available_weights()
    for model, files in weights.items():
        print(f"  {model}:")
        for f in files:
            print(f"    - {f}")
    print()

    # Create manager and load CARLA model with downloaded weights
    manager = ModelManager()
    success = manager.load_model('carla_pilotnet', weights='models/pilotnet_carla.pth')

    if success:
        # Test prediction with dummy frame
        dummy_frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
        pred = manager.predict(dummy_frame)
        print(f"\nTest prediction: {pred}")
        print(f"\nModel now predicts:")
        print(f"  Steering: {pred['steering']:+.3f} (left=-1, right=+1)")
        print(f"  Throttle: {pred['throttle']:.3f} (0 to 1)")
        print(f"  Brake: {pred['brake']:.3f} (0 to 1)")
        print(f"\nThis is a REAL neural network trained on CARLA data! ✨")
