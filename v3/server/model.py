"""
PilotNet Model - NVIDIA's end-to-end driving network
Architecture based on: https://arxiv.org/abs/1604.07316
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Optional, Tuple
import yaml


class PilotNet(nn.Module):
    """NVIDIA PilotNet architecture for end-to-end steering prediction."""

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

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.normalize(x)
        x = F.elu(self.conv1(x))
        x = F.elu(self.conv2(x))
        x = F.elu(self.conv3(x))
        x = F.elu(self.conv4(x))
        x = F.elu(self.conv5(x))
        x = x.view(x.size(0), -1)
        x = self.dropout(F.elu(self.fc1(x)))
        x = self.dropout(F.elu(self.fc2(x)))
        x = F.elu(self.fc3(x))
        x = self.fc4(x)
        return x


class SteeringPredictor:
    """Wrapper for PilotNet inference with preprocessing."""

    def __init__(self, config_path: str = "configs/race.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)['model']
        self.device = self._get_device()
        self.model = self._load_model()
        self.input_size = tuple(self.config['input_size'])

    def _get_device(self) -> torch.device:
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
        model = PilotNet()
        weights_path = self.config.get('weights_path')
        if weights_path:
            try:
                state_dict = torch.load(weights_path, map_location=self.device)
                model.load_state_dict(state_dict)
                print(f"Loaded model weights from {weights_path}")
            except FileNotFoundError:
                print(f"No weights found at {weights_path}, using random initialization")
        model = model.to(self.device)
        model.eval()
        return model

    def preprocess(self, frame: np.ndarray) -> torch.Tensor:
        import cv2
        h, w = frame.shape[:2]
        crop_top = int(h * 0.35)
        cropped = frame[crop_top:, :]
        resized = cv2.resize(cropped, (self.input_size[1], self.input_size[0]))
        normalized = resized.astype(np.float32) / 255.0
        tensor = torch.from_numpy(normalized).permute(2, 0, 1)
        return tensor.unsqueeze(0).to(self.device)

    @torch.no_grad()
    def predict(self, frame: np.ndarray) -> dict:
        input_tensor = self.preprocess(frame)
        output = self.model(input_tensor)
        steering = float(torch.tanh(output[0, 0]).cpu())
        return {
            'steering': steering,
            'confidence': 0.5,
            'raw_output': float(output[0, 0].cpu())
        }
