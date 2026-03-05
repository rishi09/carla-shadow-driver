"""
game_streamer.py -- Reusable low-latency game streaming library.

Wraps GStreamer (with FFmpeg fallback) to provide a simple API for streaming
raw video frames over WebSocket to browser clients using H.264 + WebCodecs.

Usage:
    from game_streamer import GameStreamer

    streamer = GameStreamer(width=1920, height=1080, fps=30)
    await streamer.start()

    # In your game/render loop:
    streamer.send_frame(bgra_numpy_array)

    # Adaptive quality:
    streamer.set_bitrate(6_000_000)

    await streamer.stop()

Requires:
    - GStreamer 1.20+ with gstreamer1.0-plugins-bad (for nvh264enc)
    - OR FFmpeg with h264_nvenc (fallback)
    - Python packages: websockets, numpy

Architecture:
    Frame (numpy/bytes) --> [GStreamer pipeline OR FFmpeg subprocess]
                                |
                            H.264 NAL units
                                |
                            appsink / stdout reader
                                |
                            asyncio WebSocket server --> Browser (WebCodecs)
"""

import asyncio
import json
import logging
import subprocess
import struct
import threading
import time
import queue
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional, Set, Tuple

import numpy as np

try:
    import websockets
    import websockets.server
except ImportError:
    raise ImportError("Install websockets: pip install websockets")

logger = logging.getLogger("game_streamer")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class EncoderBackend(Enum):
    GSTREAMER = "gstreamer"
    FFMPEG = "ffmpeg"
    SOFTWARE = "software"  # x264 via FFmpeg, no GPU required

class TransportMode(Enum):
    WEBSOCKET = "websocket"

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

@dataclass
class StreamerMetrics:
    """Real-time streaming performance metrics."""
    frames_submitted: int = 0
    frames_encoded: int = 0
    frames_sent: int = 0
    frames_dropped: int = 0
    encode_ms_avg: float = 0.0
    encode_ms_last: float = 0.0
    bitrate_bps: int = 0
    fps_measured: float = 0.0
    clients_connected: int = 0
    encoder_backend: str = "none"
    uptime_seconds: float = 0.0

    # Internal accumulators (not exposed)
    _encode_times: list = field(default_factory=list, repr=False)
    _bytes_sent_window: list = field(default_factory=list, repr=False)
    _frame_times: list = field(default_factory=list, repr=False)

    def record_encode(self, duration_ms: float):
        self._encode_times.append(duration_ms)
        self.encode_ms_last = duration_ms
        # Rolling window of 60 samples
        if len(self._encode_times) > 60:
            self._encode_times.pop(0)
        self.encode_ms_avg = sum(self._encode_times) / len(self._encode_times)

    def record_frame_sent(self, nbytes: int):
        now = time.monotonic()
        self._bytes_sent_window.append((now, nbytes))
        self._frame_times.append(now)
        # Prune older than 2 seconds
        cutoff = now - 2.0
        self._bytes_sent_window = [(t, b) for t, b in self._bytes_sent_window if t > cutoff]
        self._frame_times = [t for t in self._frame_times if t > cutoff]
        # Compute bitrate
        total_bytes = sum(b for _, b in self._bytes_sent_window)
        window = now - self._bytes_sent_window[0][0] if len(self._bytes_sent_window) > 1 else 1.0
        self.bitrate_bps = int(total_bytes * 8 / max(window, 0.001))
        # Compute FPS
        self.fps_measured = len(self._frame_times) / max(now - self._frame_times[0], 0.001) if len(self._frame_times) > 1 else 0

    def to_dict(self) -> dict:
        return {
            "frames_submitted": self.frames_submitted,
            "frames_encoded": self.frames_encoded,
            "frames_sent": self.frames_sent,
            "frames_dropped": self.frames_dropped,
            "encode_ms_avg": round(self.encode_ms_avg, 2),
            "encode_ms_last": round(self.encode_ms_last, 2),
            "bitrate_kbps": self.bitrate_bps // 1000,
            "fps": round(self.fps_measured, 1),
            "clients": self.clients_connected,
            "backend": self.encoder_backend,
            "uptime_s": round(self.uptime_seconds, 1),
        }


# ---------------------------------------------------------------------------
# GStreamer Encoder Backend
# ---------------------------------------------------------------------------

