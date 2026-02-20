"""
Frame Encoder - JPEG encoding with adaptive quality/resolution control

Supports latency-driven adaptive streaming: quality and resolution are
adjusted gradually based on round-trip latency reported by the client.
"""
import cv2
import numpy as np
from typing import Optional, Tuple

# Absolute bounds for adaptive quality (never go outside these)
MIN_QUALITY = 25
MAX_QUALITY = 70


class FrameEncoder:
    """Encodes frames to JPEG for WebSocket transmission."""

    def __init__(self, quality: int = 50, max_width: int = 1280, max_height: int = 720):
        self.quality = max(MIN_QUALITY, min(MAX_QUALITY, quality))
        self.max_width = max_width
        self.max_height = max_height
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

        # Target resolution (the "full" resolution we restore to when latency is low)
        self._target_width = max_width
        self._target_height = max_height

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
        """Update JPEG quality (clamped to MIN_QUALITY..MAX_QUALITY)."""
        self.quality = max(MIN_QUALITY, min(MAX_QUALITY, quality))
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

    def get_quality(self) -> int:
        """Return current JPEG quality."""
        return self.quality

    def set_resolution(self, width: int, height: int):
        """Update max resolution."""
        self.max_width = width
        self.max_height = height

    def adapt_quality(self, latency_ms: float, target_latency: float = 80.0):
        """Adjust JPEG quality and resolution based on round-trip latency.

        Changes are gradual (step of +/-5 per call) to avoid oscillation.
        Quality is clamped to [MIN_QUALITY, MAX_QUALITY] (25..70).

        Thresholds:
          >150ms  -> target quality 30, target resolution 960x540
          >100ms  -> target quality 40
          <60ms   -> target quality 50 (if currently below 60)
          <40ms   -> target quality 60, restore resolution to full

        Args:
            latency_ms: Round-trip latency from the client in milliseconds.
            target_latency: Desired target latency (default 80ms, used for docs only).
        """
        old_quality = self.quality
        old_res = (self.max_width, self.max_height)
        step = 5

        if latency_ms > 150:
            # Severe lag: drop quality toward 30 and resolution to 960x540
            target_q = 30
            if self.quality > target_q:
                self.quality = max(target_q, self.quality - step)
            self.max_width = 960
            self.max_height = 540

        elif latency_ms > 100:
            # Moderate lag: drop quality toward 40 (keep current resolution)
            target_q = 40
            if self.quality > target_q:
                self.quality = max(target_q, self.quality - step)

        elif latency_ms < 40:
            # Excellent connection: raise quality toward 60 and restore full resolution
            target_q = 60
            if self.quality < target_q:
                self.quality = min(target_q, self.quality + step)
            self.max_width = self._target_width
            self.max_height = self._target_height

        elif latency_ms < 60:
            # Good connection: raise quality toward 50 if currently low
            target_q = 50
            if self.quality < 60:
                if self.quality < target_q:
                    self.quality = min(target_q, self.quality + step)

        # Clamp to absolute bounds
        self.quality = max(MIN_QUALITY, min(MAX_QUALITY, self.quality))
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

        # Log changes
        new_res = (self.max_width, self.max_height)
        if self.quality != old_quality or new_res != old_res:
            print(f"[adaptive] latency={latency_ms:.0f}ms -> quality {old_quality}->{self.quality}, "
                  f"res {old_res[0]}x{old_res[1]}->{new_res[0]}x{new_res[1]}")
