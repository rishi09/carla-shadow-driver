"""
WebRTC Video Track - Streams CARLA chase camera frames via WebRTC
Uses aiortc to send H.264-encoded video to the browser client.
"""
import asyncio
import time

import av
import numpy as np
from aiortc import MediaStreamTrack
from aiortc.rtcrtpsender import RTCRtpSender

# H.264 clock rate per RTP spec
VIDEO_CLOCK_RATE = 90000
VIDEO_PTIME = 1.0 / 30.0  # 30 fps


class CarlaVideoTrack(MediaStreamTrack):
    """MediaStreamTrack that reads frames from CARLA's chase camera buffer."""

    kind = "video"

    def __init__(self, carla_manager):
        super().__init__()
        self._carla = carla_manager
        self._start = None
        self._timestamp = 0

    async def recv(self):
        """Return the next video frame, paced at 30 fps."""
        if self._start is None:
            self._start = time.time()

        # Pace at 30 fps
        pts, time_base = await self.next_timestamp()

        # Read RGB frame from CARLA camera buffer
        frame_rgb = self._carla.get_chase_frame()
        if frame_rgb is None:
            # No frame available yet — send a small black frame as placeholder
            frame_rgb = np.zeros((720, 1280, 3), dtype=np.uint8)

        video_frame = av.VideoFrame.from_ndarray(frame_rgb, format="rgb24")
        video_frame.pts = pts
        video_frame.time_base = time_base
        return video_frame

    async def next_timestamp(self):
        """Calculate the next PTS for 30 fps pacing."""
        if self._start is None:
            self._start = time.time()

        # Wait until the next frame time
        target = self._start + (self._timestamp + 1) * VIDEO_PTIME
        wait = target - time.time()
        if wait > 0:
            await asyncio.sleep(wait)

        self._timestamp += 1
        pts = int(self._timestamp * VIDEO_PTIME * VIDEO_CLOCK_RATE)
        return pts, av.Fraction(1, VIDEO_CLOCK_RATE)


def force_codec(pc, sender, forced_codec="video/H264"):
    """Force a specific codec on an RTCRtpSender's transceiver.

    Reorders the transceiver's codec preferences so that the desired codec
    appears first, causing aiortc to select it for encoding.
    """
    capabilities = RTCRtpSender.getCapabilities("video")
    preferences = [c for c in capabilities.codecs if c.mimeType == forced_codec]
    # Append remaining codecs as fallback
    preferences += [c for c in capabilities.codecs if c.mimeType != forced_codec]

    for transceiver in pc.getTransceivers():
        if transceiver.sender == sender:
            transceiver.setCodecPreferences(preferences)
            break