class GStreamerEncoder:
    """
    GStreamer-based H.264 encoder using NVENC (GPU) or x264 (CPU fallback).

    Pipeline (NVENC zero-copy path):
        appsrc (BGRA) ! cudaupload ! cudaconvert ! video/x-raw(memory:CUDAMemory),format=NV12
            ! nvh264enc preset=p1 tune=ultra-low-latency zerolatency=true rc-mode=cbr
            ! h264parse config-interval=-1 ! appsink

    Pipeline (CPU fallback):
        appsrc (BGRA) ! videoconvert ! video/x-raw,format=I420
            ! x264enc speed-preset=ultrafast tune=zerolatency
            ! h264parse config-interval=-1 ! appsink

    Key design decisions:
    - appsrc is-live=true + format=time: Tells downstream we are a live source
      with timestamped buffers, so no buffering occurs.
    - cudaupload + cudaconvert: Keeps frames on GPU from upload through encoding.
      Avoids CPU-side colorspace conversion entirely.
    - h264parse config-interval=-1: Inserts SPS/PPS before every keyframe,
      which is critical for WebCodecs decoder initialization on late-joining clients.
    - appsink emit-signals=true max-buffers=2 drop=true: Non-blocking pull with
      automatic frame drop if consumer is slow.
    - nvh264enc properties: zerolatency=true disables frame reordering,
      rc-lookahead=0 removes lookahead buffering, bframes=0 removes B-frame delay,
      spatial-aq=true improves perceived quality at edges.
    - Bitrate changes: nvh264enc supports set_property("bitrate") on a running
      pipeline. No restart needed.
    """

    def __init__(self, width: int, height: int, fps: int, bitrate_bps: int,
                 gop_seconds: float = 2.0):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate_kbps = bitrate_bps // 1000
        self.gop_size = int(fps * gop_seconds)

        self._pipeline = None
        self._appsrc = None
        self._appsink = None
        self._encoder = None
        self._running = False
        self._frame_count = 0
        self._backend_name = "none"

        # Thread-safe queue for encoded frames
        self._output_queue: queue.Queue = queue.Queue(maxsize=30)

        # GStreamer imports (deferred to avoid import errors on systems without GStreamer)
        self._gi = None
        self._Gst = None
        self._GLib = None

    def _import_gstreamer(self) -> bool:
        """Import GStreamer Python bindings. Returns True if available."""
        try:
            import gi
            gi.require_version("Gst", "1.0")
            gi.require_version("GstApp", "1.0")
            from gi.repository import Gst, GLib, GstApp
            Gst.init(None)
            self._gi = gi
            self._Gst = Gst
            self._GLib = GLib
            self._GstApp = GstApp
            return True
        except (ImportError, ValueError) as e:
            logger.warning(f"GStreamer not available: {e}")
            return False

    def _check_nvenc_available(self) -> bool:
        """Check if nvh264enc element exists in the GStreamer registry."""
        factory = self._Gst.ElementFactory.find("nvh264enc")
        return factory is not None

    def _check_cuda_available(self) -> bool:
        """Check if CUDA upload/convert elements exist."""
        return (self._Gst.ElementFactory.find("cudaupload") is not None and
                self._Gst.ElementFactory.find("cudaconvert") is not None)

    def _build_pipeline_string(self, use_nvenc: bool, use_cuda: bool) -> str:
        """Build the GStreamer pipeline description string.

        NVENC + CUDA path (zero-copy):
            appsrc ! cudaupload ! cudaconvert ! nvh264enc ! h264parse ! appsink

        NVENC without CUDA (CPU colorspace conversion):
            appsrc ! videoconvert ! nvh264enc ! h264parse ! appsink

        Software fallback:
            appsrc ! videoconvert ! x264enc ! h264parse ! appsink
        """
        # Source: appsrc configured for live BGRA video
        src = (
            f'appsrc name=src is-live=true format=time do-timestamp=true '
            f'caps="video/x-raw,format=BGRA,width={self.width},height={self.height},'
            f'framerate={self.fps}/1"'
        )

        if use_nvenc:
            if use_cuda:
                # Zero-copy GPU path: upload to CUDA memory, convert BGRA->NV12 on GPU
                convert = (
                    'cudaupload ! cudaconvert ! '
                    f'video/x-raw(memory:CUDAMemory),format=NV12,'
                    f'width={self.width},height={self.height}'
                )
                self._backend_name = "gstreamer-nvenc-cuda"
            else:
                # CPU colorspace conversion, GPU encoding
                convert = (
                    f'videoconvert ! video/x-raw,format=NV12,'
                    f'width={self.width},height={self.height}'
                )
                self._backend_name = "gstreamer-nvenc"

            # NVENC encoder with ultra-low-latency settings
            # Key properties explained:
            #   preset=p1           -- Fastest NVENC preset (p1-p7, p1=fastest)
            #   tune=ultra-low-latency -- Disables features that add latency
            #   zerolatency=true    -- No frame reordering delay
            #   rc-mode=cbr         -- Constant bitrate (predictable bandwidth)
            #   rc-lookahead=0      -- No lookahead frames (immediate encoding)
            #   bframes=0           -- No B-frames (each frame decodable immediately)
            #   spatial-aq=true     -- Better quality at edges without latency cost
            #   aud=true            -- Access unit delimiters for parser
            #   gop-size=N          -- Keyframe interval
            encoder = (
                f'nvh264enc name=encoder '
                f'preset=p1 '
                f'zerolatency=true '
                f'rc-mode=cbr '
                f'bitrate={self.bitrate_kbps} '
                f'gop-size={self.gop_size} '
                f'bframes=0 '
                f'rc-lookahead=0 '
                f'spatial-aq=true '
                f'aud=true '
            )
        else:
            # Software x264 fallback
            convert = (
                f'videoconvert ! video/x-raw,format=I420,'
                f'width={self.width},height={self.height}'
            )
            encoder = (
                f'x264enc name=encoder '
                f'speed-preset=ultrafast '
                f'tune=zerolatency '
                f'bitrate={self.bitrate_kbps} '
                f'key-int-max={self.gop_size} '
                f'bframes=0 '
                f'aud=true '
                f'byte-stream=true '
            )
            self._backend_name = "gstreamer-x264"

        # Parser: config-interval=-1 injects SPS/PPS before every IDR
        parser = 'h264parse config-interval=-1'

        # Sink: appsink for pulling encoded NAL units
        sink = (
            'appsink name=sink emit-signals=true '
            'max-buffers=2 drop=true sync=false'
        )

        pipeline_str = f'{src} ! {convert} ! {encoder} ! {parser} ! {sink}'
        logger.info(f"GStreamer pipeline: {pipeline_str}")
        return pipeline_str

    def start(self) -> bool:
        """Initialize and start the GStreamer pipeline."""
        if not self._import_gstreamer():
            return False

        Gst = self._Gst

        use_nvenc = self._check_nvenc_available()
        use_cuda = use_nvenc and self._check_cuda_available()

        pipeline_str = self._build_pipeline_string(use_nvenc, use_cuda)

        try:
            self._pipeline = Gst.parse_launch(pipeline_str)
        except Exception as e:
            logger.error(f"Failed to create GStreamer pipeline: {e}")
            # Try software fallback
            if use_nvenc:
                logger.info("Retrying with software encoder...")
                pipeline_str = self._build_pipeline_string(False, False)
                try:
                    self._pipeline = Gst.parse_launch(pipeline_str)
                except Exception as e2:
                    logger.error(f"Software fallback also failed: {e2}")
                    return False
            else:
                return False

        self._appsrc = self._pipeline.get_by_name("src")
        self._appsink = self._pipeline.get_by_name("sink")
        self._encoder = self._pipeline.get_by_name("encoder")

        if not all([self._appsrc, self._appsink, self._encoder]):
            logger.error("Failed to get pipeline elements")
            return False

        # Connect appsink new-sample signal
        self._appsink.connect("new-sample", self._on_new_sample)

        # Start pipeline
        ret = self._pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            logger.error("Failed to start GStreamer pipeline")
            self._pipeline.set_state(Gst.State.NULL)
            return False

        self._running = True
        self._frame_count = 0

        # Start GLib main loop in a background thread
        # GStreamer needs a running GLib MainLoop for signal dispatch
        self._loop = self._GLib.MainLoop()
        self._loop_thread = threading.Thread(
            target=self._loop.run, daemon=True, name="gst-mainloop"
        )
        self._loop_thread.start()

        logger.info(f"GStreamer encoder started: {self._backend_name} "
                     f"({self.width}x{self.height} @ {self.fps}fps, "
                     f"{self.bitrate_kbps}kbps)")
        return True

    def stop(self):
        """Stop the GStreamer pipeline and clean up."""
        self._running = False
        if self._pipeline:
            self._pipeline.set_state(self._Gst.State.NULL)
        if hasattr(self, '_loop') and self._loop:
            self._loop.quit()
        logger.info("GStreamer encoder stopped")

    def encode_frame(self, frame_data: bytes) -> bool:
        """Push a raw BGRA frame into the GStreamer pipeline.

        Args:
            frame_data: Raw BGRA bytes (width * height * 4 bytes)

        Returns:
            True if frame was accepted by the pipeline.
        """
        if not self._running:
            return False

        Gst = self._Gst

        expected = self.width * self.height * 4
        if len(frame_data) != expected:
            logger.warning(f"Frame size mismatch: {len(frame_data)} != {expected}")
            return False

        # Create GStreamer buffer from raw bytes
        buf = Gst.Buffer.new_memdup(frame_data)

        # Set timestamps for live pipeline
        duration = Gst.SECOND // self.fps
        buf.pts = self._frame_count * duration
        buf.dts = buf.pts
        buf.duration = duration
        buf.offset = self._frame_count

        self._frame_count += 1

        # Push buffer to appsrc
        # FlowReturn.OK = 0, FlowReturn.FLUSHING = -1, FlowReturn.EOS = -5
        ret = self._appsrc.emit("push-buffer", buf)
        return ret == Gst.FlowReturn.OK

    def get_encoded_frame(self) -> Optional[Tuple[bool, bytes]]:
        """Get the next encoded H.264 access unit (non-blocking).

        Returns:
            (is_keyframe, data) or None
        """
        try:
            return self._output_queue.get_nowait()
        except queue.Empty:
            return None

    def set_bitrate(self, bitrate_bps: int):
        """Dynamically change the encoder bitrate without pipeline restart.

        For nvh264enc: The bitrate property can be changed on a running pipeline.
        For x264enc: The bitrate property can also be changed dynamically.

        This is a major advantage of GStreamer over the FFmpeg subprocess approach,
        where bitrate changes require killing and restarting the entire process.
        """
        new_kbps = bitrate_bps // 1000
        if self._encoder and self._running:
            try:
                self._encoder.set_property("bitrate", new_kbps)
                self.bitrate_kbps = new_kbps
                logger.info(f"Bitrate changed to {new_kbps} kbps (no restart needed)")
            except Exception as e:
                logger.warning(f"Failed to set bitrate: {e}")

    def _on_new_sample(self, appsink) -> int:
        """Callback when appsink has a new encoded H.264 sample.

        Called from the GLib MainLoop thread. Extracts the encoded data
        and pushes it to the thread-safe output queue.
        """
        Gst = self._Gst

        sample = appsink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.OK

        buf = sample.get_buffer()
        if not buf:
            return Gst.FlowReturn.OK

        # Extract bytes from GstBuffer
        success, map_info = buf.map(Gst.MapFlags.READ)
        if not success:
            return Gst.FlowReturn.OK

        data = bytes(map_info.data)
        buf.unmap(map_info)

        # Detect keyframe from buffer flags
        # GST_BUFFER_FLAG_DELTA_UNIT means it is NOT a keyframe
        is_keyframe = not bool(buf.flags & Gst.BufferFlags.DELTA_UNIT)

        try:
            self._output_queue.put_nowait((is_keyframe, data))
        except queue.Full:
            # Drop oldest to prevent queue backup
            try:
                self._output_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._output_queue.put_nowait((is_keyframe, data))
            except queue.Full:
                pass

        return Gst.FlowReturn.OK

    @property
    def backend_name(self) -> str:
        return self._backend_name


