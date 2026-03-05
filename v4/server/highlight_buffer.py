"""
Highlight Ring Buffer - Captures race highlights from a rolling frame buffer.

Maintains a ring buffer of the last 5 seconds of JPEG frames (150 frames at 30fps).
When a highlight event is detected (overtake, collision, drift, near-miss), the
buffer contents are snapshotted and stored for later retrieval.

Memory budget: 150 frames * ~50KB avg = ~7.5MB per active buffer.
Each highlight snapshot: ~7.5MB. Max 5 highlights per race = ~37.5MB peak.
"""
import time
import threading
from collections import deque
from typing import Optional, List, Dict


# Ring buffer capacity: 5 seconds at 30fps
BUFFER_CAPACITY = 150

# Maximum number of stored highlights per race
MAX_HIGHLIGHTS = 5

# Minimum time between highlights of the same type (seconds)
HIGHLIGHT_COOLDOWN = 5.0


class HighlightFrame:
    """A single frame stored in the ring buffer."""

    __slots__ = ('jpeg_bytes', 'timestamp')

    def __init__(self, jpeg_bytes: bytes, timestamp: float):
        self.jpeg_bytes = jpeg_bytes
        self.timestamp = timestamp


class HighlightSnapshot:
    """A captured highlight: metadata + frame data from the ring buffer."""

    def __init__(self, event_type: str, timestamp: float,
                 frames: List[HighlightFrame], metadata: Optional[Dict] = None):
        self.event_type = event_type
        self.timestamp = timestamp
        self.frames = frames  # List of HighlightFrame (JPEG bytes + timestamps)
        self.metadata = metadata or {}

    def to_metadata_dict(self) -> Dict:
        """Return metadata-only dict (no frame data) for race results."""
        return {
            'event_type': self.event_type,
            'timestamp': round(self.timestamp, 2),
            'frame_count': len(self.frames),
            'duration_seconds': round(
                self.frames[-1].timestamp - self.frames[0].timestamp, 2
            ) if len(self.frames) >= 2 else 0.0,
            'metadata': self.metadata,
        }

    def get_frame(self, index: int) -> Optional[bytes]:
        """Return JPEG bytes for a specific frame index, or None if out of range."""
        if 0 <= index < len(self.frames):
            return self.frames[index].jpeg_bytes
        return None


class HighlightBuffer:
    """Ring buffer for recent frames with highlight snapshot capability.

    Usage:
        buffer = HighlightBuffer()

        # In the frame loop, push each encoded JPEG:
        buffer.push_frame(jpeg_bytes)

        # When a highlight event is detected:
        buffer.capture_highlight('overtake', metadata={'gap': 0.3})

        # After the race, get highlight metadata:
        highlights = buffer.get_highlights()

        # To retrieve a specific highlight's frame data:
        jpeg = buffer.get_highlight_frame(highlight_index=0, frame_index=50)
    """

    def __init__(self, capacity: int = BUFFER_CAPACITY, max_highlights: int = MAX_HIGHLIGHTS):
        self._capacity = capacity
        self._max_highlights = max_highlights
        self._buffer: deque = deque(maxlen=capacity)
        self._lock = threading.Lock()

        # Stored highlight snapshots
        self._highlights: List[HighlightSnapshot] = []

        # Cooldown tracking: event_type -> last capture timestamp
        self._cooldowns: Dict[str, float] = {}

    def push_frame(self, jpeg_bytes: bytes):
        """Add a JPEG frame to the ring buffer.

        Called every frame (~30fps). Old frames are automatically evicted
        when the buffer exceeds capacity.

        Args:
            jpeg_bytes: Encoded JPEG frame data.
        """
        frame = HighlightFrame(jpeg_bytes=jpeg_bytes, timestamp=time.time())
        with self._lock:
            self._buffer.append(frame)

    def capture_highlight(self, event_type: str,
                          metadata: Optional[Dict] = None) -> bool:
        """Snapshot the current ring buffer contents as a highlight.

        Captures all frames currently in the buffer (up to 5 seconds of history).
        Respects cooldown to prevent duplicate captures for the same event type.

        Args:
            event_type: Type of highlight event. One of:
                'overtake' - Player overtook AI or vice versa
                'collision' - Significant collision impact
                'drift' - Drift score exceeding threshold (>500)
                'near_miss' - Cars within 2m of each other at speed
                'finish' - Race finish moment
            metadata: Optional dict of extra info (e.g., drift score, gap time).

        Returns:
            True if the highlight was captured, False if skipped (cooldown/limit).
        """
        now = time.time()

        with self._lock:
            # Check if we've hit the max highlights for this race
            if len(self._highlights) >= self._max_highlights:
                return False

            # Check cooldown for this event type
            last_capture = self._cooldowns.get(event_type, 0.0)
            if now - last_capture < HIGHLIGHT_COOLDOWN:
                return False

            # Snapshot the buffer: copy all current frames
            if not self._buffer:
                return False

            frames = list(self._buffer)
            snapshot = HighlightSnapshot(
                event_type=event_type,
                timestamp=now,
                frames=frames,
                metadata=metadata,
            )
            self._highlights.append(snapshot)
            self._cooldowns[event_type] = now

        frame_count = len(frames)
        duration = frames[-1].timestamp - frames[0].timestamp if len(frames) >= 2 else 0.0
        total_size_kb = sum(len(f.jpeg_bytes) for f in frames) / 1024
        print(f"[highlight] Captured '{event_type}': {frame_count} frames, "
              f"{duration:.1f}s, {total_size_kb:.0f}KB"
              f"{' | ' + str(metadata) if metadata else ''}")
        return True

    def get_highlights(self) -> List[Dict]:
        """Return metadata for all captured highlights (no frame data).

        Used by the race results to list highlight moments without
        transferring large frame buffers.

        Returns:
            List of highlight metadata dicts.
        """
        with self._lock:
            return [h.to_metadata_dict() for h in self._highlights]

    def get_highlight_frame(self, highlight_index: int, frame_index: int) -> Optional[bytes]:
        """Retrieve a specific frame from a specific highlight.

        Args:
            highlight_index: Index of the highlight (0 to len-1).
            frame_index: Index of the frame within that highlight (0 to frame_count-1).

        Returns:
            JPEG bytes for the requested frame, or None if indices are invalid.
        """
        with self._lock:
            if 0 <= highlight_index < len(self._highlights):
                return self._highlights[highlight_index].get_frame(frame_index)
        return None

    def get_highlight_count(self) -> int:
        """Return the number of captured highlights."""
        with self._lock:
            return len(self._highlights)

    def reset(self):
        """Clear the ring buffer and all stored highlights.

        Called at the start of a new race.
        """
        with self._lock:
            self._buffer.clear()
            self._highlights.clear()
            self._cooldowns.clear()
        print("[highlight] Buffer reset")

    def get_buffer_stats(self) -> Dict:
        """Return current buffer statistics for debugging."""
        with self._lock:
            buffer_size = len(self._buffer)
            buffer_bytes = sum(len(f.jpeg_bytes) for f in self._buffer) if self._buffer else 0
            highlight_count = len(self._highlights)
            highlight_bytes = sum(
                sum(len(f.jpeg_bytes) for f in h.frames)
                for h in self._highlights
            )
        return {
            'buffer_frames': buffer_size,
            'buffer_capacity': self._capacity,
            'buffer_size_kb': round(buffer_bytes / 1024, 1),
            'highlights_captured': highlight_count,
            'highlights_max': self._max_highlights,
            'highlights_size_mb': round(highlight_bytes / (1024 * 1024), 1),
        }
