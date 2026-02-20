"""
Frame Encoder - JPEG encoding with adaptive quality/resolution control

Supports:
  1. Latency-driven adaptive quality (asymmetric: fast down, slow up)
  2. Speed-based resolution scaling (drop res at high speed)
  3. Frame delta detection (skip unchanged frames via fast perceptual hash)
  4. Performance monitoring (rolling averages, auto-reduction)
"""
import cv2
import time
import numpy as np
from collections import deque
from typing import Optional, Tuple, Dict

# Absolute bounds for adaptive quality (never go outside these)
MIN_QUALITY = 25
MAX_QUALITY = 75

# Latency thresholds and target qualities
# Format: (latency_threshold, target_quality, target_width, target_height)
# Checked in order from worst to best latency
LATENCY_TIERS = [
    # latency > 150ms: emergency quality, reduced resolution
    (150, 25, 960, 540),
    # latency 80-150ms: moderate quality, full resolution
    (80, 40, 1280, 720),
    # latency 50-80ms: good quality, full resolution
    (50, 60, 1280, 720),
    # latency < 50ms: best quality, full resolution
    (0, 75, 1280, 720),
]

# Frame delta detection: block-based mean comparison
DELTA_BLOCK_SIZE = 8      # Downsample to 8x8 blocks for comparison
DELTA_THRESHOLD = 3.0     # Mean absolute difference threshold (0-255 scale)