# ---------------------------------------------------------------------------
# FFmpeg Encoder Backend (fallback when GStreamer is not installed)
# ---------------------------------------------------------------------------

class FFmpegEncoder:
    """
    FFmpeg subprocess H.264 encoder -- used when GStreamer is not available.

    This is essentially a cleaned-up version of Shadow Driver's nvenc_encoder.py,
    packaged as a drop-in alternative backend.

    Pipeline:
        [stdin: raw BGRA] --> ffmpeg h264_nvenc --> [stdout: H.264 Annex B] --> NAL parser
    """

    def __init__(self, width: int, height: int, fps: int, bitrate_bps: int,
                 use_gpu: bool = True):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate_str = f"{bitrate_bps // 1000}k"
        self.use_gpu = use_gpu

        self._process: Optional[subprocess.Popen] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False
        self._frame_count = 0

        self._output_queue: queue.Queue = queue.Queue(maxsize=30)
        self._backend_name = "ffmpeg-nvenc" if use_gpu else "ffmpeg-x264"

    def start(self) -> bool:
        """Start the FFmpeg subprocess."""
        if self.use_gpu:
            encoder_args = [
                '-c:v', 'h264_nvenc',
                '-preset', 'p1',
                '-tune', 'ull',
                '-rc', 'cbr',
                '-b:v', self.bitrate_str,
                '-spatial-aq', '1',
                '-bf', '0',
                '-rc-lookahead', '0',
                '-zerolatency', '1',
                '-g', str(self.fps * 2),  # Keyframe every 2 seconds
            ]
        else:
            encoder_args = [
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'zerolatency',
                '-b:v', self.bitrate_str,
                '-bf', '0',
                '-g', str(self.fps * 2),
            ]

        cmd = [
            'ffmpeg',
            '-hide_banner', '-loglevel', 'error',
            '-f', 'rawvideo', '-pix_fmt', 'bgra',
            '-s', f'{self.width}x{self.height}',
            '-r', str(self.fps),
            '-i', 'pipe:0',
            *encoder_args,
            '-f', 'h264',
            'pipe:1',
        ]

        try:
            self._process = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, bufsize=0,
            )
        except FileNotFoundError:
            logger.error("FFmpeg not found")
            return False
        except Exception as e:
            logger.error(f"Failed to start FFmpeg: {e}")
            return False

        time.sleep(0.2)
        if self._process.poll() is not None:
            stderr = self._process.stderr.read().decode(errors='replace')[:500]
            logger.error(f"FFmpeg exited immediately: {stderr}")
            self._process = None
            return False

        self._running = True
        self._reader_thread = threading.Thread(
            target=self._read_output, daemon=True, name="ffmpeg-reader"
        )
        self._reader_thread.start()

        logger.info(f"FFmpeg encoder started: {self._backend_name} "
                     f"({self.width}x{self.height} @ {self.fps}fps)")
        return True

    def stop(self):
        """Stop FFmpeg and clean up."""
        self._running = False
        if self._process:
            try:
                self._process.stdin.close()
            except Exception:
                pass
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
            self._process = None
        logger.info("FFmpeg encoder stopped")

    def encode_frame(self, frame_data: bytes) -> bool:
        """Write a raw BGRA frame to FFmpeg's stdin."""
        if not self._running or not self._process or not self._process.stdin:
            return False

        expected = self.width * self.height * 4
        if len(frame_data) != expected:
            return False

        try:
            self._process.stdin.write(frame_data)
            self._process.stdin.flush()
            self._frame_count += 1
            return True
        except (BrokenPipeError, OSError):
            self._running = False
            return False

    def get_encoded_frame(self) -> Optional[Tuple[bool, bytes]]:
        try:
            return self._output_queue.get_nowait()
        except queue.Empty:
            return None

    def set_bitrate(self, bitrate_bps: int):
        """FFmpeg cannot change bitrate without restart. Log a warning."""
        logger.warning(
            f"FFmpeg backend requires restart to change bitrate. "
            f"Use GStreamer backend for seamless bitrate changes."
        )

    def _read_output(self):
        """Read H.264 NAL units from FFmpeg stdout and parse into access units."""
        buffer = bytearray()
        CHUNK = 65536
        while self._running and self._process and self._process.poll() is None:
            try:
                chunk = self._process.stdout.read(CHUNK)
                if not chunk:
                    break
                buffer.extend(chunk)
                self._parse_nalus(buffer)
            except Exception as e:
                if self._running:
                    logger.error(f"FFmpeg reader error: {e}")
                break

    def _parse_nalus(self, buf: bytearray):
        """Parse Annex B H.264 stream into access units (simplified)."""
        SC3 = b'\x00\x00\x01'
        SC4 = b'\x00\x00\x00\x01'

        while True:
            p4 = buf.find(SC4)
            p3 = buf.find(SC3)

            if p3 < 0 and p4 < 0:
                if len(buf) > 4:
                    del buf[:len(buf) - 4]
                return

            # First start code
            if p4 >= 0 and (p3 < 0 or p4 <= p3):
                fp, fl = p4, 4
            else:
                fp, fl = p3, 3

            # Second start code
            ss = fp + fl
            n3 = buf.find(SC3, ss)
            n4 = buf.find(SC4, ss)

            if n3 < 0 and n4 < 0:
                if len(buf) < 2 * 1024 * 1024:
                    return
                nalu = bytes(buf[fp + fl:])
                del buf[:]
                self._emit_nalu(nalu)
                return

            np_ = n4 if (n4 >= 0 and (n3 < 0 or n4 <= n3)) else n3
            nalu = bytes(buf[fp + fl:np_])
            del buf[:np_]

            if nalu:
                self._emit_nalu(nalu)

    _au_buf: list = []
    _au_key: bool = False

    def _emit_nalu(self, data: bytes):
        if not data:
            return
        nt = data[0] & 0x1F
        if nt == 7:  # SPS
            self._flush_au()
            self._au_buf = [data]
            self._au_key = True
        elif nt == 8:  # PPS
            self._au_buf.append(data)
        elif nt == 5:  # IDR
            self._au_buf.append(data)
            self._flush_au()
        elif nt == 1:  # non-IDR
            self._flush_au()
            self._au_buf = [data]
            self._au_key = False
            self._flush_au()

    def _flush_au(self):
        if not self._au_buf:
            return
        parts = []
        for nalu in self._au_buf:
            parts.append(b'\x00\x00\x00\x01')
            parts.append(nalu)
        data = b''.join(parts)
        is_key = self._au_key
        self._au_buf = []
        self._au_key = False

        try:
            self._output_queue.put_nowait((is_key, data))
        except queue.Full:
            try:
                self._output_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._output_queue.put_nowait((is_key, data))
            except queue.Full:
                pass

    @property
    def backend_name(self) -> str:
        return self._backend_name


