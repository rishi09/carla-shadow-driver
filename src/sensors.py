"""
Sensors - Camera image processing and sensor data handling
"""
import numpy as np
import queue
import threading
from typing import Optional, Callable
import cv2


class CameraManager:
    """Manages camera sensor data with thread-safe frame buffer."""

    def __init__(self, max_buffer_size: int = 5):
        self.frame_queue = queue.Queue(maxsize=max_buffer_size)
        self.latest_frame: Optional[np.ndarray] = None
        self.frame_count = 0
        self.lock = threading.Lock()

    def process_image(self, carla_image) -> np.ndarray:
        """Convert CARLA image to numpy array (RGB)."""
        # CARLA gives us BGRA format
        array = np.frombuffer(carla_image.raw_data, dtype=np.uint8)
        array = array.reshape((carla_image.height, carla_image.width, 4))

        # Convert BGRA to RGB
        rgb = array[:, :, :3][:, :, ::-1].copy()

        return rgb

    def on_image(self, carla_image):
        """Callback for CARLA camera sensor."""
        frame = self.process_image(carla_image)

        with self.lock:
            self.latest_frame = frame
            self.frame_count += 1

        # Non-blocking queue update
        try:
            self.frame_queue.put_nowait({
                'frame': frame,
                'timestamp': carla_image.timestamp,
                'frame_number': carla_image.frame
            })
        except queue.Full:
            # Drop oldest frame if buffer is full
            try:
                self.frame_queue.get_nowait()
                self.frame_queue.put_nowait({
                    'frame': frame,
                    'timestamp': carla_image.timestamp,
                    'frame_number': carla_image.frame
                })
            except:
                pass

    def get_latest_frame(self) -> Optional[np.ndarray]:
        """Get the most recent frame (non-blocking)."""
        with self.lock:
            return self.latest_frame.copy() if self.latest_frame is not None else None

    def get_frame(self, timeout: float = 0.1) -> Optional[dict]:
        """Get frame from queue (blocking with timeout)."""
        try:
            return self.frame_queue.get(timeout=timeout)
        except queue.Empty:
            return None


def preprocess_for_model(frame: np.ndarray, target_size: tuple = (66, 200)) -> np.ndarray:
    """
    Preprocess frame for PilotNet model.

    PilotNet expects:
    - RGB image
    - Size: 66 x 200 (height x width)
    - Normalized to [0, 1] or [-1, 1]
    - Cropped to remove sky
    """
    h, w = frame.shape[:2]

    # Crop top portion (sky) - keep bottom 2/3
    crop_top = int(h * 0.35)
    cropped = frame[crop_top:, :]

    # Resize to model input size
    resized = cv2.resize(cropped, (target_size[1], target_size[0]))

    # Normalize to [0, 1]
    normalized = resized.astype(np.float32) / 255.0

    return normalized


def draw_steering_indicator(frame: np.ndarray, human_steer: float,
                            ai_steer: Optional[float] = None) -> np.ndarray:
    """
    Draw steering indicator overlay on frame.

    Args:
        frame: RGB image
        human_steer: Current human steering input [-1, 1]
        ai_steer: AI suggested steering [-1, 1] (optional)
    """
    output = frame.copy()
    h, w = frame.shape[:2]

    # Steering indicator at bottom center
    center_x = w // 2
    center_y = h - 60
    radius = 50

    # Draw background circle
    cv2.circle(output, (center_x, center_y), radius, (50, 50, 50), -1)
    cv2.circle(output, (center_x, center_y), radius, (100, 100, 100), 2)

    # Draw center line
    cv2.line(output, (center_x, center_y - radius + 5),
             (center_x, center_y + radius - 5), (100, 100, 100), 1)

    # Draw AI suggestion (blue line) - behind human
    if ai_steer is not None:
        ai_angle = ai_steer * 60  # Convert to degrees
        ai_x = int(center_x + radius * 0.8 * np.sin(np.radians(ai_angle)))
        ai_y = int(center_y - radius * 0.8 * np.cos(np.radians(ai_angle)))
        cv2.line(output, (center_x, center_y), (ai_x, ai_y), (255, 100, 0), 4)

    # Draw human steering (green line) - on top
    human_angle = human_steer * 60
    human_x = int(center_x + radius * 0.8 * np.sin(np.radians(human_angle)))
    human_y = int(center_y - radius * 0.8 * np.cos(np.radians(human_angle)))
    cv2.line(output, (center_x, center_y), (human_x, human_y), (0, 255, 0), 3)

    # Labels
    cv2.putText(output, "Human", (center_x - 70, center_y + radius + 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
    if ai_steer is not None:
        cv2.putText(output, "AI", (center_x + 30, center_y + radius + 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 100, 0), 1)

    return output
