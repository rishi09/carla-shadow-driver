"""
Frame Encoder - JPEG encoding with quality/resolution control
"""
import cv2
import numpy as np
from typing import Optional, Tuple


class FrameEncoder:
    """Encodes frames to JPEG for WebSocket transmission."""

    def __init__(self, quality: int = 70, max_width: int = 1280, max_height: int = 720):
        self.quality = quality
        self.max_width = max_width
        self.max_height = max_height
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]

    def encode(self, frame: np.ndarray) -> Optional[bytes]:
        """Encode RGB frame to JPEG bytes."""
        if frame is None:
            return None

        # Resize if needed
        h, w = frame.shape[:2]
        if w > self.max_width or h > self.max_height:
            scale = min(self.max_width / w, self.max_height / h)
            new_w = int(w * scale)
            new_h = int(h * scale)
            frame = cv2.resize(frame, (new_w, new_h))

        # Convert RGB to BGR for OpenCV
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        # Encode to JPEG
        success, encoded = cv2.imencode('.jpg', bgr, self.encode_params)
        if not success:
            return None

        return encoded.tobytes()

    def set_quality(self, quality: int):
        """Update JPEG quality (1-100)."""
        self.quality = max(1, min(100, quality))
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

    def get_quality(self) -> int:
        """Return current JPEG quality (1-100)."""
        return self.quality

    def set_resolution(self, width: int, height: int):
        """Update max resolution."""
        self.max_width = width
        self.max_height = height