# ---------------------------------------------------------------------------
# WebSocket Transport Server
# ---------------------------------------------------------------------------

class WebSocketTransport:
    """
    Async WebSocket server that broadcasts H.264 frames to connected clients.

    Protocol (binary messages):
        Byte 0:    Frame type (0x01 = keyframe, 0x02 = delta, 0x10 = codec config)
        Bytes 1-8: Timestamp (uint64, microseconds since epoch)
        Bytes 9+:  H.264 access unit data (Annex B format with start codes)

    Protocol (text messages -- JSON):
        Server -> Client:
            {"type": "codec_config", "codec": "avc1.XXYYZZ", "width": N, "height": N}
            {"type": "metrics", ...}
        Client -> Server:
            {"type": "ping", "t": <client_timestamp_ms>}
            {"type": "quality", "bitrate": <bps>}
    """

    FRAME_TYPE_KEYFRAME = 0x01
    FRAME_TYPE_DELTA = 0x02
    FRAME_TYPE_CONFIG = 0x10

    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self._clients: Set[websockets.WebSocketServerProtocol] = set()
        self._server = None
        self._codec_config: Optional[dict] = None
        self._on_quality_request: Optional[Callable] = None
        self._lock = asyncio.Lock()

    async def start(self):
        """Start the WebSocket server."""
        self._server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=20,
            ping_timeout=30,
            max_size=16 * 1024 * 1024,  # 16MB max message
            compression=None,  # No compression for binary H.264 data
        )
        logger.info(f"WebSocket server listening on ws://{self.host}:{self.port}")

    async def stop(self):
        """Stop the WebSocket server."""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        logger.info("WebSocket server stopped")

    def set_codec_config(self, config: dict):
        """Store codec config to send to newly connecting clients."""
        self._codec_config = config

    def set_quality_callback(self, callback: Callable):
        """Set callback for client quality/bitrate requests."""
        self._on_quality_request = callback

    async def broadcast_frame(self, is_keyframe: bool, data: bytes):
        """Send an encoded H.264 frame to all connected clients.

        Prepends an 9-byte header: [type(1), timestamp(8)]
        """
        if not self._clients:
            return

        frame_type = self.FRAME_TYPE_KEYFRAME if is_keyframe else self.FRAME_TYPE_DELTA
        ts_us = int(time.time() * 1_000_000)

        header = struct.pack(">BQ", frame_type, ts_us)
        message = header + data

        # Broadcast to all clients, remove dead connections
        dead = set()
        for ws in self._clients.copy():
            try:
                await ws.send(message)
            except websockets.ConnectionClosed:
                dead.add(ws)
            except Exception:
                dead.add(ws)

        if dead:
            self._clients -= dead

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def _handle_client(self, ws: websockets.WebSocketServerProtocol, path: str = ""):
        """Handle a new WebSocket client connection."""
        self._clients.add(ws)
        client_id = f"{ws.remote_address[0]}:{ws.remote_address[1]}"
        logger.info(f"Client connected: {client_id} (total: {len(self._clients)})")

        # Send codec config if available
        if self._codec_config:
            try:
                await ws.send(json.dumps({
                    "type": "codec_config",
                    **self._codec_config
                }))
            except Exception:
                pass

        try:
            async for message in ws:
                if isinstance(message, str):
                    try:
                        msg = json.loads(message)
                        msg_type = msg.get("type")

                        if msg_type == "ping":
                            await ws.send(json.dumps({
                                "type": "pong",
                                "t": msg.get("t"),
                                "server_t": int(time.time() * 1000)
                            }))
                        elif msg_type == "quality" and self._on_quality_request:
                            self._on_quality_request(msg)
                    except json.JSONDecodeError:
                        pass
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            logger.info(f"Client disconnected: {client_id} (total: {len(self._clients)})")


