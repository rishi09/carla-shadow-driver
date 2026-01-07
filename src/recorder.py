"""
Recorder - Save driving data to disk for later analysis
"""
import os
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import cv2
import numpy as np
import yaml


class DrivingRecorder:
    """Records camera frames and telemetry to disk."""

    def __init__(self, config_path: str = "configs/default.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)['recording']

        self.session_dir: Optional[Path] = None
        self.frame_count = 0
        self.telemetry_log = []
        self.is_recording = False
        self.start_time: Optional[float] = None

    def start_session(self, session_name: Optional[str] = None) -> str:
        """Start a new recording session."""
        if session_name is None:
            session_name = datetime.now().strftime("%Y%m%d_%H%M%S")

        base_dir = Path(self.config['output_dir'])
        self.session_dir = base_dir / session_name
        self.session_dir.mkdir(parents=True, exist_ok=True)

        # Create subdirectories
        if self.config['save_images']:
            (self.session_dir / "images").mkdir(exist_ok=True)

        # Reset counters
        self.frame_count = 0
        self.telemetry_log = []
        self.start_time = time.time()
        self.is_recording = True

        print(f"Recording started: {self.session_dir}")
        return str(self.session_dir)

    def record_frame(self, frame: np.ndarray, telemetry: dict,
                     ai_prediction: Optional[dict] = None):
        """Record a single frame with telemetry."""
        if not self.is_recording or self.session_dir is None:
            return

        timestamp = time.time() - self.start_time

        # Save image
        if self.config['save_images']:
            img_format = self.config['image_format']
            img_path = self.session_dir / "images" / f"frame_{self.frame_count:06d}.{img_format}"

            # Convert RGB to BGR for OpenCV
            bgr_frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

            if img_format == 'jpg':
                cv2.imwrite(str(img_path), bgr_frame,
                           [cv2.IMWRITE_JPEG_QUALITY, self.config['jpeg_quality']])
            else:
                cv2.imwrite(str(img_path), bgr_frame)

        # Log telemetry
        if self.config['save_telemetry']:
            entry = {
                'frame': self.frame_count,
                'timestamp': timestamp,
                'telemetry': telemetry
            }
            if ai_prediction:
                entry['ai_prediction'] = ai_prediction
            self.telemetry_log.append(entry)

        self.frame_count += 1

    def stop_session(self) -> dict:
        """Stop recording and save telemetry log."""
        if not self.is_recording:
            return {}

        self.is_recording = False
        duration = time.time() - self.start_time

        # Save telemetry log
        if self.config['save_telemetry'] and self.telemetry_log:
            log_path = self.session_dir / "telemetry.json"
            with open(log_path, 'w') as f:
                json.dump(self.telemetry_log, f, indent=2)

        # Save session metadata
        metadata = {
            'session_name': self.session_dir.name,
            'duration_seconds': duration,
            'total_frames': self.frame_count,
            'fps': self.frame_count / duration if duration > 0 else 0,
            'config': self.config
        }
        metadata_path = self.session_dir / "metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"Recording stopped: {self.frame_count} frames, {duration:.1f}s")
        return metadata


class DatasetLoader:
    """Load recorded driving data for offline analysis."""

    def __init__(self, session_dir: str):
        self.session_dir = Path(session_dir)
        self.metadata = self._load_metadata()
        self.telemetry = self._load_telemetry()

    def _load_metadata(self) -> dict:
        metadata_path = self.session_dir / "metadata.json"
        if metadata_path.exists():
            with open(metadata_path, 'r') as f:
                return json.load(f)
        return {}

    def _load_telemetry(self) -> list:
        telemetry_path = self.session_dir / "telemetry.json"
        if telemetry_path.exists():
            with open(telemetry_path, 'r') as f:
                return json.load(f)
        return []

    def __len__(self) -> int:
        return len(self.telemetry)

    def __getitem__(self, idx: int) -> dict:
        """Get frame and telemetry by index."""
        entry = self.telemetry[idx]

        # Load image
        img_dir = self.session_dir / "images"
        img_path = list(img_dir.glob(f"frame_{idx:06d}.*"))
        if img_path:
            bgr = cv2.imread(str(img_path[0]))
            frame = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        else:
            frame = None

        return {
            'frame': frame,
            'telemetry': entry['telemetry'],
            'timestamp': entry['timestamp'],
            'ai_prediction': entry.get('ai_prediction')
        }

    def iter_frames(self):
        """Iterate over all frames."""
        for i in range(len(self)):
            yield self[i]
