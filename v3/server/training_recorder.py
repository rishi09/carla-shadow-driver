"""
Training Recorder - Records camera frames + player controls for behavioral cloning.

During gameplay, captures downscaled camera frames (200x66, PilotNet input size)
paired with the smoothed player control values (post-ramping steer/throttle/brake).
Uses a ring buffer to cap memory usage (~100MB for 5000 frames).

This module handles DATA COLLECTION only. Training and inference will be added later.
"""
import time
import numpy as np
from typing import Optional, List, Dict, Tuple


class TrainingRecorder:
    """Records camera frames + player controls for behavioral cloning training.

    Captures (frame, control) pairs during gameplay at 10Hz (every 3rd game frame
    from the 30Hz race loop). Frames are downscaled to 200x66 (PilotNet input size).

    Memory budget: 5000 frames * 200 * 66 * 3 bytes = ~198MB worst case.
    In practice, ~100MB with Python object overhead.
    """

    def __init__(self, max_frames: int = 5000, frame_size: Tuple[int, int] = (200, 66)):
        """
        Args:
            max_frames: Ring buffer capacity. 5000 frames at 10Hz = 500 seconds of data.
            frame_size: Target (width, height) for downscaled frames. Default is PilotNet input.
        """
        self.frames: List[np.ndarray] = []  # List of (66, 200, 3) uint8 arrays
        self.controls: List[Dict] = []  # List of control dicts
        self.max_frames = max_frames
        self.frame_size = frame_size  # (width, height)
        self.recording = False
        self.total_recorded = 0

    def start_recording(self):
        """Start recording. Called at race start (after countdown)."""
        self.frames.clear()
        self.controls.clear()
        self.recording = True
        self.total_recorded = 0
        print(f"[training] Recording started (buffer capacity: {self.max_frames} frames, "
              f"target size: {self.frame_size[0]}x{self.frame_size[1]})")

    def stop_recording(self) -> int:
        """Stop recording. Called at race end.

        Returns:
            Total number of frames recorded during this session (may exceed
            buffer capacity if the race was long, since old frames are overwritten).
        """
        self.recording = False
        buffered = len(self.frames)
        print(f"[training] Recording stopped. {buffered} frames in buffer "
              f"({self.total_recorded} total recorded)")
        return self.total_recorded

    def record_frame(self, frame: np.ndarray, steer: float, throttle: float,
                     brake: float, speed: float):
        """Record a single frame + control pair.

        Args:
            frame: Raw camera image from CARLA (any size, will be resized to frame_size).
            steer: Smoothed steering value (post-ramping), not raw key state.
            throttle: Smoothed throttle value (post-ramping).
            brake: Smoothed brake value (post-ramping).
            speed: Current vehicle speed in km/h.
        """
        if not self.recording:
            return

        # Downscale to PilotNet input size (200x66)
        # cv2.resize is very fast for this small target size (<0.1ms)
        try:
            import cv2
            small = cv2.resize(frame, self.frame_size, interpolation=cv2.INTER_AREA)
        except ImportError:
            # Fallback: nearest-neighbor resize using numpy (no cv2 dependency)
            h, w = frame.shape[:2]
            target_w, target_h = self.frame_size
            row_indices = np.linspace(0, h - 1, target_h, dtype=int)
            col_indices = np.linspace(0, w - 1, target_w, dtype=int)
            small = frame[np.ix_(row_indices, col_indices)]

        # Ring buffer: drop oldest frame if at capacity
        if len(self.frames) >= self.max_frames:
            self.frames.pop(0)
            self.controls.pop(0)

        self.frames.append(small)
        self.controls.append({
            'steer': round(steer, 4),
            'throttle': round(throttle, 4),
            'brake': round(brake, 4),
            'speed': round(speed, 2),
            'timestamp': time.time(),
        })
        self.total_recorded += 1

    def get_stats(self) -> Dict:
        """Return recording stats for telemetry/logging."""
        return {
            'frames_recorded': len(self.frames),
            'total_recorded': self.total_recorded,
            'buffer_capacity': self.max_frames,
            'recording': self.recording,
        }

    def get_data_for_training(self) -> Tuple[Optional[np.ndarray], Optional[List[Dict]]]:
        """Return frames and controls as numpy arrays for future training.

        Returns:
            Tuple of (frames_array, controls_list) where:
              - frames_array: np.ndarray of shape (N, 66, 200, 3), dtype uint8
              - controls_list: List of N control dicts
            Returns (None, None) if no frames recorded.
        """
        if not self.frames:
            return None, None
        return np.array(self.frames), list(self.controls)