# ---------------------------------------------------------------------------
# Main GameStreamer API
# ---------------------------------------------------------------------------

class GameStreamer:
    """
    High-level API for streaming game frames to browsers.

    Wraps encoder (GStreamer or FFmpeg) + WebSocket transport into a simple
    interface for game developers.

    Usage:
        streamer = GameStreamer(width=1920, height=1080, fps=30)
        await streamer.start()

        # In your render loop:
        streamer.send_frame(bgra_numpy_array)

        # Adaptive quality:
        streamer.set_bitrate(6_000_000)

        # Get metrics:
        print(streamer.metrics.to_dict())

        await streamer.stop()
    """

    def __init__(
        self,
        width: int = 1920,
        height: int = 1080,
        fps: int = 30,
        codec: str = "h264",
        encoder: str = "auto",  # "auto", "gstreamer", "ffmpeg", "software"
        transport: str = "websocket",
        host: str = "0.0.0.0",
        port: int = 8765,
        bitrate: int = 8_000_000,
        gop_seconds: float = 2.0,
        on_client_connect: Optional[Callable] = None,
        on_client_disconnect: Optional[Callable] = None,
    ):
        self.width = width
        self.height = height
        self.fps = fps
        self.codec = codec
        self.bitrate = bitrate
        self.gop_seconds = gop_seconds

        self._encoder_pref = encoder
        self._encoder = None
        self._transport = WebSocketTransport(host, port)
        self._metrics = StreamerMetrics()
        self._running = False
        self._delivery_task: Optional[asyncio.Task] = None
        self._start_time = 0.0
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Codec config extracted from first keyframe
        self._codec_config: Optional[dict] = None
        self._codec_config_sent = False

        # Wire up quality callback
        self._transport.set_quality_callback(self._on_quality_request)

    async def start(self):
        """Initialize encoder and start WebSocket server."""
        self._loop = asyncio.get_event_loop()
        self._start_time = time.monotonic()

        # Initialize encoder
        self._encoder = self._create_encoder()
        if not self._encoder.start():
            raise RuntimeError(
                f"Failed to start encoder. Check logs for details. "
                f"Tried backend: {self._encoder_pref}"
            )
        self._metrics.encoder_backend = self._encoder.backend_name

        # Start WebSocket server
        await self._transport.start()

        # Start frame delivery loop
        self._running = True
        self._delivery_task = asyncio.create_task(self._delivery_loop())

        logger.info(
            f"GameStreamer started: {self.width}x{self.height}@{self.fps}fps, "
            f"backend={self._encoder.backend_name}, port={self._transport.port}"
        )

    async def stop(self):
        """Stop everything gracefully."""
        self._running = False

        if self._delivery_task:
            self._delivery_task.cancel()
            try:
                await self._delivery_task
            except asyncio.CancelledError:
                pass

        if self._encoder:
            self._encoder.stop()

        await self._transport.stop()
        logger.info("GameStreamer stopped")

    def send_frame(self, frame) -> bool:
        """Submit a frame for encoding and streaming.

        Args:
            frame: Can be:
                - numpy.ndarray (H, W, 4) BGRA uint8
                - bytes (raw BGRA, width * height * 4 bytes)
                - memoryview (raw BGRA)

        Returns:
            True if frame was accepted by the encoder.
        """
        t0 = time.monotonic()

        # Convert numpy array to bytes
        if isinstance(frame, np.ndarray):
            if frame.shape != (self.height, self.width, 4):
                logger.warning(
                    f"Frame shape mismatch: {frame.shape} != "
                    f"({self.height}, {self.width}, 4)"
                )
                return False
            frame_data = frame.tobytes()
        elif isinstance(frame, memoryview):
            frame_data = bytes(frame)
        elif isinstance(frame, bytes):
            frame_data = frame
        else:
            raise TypeError(f"Unsupported frame type: {type(frame)}")

        self._metrics.frames_submitted += 1

        success = self._encoder.encode_frame(frame_data)
        if success:
            elapsed_ms = (time.monotonic() - t0) * 1000
            self._metrics.record_encode(elapsed_ms)
            self._metrics.frames_encoded += 1
        else:
            self._metrics.frames_dropped += 1

        return success

    def set_bitrate(self, bitrate_bps: int):
        """Change encoder bitrate dynamically.

        With GStreamer backend: takes effect immediately, no pipeline restart.
        With FFmpeg backend: logs a warning (restart required).
        """
        self.bitrate = bitrate_bps
        if self._encoder:
            self._encoder.set_bitrate(bitrate_bps)

    def set_resolution(self, width: int, height: int):
        """Change resolution. Requires encoder restart.

        NOTE: Resolution changes always require a pipeline restart regardless
        of backend. This is a limitation of both NVENC and x264.
        """
        logger.warning(
            "Resolution change requires encoder restart. "
            "This will cause a brief interruption."
        )
        # TODO: Implement graceful resolution change with encoder restart

    @property
    def metrics(self) -> StreamerMetrics:
        self._metrics.clients_connected = self._transport.client_count
        self._metrics.uptime_seconds = time.monotonic() - self._start_time
        return self._metrics

    def _create_encoder(self):
        """Select and create the best available encoder backend."""
        pref = self._encoder_pref

        if pref == "auto":
            # Try GStreamer first, fall back to FFmpeg
            enc = GStreamerEncoder(
                self.width, self.height, self.fps, self.bitrate, self.gop_seconds
            )
            if enc._import_gstreamer():
                logger.info("Auto-selected GStreamer backend")
                return enc
            else:
                logger.info("GStreamer not available, trying FFmpeg...")
                enc = FFmpegEncoder(
                    self.width, self.height, self.fps, self.bitrate, use_gpu=True
                )
                return enc

        elif pref == "gstreamer":
            return GStreamerEncoder(
                self.width, self.height, self.fps, self.bitrate, self.gop_seconds
            )
        elif pref == "ffmpeg":
            return FFmpegEncoder(
                self.width, self.height, self.fps, self.bitrate, use_gpu=True
            )
        elif pref == "software":
            return FFmpegEncoder(
                self.width, self.height, self.fps, self.bitrate, use_gpu=False
            )
        else:
            raise ValueError(f"Unknown encoder: {pref}")

    async def _delivery_loop(self):
        """Continuously pull encoded frames from encoder and broadcast via WebSocket.

        Runs as an asyncio task. Polls the encoder's output queue at ~1ms intervals
        to minimize delivery latency.
        """
        while self._running:
            result = self._encoder.get_encoded_frame()
            if result is None:
                # No frame ready, yield to event loop briefly
                await asyncio.sleep(0.001)
                continue

            is_keyframe, data = result

            # Extract codec config from first keyframe
            if is_keyframe and not self._codec_config_sent:
                config = self._extract_codec_config(data)
                if config:
                    self._codec_config = config
                    self._transport.set_codec_config(config)
                    self._codec_config_sent = True

            # Broadcast to all WebSocket clients
            await self._transport.broadcast_frame(is_keyframe, data)

            self._metrics.frames_sent += 1
            self._metrics.record_frame_sent(len(data))

    def _extract_codec_config(self, h264_data: bytes) -> Optional[dict]:
        """Extract codec string from H.264 SPS in the access unit."""
        # Find SPS NAL unit (type 7) in the access unit
        sc4 = b'\x00\x00\x00\x01'
        pos = 0
        while pos < len(h264_data) - 4:
            if h264_data[pos:pos + 4] == sc4:
                nalu_type = h264_data[pos + 4] & 0x1F
                if nalu_type == 7 and pos + 7 < len(h264_data):
                    profile = h264_data[pos + 5]
                    compat = h264_data[pos + 6]
                    level = h264_data[pos + 7]
                    codec_str = f"avc1.{profile:02X}{compat:02X}{level:02X}"
                    return {
                        "codec": codec_str,
                        "width": self.width,
                        "height": self.height,
                    }
                pos += 4
            else:
                pos += 1
        return None

    def _on_quality_request(self, msg: dict):
        """Handle client quality/bitrate request."""
        bitrate = msg.get("bitrate")
        if bitrate and isinstance(bitrate, (int, float)):
            self.set_bitrate(int(bitrate))