class FrameEncoder:
    """Encodes frames to JPEG for WebSocket transmission.

    Features:
      - Adaptive quality based on client-reported latency
      - Speed-based resolution scaling
      - Frame delta detection to skip unchanged frames
      - Performance monitoring with rolling averages
    """

    def __init__(self, quality: int = 50, max_width: int = 1280, max_height: int = 720):
        self.quality = max(MIN_QUALITY, min(MAX_QUALITY, quality))
        self.max_width = max_width
        self.max_height = max_height
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

        # Target resolution (the "full" resolution we restore to when conditions are good)
        self._target_width = max_width
        self._target_height = max_height

        # --- Adaptive quality state ---
        self._latency_quality_target = quality   # Target quality from latency adaptation
        self._latency_res_width = max_width      # Target resolution from latency
        self._latency_res_height = max_height

        # --- Speed-based resolution ---
        self._speed_downscaled = False  # Whether speed-based downscaling is active

        # --- Frame delta detection ---
        self._prev_frame_hash: Optional[np.ndarray] = None  # Previous frame's block hash

        # --- Performance monitoring ---
        self._encode_times: deque = deque(maxlen=30)  # Last 30 encode times (ms)
        self._frame_sizes: deque = deque(maxlen=30)   # Last 30 frame sizes (bytes)
        self._perf_auto_reduced = False  # Whether we auto-reduced quality due to slow encoding
        self._last_perf_stats_time: float = 0.0

    def encode(self, frame: np.ndarray) -> Optional[bytes]:
        """Encode RGB frame to JPEG bytes.

        Returns None if encoding fails. Tracks encode time and frame size
        for performance monitoring.
        """
        if frame is None:
            return None

        t0 = time.time()

        # Resize if needed (respects both latency-based and speed-based resolution)
        h, w = frame.shape[:2]
        if w > self.max_width or h > self.max_height:
            scale = min(self.max_width / w, self.max_height / h)
            new_w = int(w * scale)
            new_h = int(h * scale)
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # Convert RGB to BGR for OpenCV
        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        # Encode to JPEG
        success, encoded = cv2.imencode('.jpg', bgr, self.encode_params)
        if not success:
            return None

        jpeg_bytes = encoded.tobytes()

        # Track performance
        encode_ms = (time.time() - t0) * 1000
        self._encode_times.append(encode_ms)
        self._frame_sizes.append(len(jpeg_bytes))

        # Auto-reduce quality if encoding is too slow
        self._check_auto_reduce()

        return jpeg_bytes

    # ---------------------------------------------------------------
    # 1. Adaptive Quality (latency-driven)
    # ---------------------------------------------------------------

    def adapt_quality(self, latency_ms: float):
        """Adjust JPEG quality and resolution based on round-trip latency.

        Asymmetric stepping:
          - Quality drops fast (step=8 per call) to react quickly to lag spikes
          - Quality rises slowly (step=2 per call) to avoid oscillation

        Thresholds (checked worst-to-best):
          >150ms  -> quality 25, resolution 960x540
          80-150ms -> quality 40, resolution 1280x720
          50-80ms  -> quality 60, resolution 1280x720
          <50ms   -> quality 75, resolution 1280x720

        Args:
            latency_ms: Round-trip latency from the client in milliseconds.
        """
        old_quality = self.quality
        old_res = (self.max_width, self.max_height)

        step_down = 8  # Fast quality reduction
        step_up = 2    # Slow quality increase

        # Find the matching latency tier
        target_q = self._latency_quality_target
        target_w = self._latency_res_width
        target_h = self._latency_res_height

        for threshold, tier_quality, tier_w, tier_h in LATENCY_TIERS:
            if latency_ms > threshold or threshold == 0:
                target_q = tier_quality
                target_w = tier_w
                target_h = tier_h
                break

        # Apply gradual quality change (asymmetric stepping)
        if self.quality > target_q:
            # Dropping quality: fast
            self.quality = max(target_q, self.quality - step_down)
        elif self.quality < target_q:
            # Raising quality: slow
            self.quality = min(target_q, self.quality + step_up)

        # Resolution changes are immediate for drops, gradual for increases
        if target_w < self._latency_res_width:
            # Dropping resolution: immediate
            self._latency_res_width = target_w
            self._latency_res_height = target_h
        elif target_w > self._latency_res_width:
            # Raising resolution: only if quality has already stabilized near target
            if abs(self.quality - target_q) <= step_up:
                self._latency_res_width = target_w
                self._latency_res_height = target_h

        # Apply resolution (latency res is the baseline; speed scaling may override)
        if not self._speed_downscaled:
            self.max_width = self._latency_res_width
            self.max_height = self._latency_res_height

        # Clamp and update encode params
        self.quality = max(MIN_QUALITY, min(MAX_QUALITY, self.quality))
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]

        # Store target for next call
        self._latency_quality_target = target_q

        # Log changes
        new_res = (self.max_width, self.max_height)
        if self.quality != old_quality or new_res != old_res:
            print(f"[adaptive] latency={latency_ms:.0f}ms -> quality {old_quality}->{self.quality}, "
                  f"res {old_res[0]}x{old_res[1]}->{new_res[0]}x{new_res[1]}")

    # ---------------------------------------------------------------
    # 2. Frame Delta Detection
    # ---------------------------------------------------------------

    def is_frame_similar(self, frame: np.ndarray) -> bool:
        """Check if the current frame is visually similar to the previous one.

        Uses a fast block-mean hash: downsample to DELTA_BLOCK_SIZExDELTA_BLOCK_SIZE,
        convert to grayscale mean per block, compare with previous hash.

        This runs in <0.5ms on a 1280x720 frame using numpy operations.

        Args:
            frame: RGB numpy array (H, W, 3)

        Returns:
            True if frames are similar (caller should skip encoding)
        """
        if frame is None:
            return False

        # Compute block hash: downsample to small grid, take mean per block
        # This captures the overall structure without being pixel-exact
        h, w = frame.shape[:2]
        block_h = h // DELTA_BLOCK_SIZE
        block_w = w // DELTA_BLOCK_SIZE

        # Trim to exact multiple of block size, then reshape into blocks
        trimmed = frame[:block_h * DELTA_BLOCK_SIZE, :block_w * DELTA_BLOCK_SIZE]

        # Convert to grayscale first (faster comparison, single channel)
        # Use luminance weights: 0.299R + 0.587G + 0.114B
        gray = trimmed[:, :, 0] * 0.299 + trimmed[:, :, 1] * 0.587 + trimmed[:, :, 2] * 0.114

        # Reshape into blocks and compute mean of each block
        blocks = gray.reshape(DELTA_BLOCK_SIZE, block_h, DELTA_BLOCK_SIZE, block_w)
        current_hash = blocks.mean(axis=(1, 3)).astype(np.float32)

        # Compare with previous
        if self._prev_frame_hash is None:
            self._prev_frame_hash = current_hash
            return False

        # Mean absolute difference across all blocks
        diff = np.abs(current_hash - self._prev_frame_hash).mean()

        # Always update the hash for next comparison
        self._prev_frame_hash = current_hash

        return diff < DELTA_THRESHOLD

    def reset_frame_hash(self):
        """Reset the stored frame hash (e.g., on camera mode change)."""
        self._prev_frame_hash = None

    # ---------------------------------------------------------------
    # 3. Speed-Based Resolution Scaling
    # ---------------------------------------------------------------

    def update_speed_resolution(self, speed_kmh: float):
        """Adjust resolution based on vehicle speed.

        At very high speeds (200+ km/h), players cannot perceive fine detail.
        Drop to 960x540 to save encode time and bandwidth.

        Uses hysteresis to avoid flapping:
          - Downscale at 200+ km/h
          - Restore at <150 km/h (50 km/h gap prevents oscillation)

        Args:
            speed_kmh: Current player speed in km/h
        """
        old_downscaled = self._speed_downscaled

        if speed_kmh >= 200.0 and not self._speed_downscaled:
            # High speed: downscale
            self._speed_downscaled = True
            self.max_width = 960
            self.max_height = 540
        elif speed_kmh < 150.0 and self._speed_downscaled:
            # Speed dropped below restore threshold: go back to latency-based resolution
            self._speed_downscaled = False
            self.max_width = self._latency_res_width
            self.max_height = self._latency_res_height

        if old_downscaled != self._speed_downscaled:
            print(f"[speed-res] speed={speed_kmh:.0f}km/h -> "
                  f"res {'960x540 (downscaled)' if self._speed_downscaled else f'{self.max_width}x{self.max_height} (restored)'}")

    # ---------------------------------------------------------------
    # 4. Performance Monitoring
    # ---------------------------------------------------------------

    def _check_auto_reduce(self):
        """Auto-reduce quality if average encode time exceeds 15ms.

        Only checks when we have enough samples (at least 10 frames).
        Reduces quality by 5 per check, down to MIN_QUALITY.
        """
        if len(self._encode_times) < 10:
            return

        avg_encode = sum(self._encode_times) / len(self._encode_times)
        if avg_encode > 15.0 and self.quality > MIN_QUALITY:
            old_q = self.quality
            self.quality = max(MIN_QUALITY, self.quality - 5)
            self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]
            self._perf_auto_reduced = True
            print(f"[perf-auto] avg encode {avg_encode:.1f}ms > 15ms, "
                  f"quality {old_q}->{self.quality}")

    def get_perf_stats(self) -> Dict:
        """Get current performance statistics.

        Returns a dict suitable for sending to the client as a perf_stats message.
        """
        avg_encode = 0.0
        avg_frame_size = 0
        if self._encode_times:
            avg_encode = sum(self._encode_times) / len(self._encode_times)
        if self._frame_sizes:
            avg_frame_size = int(sum(self._frame_sizes) / len(self._frame_sizes))

        return {
            'avg_encode_ms': round(avg_encode, 1),
            'avg_frame_size_kb': round(avg_frame_size / 1024, 1),
            'quality': self.quality,
            'resolution': f'{self.max_width}x{self.max_height}',
            'speed_downscaled': self._speed_downscaled,
            'auto_reduced': self._perf_auto_reduced,
            'samples': len(self._encode_times),
        }

    def should_send_perf_stats(self, interval: float = 3.0) -> bool:
        """Check if it's time to send perf stats to the client.

        Args:
            interval: Minimum seconds between perf stat sends.

        Returns:
            True if enough time has elapsed since last send.
        """
        now = time.time()
        if now - self._last_perf_stats_time >= interval:
            self._last_perf_stats_time = now
            return True
        return False

    # ---------------------------------------------------------------
    # Existing API (preserved for compatibility)
    # ---------------------------------------------------------------

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
