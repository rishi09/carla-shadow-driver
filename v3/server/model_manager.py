"""
Flexible Model Manager - Swap between different driving models
Supports: PilotNet, CARLAPilotNet, Alpamayo
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
        pass

    @abstractmethod
    def load_weights(self, weights_path: str):
        pass

    @abstractmethod
    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        pass

    @abstractmethod
    def postprocess(self, output: torch.Tensor) -> Dict:
        pass

    @torch.no_grad()
    def predict(self, frame: np.ndarray) -> Dict:
        input_tensor = self.preprocess(frame)
        output = self.model(input_tensor)
        return self.postprocess(output)


class PilotNetModel(DrivingModel):
    """NVIDIA PilotNet implementation."""

    def __init__(self, device: str = 'auto'):
        super().__init__(device)
        self.model = self._build_model()

    def _build_model(self) -> nn.Module:
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
        return (66, 200)

    def load_weights(self, weights_path: str):
        try:
            state_dict = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state_dict)
            print(f"Loaded weights from {weights_path}")
        except Exception as e:
            print(f"Warning: Could not load weights - {e}")

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        h, w = frame.shape[:2]
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]
        resized = cv2.resize(cropped, (200, 66))
        normalized = resized.astype(np.float32) / 255.0
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)
        return tensor.unsqueeze(0).to(self.device)

    def postprocess(self, output: torch.Tensor) -> Dict:
        steering = float(torch.tanh(output[0, 0]).cpu())
        return {
            'steering': steering,
            'throttle': 0.6,
            'brake': 0.0,
            'confidence': 0.7,
            'model_name': 'PilotNet'
        }


class CARLAPilotNetModel(DrivingModel):
    """PilotNet variant trained on CARLA data. Outputs [throttle, steering, brake]."""

    def __init__(self, device: str = 'auto'):
        super().__init__(device)
        self.model = self._build_model()

    def _build_model(self) -> nn.Module:
        class CARLAPilotNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.ln_1 = nn.BatchNorm2d(3)
                self.cn_1 = nn.Conv2d(3, 24, kernel_size=5, stride=2)
                self.cn_2 = nn.Conv2d(24, 36, kernel_size=5, stride=2)
                self.cn_3 = nn.Conv2d(36, 48, kernel_size=5, stride=2)
                self.cn_4 = nn.Conv2d(48, 64, kernel_size=3, stride=1)
                self.cn_5 = nn.Conv2d(64, 64, kernel_size=3, stride=1)
                self.fc_1 = nn.Linear(1152, 1164)
                self.fc_2 = nn.Linear(1164, 100)
                self.fc_3 = nn.Linear(100, 50)
                self.fc_4 = nn.Linear(50, 10)
                self.fc_5 = nn.Linear(10, 3)

            def forward(self, x):
                x = self.ln_1(x)
                x = torch.nn.functional.elu(self.cn_1(x))
                x = torch.nn.functional.elu(self.cn_2(x))
                x = torch.nn.functional.elu(self.cn_3(x))
                x = torch.nn.functional.elu(self.cn_4(x))
                x = torch.nn.functional.elu(self.cn_5(x))
                x = x.flatten(start_dim=1)
                x = torch.nn.functional.elu(self.fc_1(x))
                x = torch.nn.functional.elu(self.fc_2(x))
                x = torch.nn.functional.elu(self.fc_3(x))
                x = torch.nn.functional.elu(self.fc_4(x))
                x = self.fc_5(x)
                return x

        model = CARLAPilotNet().to(self.device)
        model.eval()
        return model

    def get_input_size(self) -> Tuple[int, int]:
        return (66, 200)

    def load_weights(self, weights_path: str):
        try:
            state_dict = torch.load(weights_path, map_location=self.device)
            self.model.load_state_dict(state_dict)
            print(f"Loaded CARLA-trained weights from {weights_path}")
        except Exception as e:
            print(f"Warning: Could not load weights - {e}")

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        h, w = frame.shape[:2]
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]
        resized = cv2.resize(cropped, (200, 66))
        normalized = resized.astype(np.float32) / 255.0
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)
        return tensor.unsqueeze(0).to(self.device)

    def postprocess(self, output: torch.Tensor) -> Dict:
        throttle = float(torch.sigmoid(output[0, 0]).cpu())
        steering = float(torch.tanh(output[0, 1]).cpu())
        brake = float(torch.sigmoid(output[0, 2]).cpu())
        return {
            'steering': steering,
            'throttle': throttle,
            'brake': brake,
            'confidence': 0.8,
            'model_name': 'CARLA-PilotNet'
        }


class AlpamayoModel(DrivingModel):
    """NVIDIA Alpamayo-R1-10B Vision-Language-Action model."""

    def __init__(self, device: str = 'auto'):
        super().__init__(device)
        self.model = None
        self.processor = None

    def _load_model(self):
        if self.model is not None:
            return
        try:
            from transformers import AutoModelForCausalLM, AutoProcessor
            print("Loading Alpamayo-R1-10B...")
            self.model = AutoModelForCausalLM.from_pretrained(
                "nvidia/Alpamayo-R1-10B",
                torch_dtype=torch.bfloat16,
                device_map="auto",
                trust_remote_code=True
            )
            self.processor = AutoProcessor.from_pretrained(
                "nvidia/Alpamayo-R1-10B",
                trust_remote_code=True
            )
            print("Alpamayo-R1-10B loaded successfully")
        except Exception as e:
            print(f"Error loading Alpamayo: {e}")
            raise

    def get_input_size(self) -> Tuple[int, int]:
        return (320, 576)

    def load_weights(self, weights_path: str):
        self._load_model()

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        self._load_model()
        resized = cv2.resize(frame, (576, 320))
        normalized = resized.astype(np.float32) / 255.0
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)
        return tensor.unsqueeze(0).to(self.device)

    def postprocess(self, output: torch.Tensor) -> Dict:
        if hasattr(output, 'trajectory'):
            trajectory = output.trajectory
            first_waypoint = trajectory[0, 0]
            steering = float(first_waypoint[4].cpu())
            throttle = 0.5
            brake = 0.0
        else:
            steering = float(torch.tanh(output[0, 0]).cpu())
            throttle = 0.5
            brake = 0.0
        return {
            'steering': np.clip(steering, -1, 1),
            'throttle': throttle,
            'brake': brake,
            'confidence': 0.9,
            'model_name': 'Alpamayo-R1-10B'
        }


class ModelRegistry:
    """Registry for available models."""
    _models = {
        'pilotnet': PilotNetModel,
        'carla_pilotnet': CARLAPilotNetModel,
        'alpamayo': AlpamayoModel,
    }

    @classmethod
    def get_model(cls, name: str, **kwargs) -> DrivingModel:
        if name not in cls._models:
            raise ValueError(f"Unknown model: {name}. Available: {list(cls._models.keys())}")
        return cls._models[name](**kwargs)

    @classmethod
    def list_models(cls):
        return list(cls._models.keys())


class ModelManager:
    """High-level interface for managing driving models."""

    def __init__(self):
        self.current_model: Optional[DrivingModel] = None
        self.model_name: Optional[str] = None

    def load_model(self, model_name: str, weights: Optional[str] = None,
                   device: str = 'auto') -> bool:
        try:
            print(f"Loading model: {model_name}")
            self.current_model = ModelRegistry.get_model(model_name, device=device)
            self.model_name = model_name
            if weights:
                weights_path = Path(weights)
                if weights_path.exists():
                    self.current_model.load_weights(str(weights_path))
                else:
                    print(f"  Warning: Weights file not found: {weights}")
            print(f"  Status: Ready")
            return True
        except Exception as e:
            print(f"  Error loading model: {e}")
            return False

    def predict(self, frame: np.ndarray) -> Optional[Dict]:
        if self.current_model is None:
            raise RuntimeError("No model loaded. Call load_model() first.")
        return self.current_model.predict(frame)

    def get_model_info(self) -> Dict:
        if self.current_model is None:
            return {'loaded': False}
        return {
            'loaded': True,
            'name': self.model_name,
            'input_size': self.current_model.get_input_size(),
            'device': str(self.current_model.device)
        }
