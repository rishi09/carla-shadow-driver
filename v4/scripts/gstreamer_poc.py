#!/usr/bin/env python3
"""
GStreamer NVENC Encoder PoC — In-process H.264 encoding without FFmpeg subprocess.

Proof of concept replacing the FFmpeg subprocess pipeline with GStreamer's
in-process nvh264enc element for encoding raw BGRA frames to H.264.

Pipeline:
  appsrc (BGRA) -> videoconvert (NV12) -> nvh264enc (H.264) -> h264parse -> appsink

Falls back to x264enc (software) when NVENC is unavailable (no GPU).

Usage:
    # Benchmark mode (no GPU needed for x264 fallback):
    python3 gstreamer_poc.py

    # With WebSocket streaming (bonus):
    python3 gstreamer_poc.py --serve

    # Compare with FFmpeg subprocess:
    python3 gstreamer_poc.py --compare

Requirements (Ubuntu 20.04+):
    apt-get install -y \
        gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-ugly \
        gstreamer1.0-tools \
        python3-gi \
        python3-gst-1.0 \
        gir1.2-gst-plugins-base-1.0

    # For NVENC (nvidia GPU required):
    # gstreamer1.0-plugins-bad includes nvcodec since GStreamer >= 1.18
    # Ubuntu 20.04 ships GStreamer 1.16 (NO nvcodec) -> need PPA or build
    # Ubuntu 22.04 ships GStreamer 1.20 (has nvcodec)
    # Alternatively: conda install -c conda-forge gstreamer gst-plugins-bad

    # For WebSocket streaming bonus:
    pip install websockets
"""
import argparse
import os
import struct
import subprocess
import sys
import threading
import time
import traceback
from collections import deque
from typing import Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# GStreamer import with graceful fallback
# ---------------------------------------------------------------------------
try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstApp', '1.0')
    from gi.repository import Gst, GstApp, GLib
    Gst.init(None)
    GST_AVAILABLE = True
except (ImportError, ValueError) as e:
    GST_AVAILABLE = False
    print(f"[gst-poc] GStreamer Python bindings not available: {e}")
    print("[gst-poc] Install: apt-get install python3-gi python3-gst-1.0 "
          "gstreamer1.0-plugins-base gstreamer1.0-plugins-bad")


# ---------------------------------------------------------------------------
# GStreamer Encoder
# ---------------------------------------------------------------------------
class GStreamerEncoder:
    """In-process H.264 encoder using GStreamer appsrc -> nvh264enc -> appsink.

    Eliminates FFmpeg subprocess IPC overhead by running the NVENC encoder
    inside the Python process via GStreamer's C library bindings (gi/PyGObject).
    """

    def __init__(self, width: int = 1920, height: int = 1080, fps: int = 30,
                 bitrate_kbps: int = 8000, force_software: bool = False):
        if not GST_AVAILABLE:
            raise RuntimeError("GStreamer not available")

        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate_kbps = bitrate_kbps
        self.force_software = force_software

        self._pipeline: Optional[Gst.Pipeline] = None
        self._appsrc: Optional[GstApp.AppSrc] = None
        self._appsink: Optional[GstApp.AppSink] = None
        self._encoder_element: Optional[Gst.Element] = None
        self._mainloop: Optional[GLib.MainLoop] = None
        self._mainloop_thread: Optional[threading.Thread] = None

        self._frames_encoded = 0
        self._encode_errors = 0
        self._encode_times: deque = deque(maxlen=300)
        self._using_nvenc = False
        self._codec_config: Optional[dict] = None
        self._running = False

        # Frame timing for PTS
        self._frame_duration_ns = int(1e9 / fps)  # nanoseconds per frame
        self._frame_count = 0

    @property
    def encoder_name(self) -> str:
        return "nvh264enc" if self._using_nvenc else "x264enc"

    def _check_nvenc_available(self) -> bool:
        """Check if GStreamer nvh264enc plugin is available."""
        if self.force_software:
            return False
        registry = Gst.Registry.get()
        factory = registry.find_feature("nvh264enc", Gst.ElementFactory.__gtype__)
        if factory is None:
            # Try the newer name (GStreamer 1.24+)
            factory = registry.find_feature("nvh264device0enc", Gst.ElementFactory.__gtype__)
        return factory is not None

    def _build_pipeline_string(self, use_nvenc: bool) -> str:
        """Build the GStreamer pipeline description string."""
        caps_in = (
            f"video/x-raw,format=BGRA,width={self.width},"
            f"height={self.height},framerate={self.fps}/1"
        )

        if use_nvenc:
            # NVIDIA NVENC hardware encoding path:
            # appsrc -> videoconvert (BGRA->NV12) -> nvh264enc -> h264parse -> appsink
            #
            # Key nvh264enc properties (matching Selkies-GStreamer best practices):
            #   preset=low-latency-hq  (quality + speed, or p4 on GStreamer 1.23+)
            #   rc-mode=cbr            (constant bitrate for streaming)
            #   bitrate=N              (kbps)
            #   gop-size=-1            (infinite GOP -> fewer keyframes -> lower latency)
            #   zerolatency=true       (no reordering delay)
            #   bframes=0              (no B-frames -> lower latency)
            #   aud=false              (no access unit delimiters -> smaller NALs)
            #   rc-lookahead=0         (no lookahead -> lower latency)
            #   vbv-buffer-size=N      (rate control buffer, ~1.5x frame budget)
            vbv = int((self.bitrate_kbps + self.fps - 1) / self.fps * 1.5)
            pipeline = (
                f"appsrc name=src emit-signals=false is-live=true "
                f"  format=GST_FORMAT_TIME block=true max-bytes=0 "
                f"  caps=\"{caps_in}\" "
                f"! videoconvert "
                f"! video/x-raw,format=NV12 "
                f"! nvh264enc name=encoder "
                f"    preset=low-latency-hq "
                f"    rc-mode=cbr "
                f"    bitrate={self.bitrate_kbps} "
                f"    gop-size=60 "
                f"    zerolatency=true "
                f"    bframes=0 "
                f"    aud=false "
                f"    rc-lookahead=0 "
                f"    vbv-buffer-size={vbv} "
                f"! h264parse config-interval=-1 "
                f"! appsink name=sink emit-signals=false sync=false "
                f"    max-buffers=2 drop=true"
            )
        else:
            # Software x264enc fallback:
            # appsrc -> videoconvert (BGRA->I420) -> x264enc -> h264parse -> appsink
            pipeline = (
                f"appsrc name=src emit-signals=false is-live=true "
                f"  format=GST_FORMAT_TIME block=true max-bytes=0 "
                f"  caps=\"{caps_in}\" "
                f"! videoconvert "
                f"! video/x-raw,format=I420 "
                f"! x264enc name=encoder "
                f"    speed-preset=ultrafast "
                f"    tune=zerolatency "
                f"    bitrate={self.bitrate_kbps} "
                f"    key-int-max=60 "
                f"    bframes=0 "
                f"    byte-stream=true "
                f"    sliced-threads=true "
                f"! h264parse config-interval=-1 "
                f"! appsink name=sink emit-signals=false sync=false "
                f"    max-buffers=2 drop=true"
            )

        return pipeline

    def start(self) -> bool:
        """Start the GStreamer encoding pipeline.

        Returns True if the pipeline started successfully.
        """
        if self._running:
            return True

        use_nvenc = self._check_nvenc_available()
        if use_nvenc:
            print("[gst-enc] NVENC available, using hardware encoding")
        else:
            if not self.force_software:
                print("[gst-enc] NVENC not available, falling back to x264enc (software)")
            else:
                print("[gst-enc] Software encoding forced (x264enc)")

        pipeline_str = self._build_pipeline_string(use_nvenc)
        print(f"[gst-enc] Pipeline: {pipeline_str[:120]}...")

        try:
            self._pipeline = Gst.parse_launch(pipeline_str)
        except GLib.GError as e:
            if use_nvenc:
                print(f"[gst-enc] NVENC pipeline failed ({e}), trying x264enc fallback")
                pipeline_str = self._build_pipeline_string(use_nvenc=False)
                try:
                    self._pipeline = Gst.parse_launch(pipeline_str)
                    use_nvenc = False
                except GLib.GError as e2:
                    print(f"[gst-enc] x264enc pipeline also failed: {e2}")
                    return False
            else:
                print(f"[gst-enc] Pipeline creation failed: {e}")
                return False

        self._using_nvenc = use_nvenc

        # Get element references
        self._appsrc = self._pipeline.get_by_name("src")
        self._appsink = self._pipeline.get_by_name("sink")
        self._encoder_element = self._pipeline.get_by_name("encoder")

        if not self._appsrc or not self._appsink:
            print("[gst-enc] Failed to get appsrc/appsink elements")
            return False

        # Start the GLib main loop in a background thread
        # (needed for GStreamer bus messages and state changes)
        self._mainloop = GLib.MainLoop()
        self._mainloop_thread = threading.Thread(
            target=self._mainloop.run, daemon=True, name="gst-mainloop"
        )
        self._mainloop_thread.start()

        # Set pipeline to PLAYING
        ret = self._pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("[gst-enc] Failed to set pipeline to PLAYING")
            self._mainloop.quit()
            return False

        self._running = True
        self._frame_count = 0
        print(f"[gst-enc] Pipeline started ({self.width}x{self.height} "
              f"@ {self.fps}fps, {self.bitrate_kbps}kbps, "
              f"encoder={self.encoder_name})")
        return True

    def stop(self):
        """Stop the GStreamer pipeline and clean up."""
        if not self._running:
            return

        self._running = False

        if self._appsrc:
            self._appsrc.end_of_stream()

        if self._pipeline:
            self._pipeline.set_state(Gst.State.NULL)

        if self._mainloop:
            self._mainloop.quit()

        if self._mainloop_thread:
            self._mainloop_thread.join(timeout=2)

        self._pipeline = None
        self._appsrc = None
        self._appsink = None
        self._encoder_element = None
        self._mainloop = None
        self._mainloop_thread = None

        print(f"[gst-enc] Pipeline stopped (encoded {self._frames_encoded} frames, "
              f"{self._encode_errors} errors)")

    def encode_frame(self, raw_bgra: bytes) -> Optional[Tuple[bool, bytes]]:
        """Encode a single BGRA frame and return the H.264 access unit.

        Unlike the FFmpeg subprocess approach which uses separate encode/get
        calls with a queue, this is synchronous: push frame in, pull encoded
        data out, in the same call. This eliminates the queue and reader thread.

        Args:
            raw_bgra: Raw BGRA pixel data (width * height * 4 bytes).

        Returns:
            (is_keyframe, h264_data) tuple, or None if encoding failed.
        """
        if not self._running or not self._appsrc:
            return None

        expected_size = self.width * self.height * 4
        if len(raw_bgra) != expected_size:
            self._encode_errors += 1
            return None

        t0 = time.monotonic()

        # Create GStreamer buffer from raw bytes
        buf = Gst.Buffer.new_wrapped(raw_bgra)

        # Set PTS (presentation timestamp) so the encoder knows frame timing
        pts = self._frame_count * self._frame_duration_ns
        buf.pts = pts
        buf.dts = pts
        buf.duration = self._frame_duration_ns
        self._frame_count += 1

        # Push buffer into the pipeline
        ret = self._appsrc.push_buffer(buf)
        if ret != Gst.FlowReturn.OK:
            self._encode_errors += 1
            return None

        # Pull the encoded sample from appsink (blocking with timeout)
        sample = self._appsink.try_pull_sample(Gst.SECOND)  # 1 second timeout
        if sample is None:
            # No encoded frame available yet (can happen on first frame)
            return None

        # Extract encoded H.264 bytes from the sample
        gst_buffer = sample.get_buffer()
        success, map_info = gst_buffer.map(Gst.MapFlags.READ)
        if not success:
            self._encode_errors += 1
            return None

        h264_data = bytes(map_info.data)
        gst_buffer.unmap(map_info)

        # Determine if this is a keyframe by checking NAL unit types
        is_keyframe = self._check_keyframe(h264_data)

        # Extract codec config from first keyframe
        if is_keyframe and self._codec_config is None:
            self._extract_codec_config(h264_data)

        t1 = time.monotonic()
        encode_ms = (t1 - t0) * 1000
        self._encode_times.append(encode_ms)
        self._frames_encoded += 1

        return (is_keyframe, h264_data)

    def set_bitrate(self, bitrate_kbps: int):
        """Dynamically change encoder bitrate without restarting.

        GStreamer allows changing element properties on a running pipeline,
        unlike FFmpeg subprocess which requires a full restart.
        """
        if not self._encoder_element:
            return

        self.bitrate_kbps = bitrate_kbps
        try:
            self._encoder_element.set_property("bitrate", bitrate_kbps)
            print(f"[gst-enc] Bitrate changed to {bitrate_kbps} kbps (no restart needed)")
        except Exception as e:
            print(f"[gst-enc] Failed to change bitrate: {e}")

    def force_keyframe(self):
        """Force the encoder to produce a keyframe on the next frame.

        Uses GStreamer's force-keyunit event, which is cleaner than
        restarting the FFmpeg subprocess.
        """
        if not self._encoder_element:
            return

        event = Gst.Event.new_custom(
            Gst.EventType.CUSTOM_DOWNSTREAM,
            Gst.Structure.new_from_string(
                "GstForceKeyUnit, all-headers=true"
            )
        )
        self._encoder_element.send_event(event)

    def _check_keyframe(self, h264_data: bytes) -> bool:
        """Check if H.264 data contains a keyframe (IDR NAL unit type 5)."""
        # Scan for NAL start codes and check types
        i = 0
        while i < len(h264_data) - 4:
            # 4-byte start code
            if h264_data[i:i+4] == b'\x00\x00\x00\x01':
                nal_type = h264_data[i+4] & 0x1F
                if nal_type == 5:  # IDR slice
                    return True
                i += 4
            # 3-byte start code
            elif h264_data[i:i+3] == b'\x00\x00\x01':
                nal_type = h264_data[i+3] & 0x1F
                if nal_type == 5:
                    return True
                i += 3
            else:
                i += 1
        return False

    def _extract_codec_config(self, h264_data: bytes):
        """Extract SPS/PPS and build avc1 codec string from keyframe data."""
        i = 0
        sps_data = None
        while i < len(h264_data) - 4:
            if h264_data[i:i+4] == b'\x00\x00\x00\x01':
                nal_type = h264_data[i+4] & 0x1F
                if nal_type == 7 and len(h264_data) > i + 7:  # SPS
                    sps_data = h264_data[i+4:]
                    # Find end of SPS (next start code)
                    for j in range(5, len(h264_data) - i - 3):
                        if h264_data[i+4+j:i+4+j+3] == b'\x00\x00\x01' or \
                           h264_data[i+4+j:i+4+j+4] == b'\x00\x00\x00\x01':
                            sps_data = h264_data[i+4:i+4+j]
                            break
                    break
                i += 4
            elif h264_data[i:i+3] == b'\x00\x00\x01':
                i += 3
            else:
                i += 1

        if sps_data and len(sps_data) >= 4:
            profile_idc = sps_data[1]
            constraint_flags = sps_data[2]
            level_idc = sps_data[3]
            codec_string = f"avc1.{profile_idc:02X}{constraint_flags:02X}{level_idc:02X}"
            self._codec_config = {
                'codec': codec_string,
                'width': self.width,
                'height': self.height,
            }
            print(f"[gst-enc] Codec config: {codec_string}")

    def get_stats(self) -> dict:
        """Return encoder performance statistics."""
        times = list(self._encode_times)
        avg_ms = sum(times) / len(times) if times else 0
        p95_ms = sorted(times)[int(len(times) * 0.95)] if times else 0
        p99_ms = sorted(times)[int(len(times) * 0.99)] if times else 0
        max_ms = max(times) if times else 0
        min_ms = min(times) if times else 0

        return {
            'encoder': self.encoder_name,
            'frames_encoded': self._frames_encoded,
            'errors': self._encode_errors,
            'avg_encode_ms': round(avg_ms, 2),
            'p95_encode_ms': round(p95_ms, 2),
            'p99_encode_ms': round(p99_ms, 2),
            'min_encode_ms': round(min_ms, 2),
            'max_encode_ms': round(max_ms, 2),
            'codec_config': self._codec_config,
        }


# ---------------------------------------------------------------------------
# FFmpeg subprocess encoder (for comparison benchmark)
# ---------------------------------------------------------------------------
class FFmpegSubprocessEncoder:
    """Minimal FFmpeg subprocess encoder matching our current nvenc_encoder.py."""

    def __init__(self, width: int = 1920, height: int = 1080, fps: int = 30,
                 bitrate_kbps: int = 8000, force_software: bool = False):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate_kbps = bitrate_kbps
        self.force_software = force_software

        self._process: Optional[subprocess.Popen] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False
        self._frame_queue = deque(maxlen=30)
        self._queue_lock = threading.Lock()
        self._frame_event = threading.Event()

        self._frames_encoded = 0
        self._encode_errors = 0
        self._encode_times: deque = deque(maxlen=300)
        self._using_nvenc = False

    @property
    def encoder_name(self) -> str:
        return "h264_nvenc" if self._using_nvenc else "libx264"

    def _check_nvenc(self) -> bool:
        """Check if FFmpeg h264_nvenc is available."""
        if self.force_software:
            return False
        try:
            result = subprocess.run(
                ['ffmpeg', '-hide_banner', '-encoders'],
                capture_output=True, text=True, timeout=5
            )
            return 'h264_nvenc' in result.stdout
        except Exception:
            return False

    def start(self) -> bool:
        if self._running:
            return True

        use_nvenc = self._check_nvenc()
        self._using_nvenc = use_nvenc
        codec = 'h264_nvenc' if use_nvenc else 'libx264'
        bitrate_str = f'{self.bitrate_kbps}k'

        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-f', 'rawvideo', '-pix_fmt', 'bgra',
            '-s', f'{self.width}x{self.height}',
            '-r', str(self.fps),
            '-i', 'pipe:0',
            '-c:v', codec,
        ]

        if use_nvenc:
            cmd += ['-preset', 'p1', '-tune', 'ull', '-rc', 'cbr',
                    '-b:v', bitrate_str, '-bf', '0', '-rc-lookahead', '0',
                    '-zerolatency', '1', '-g', '60']
        else:
            cmd += ['-preset', 'ultrafast', '-tune', 'zerolatency',
                    '-b:v', bitrate_str, '-bf', '0', '-g', '60']

        cmd += ['-f', 'h264', 'pipe:1']

        try:
            self._process = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, bufsize=0
            )
        except FileNotFoundError:
            print("[ffmpeg] FFmpeg not found")
            return False

        time.sleep(0.2)
        if self._process.poll() is not None:
            stderr = self._process.stderr.read().decode(errors='replace')
            print(f"[ffmpeg] FFmpeg exited: {stderr[:300]}")
            return False

        self._running = True
        self._reader_thread = threading.Thread(
            target=self._read_output, daemon=True, name='ffmpeg-reader'
        )
        self._reader_thread.start()

        print(f"[ffmpeg] Encoder started ({self.width}x{self.height} "
              f"@ {self.fps}fps, {self.bitrate_kbps}kbps, codec={codec})")
        return True

    def stop(self):
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
        if self._reader_thread:
            self._reader_thread.join(timeout=2)

    def encode_frame(self, raw_bgra: bytes) -> Optional[Tuple[bool, bytes]]:
        """Encode frame via FFmpeg subprocess. Returns (is_keyframe, data) or None."""
        if not self._running or not self._process:
            return None

        t0 = time.monotonic()

        try:
            self._process.stdin.write(raw_bgra)
            self._process.stdin.flush()
        except (BrokenPipeError, OSError):
            self._encode_errors += 1
            return None

        self._frames_encoded += 1

        # Wait for encoded output (with timeout)
        self._frame_event.clear()
        self._frame_event.wait(timeout=0.5)

        with self._queue_lock:
            if self._frame_queue:
                result = self._frame_queue.popleft()
            else:
                result = None

        t1 = time.monotonic()
        self._encode_times.append((t1 - t0) * 1000)

        return result

    def _read_output(self):
        """Reader thread: parse NAL units from FFmpeg stdout."""
        stdout = self._process.stdout
        buffer = bytearray()
        CHUNK = 65536

        while self._running and self._process and self._process.poll() is None:
            try:
                chunk = stdout.read1(CHUNK) if hasattr(stdout, 'read1') else stdout.read(CHUNK)
                if not chunk:
                    break
                buffer.extend(chunk)
                self._parse_and_emit(buffer)
            except Exception:
                break

    def _parse_and_emit(self, buffer: bytearray):
        """Simple NAL parser: find access unit boundaries and emit."""
        SC4 = b'\x00\x00\x00\x01'
        while True:
            pos = buffer.find(SC4)
            if pos < 0:
                break
            next_pos = buffer.find(SC4, pos + 4)
            if next_pos < 0:
                if len(buffer) > 2 * 1024 * 1024:
                    data = bytes(buffer[pos:])
                    buffer.clear()
                    is_kf = self._has_idr(data)
                    with self._queue_lock:
                        self._frame_queue.append((is_kf, data))
                    self._frame_event.set()
                break

            # Check if next NALU is start of new AU (SPS or non-IDR slice)
            nal_type = buffer[next_pos + 4] & 0x1F if next_pos + 4 < len(buffer) else 0
            if nal_type in (1, 7):  # non-IDR slice or SPS = new AU boundary
                data = bytes(buffer[pos:next_pos])
                del buffer[:next_pos]
                is_kf = self._has_idr(data)
                with self._queue_lock:
                    self._frame_queue.append((is_kf, data))
                self._frame_event.set()
            else:
                # PPS, SEI, etc. -- part of same AU, keep accumulating
                # Advance past this start code to find the real next AU
                next_next = buffer.find(SC4, next_pos + 4)
                if next_next < 0:
                    break
                # Continue scanning
                continue

    def _has_idr(self, data: bytes) -> bool:
        i = 0
        while i < len(data) - 4:
            if data[i:i+4] == b'\x00\x00\x00\x01':
                if (data[i+4] & 0x1F) == 5:
                    return True
                i += 4
            else:
                i += 1
        return False

    def get_stats(self) -> dict:
        times = list(self._encode_times)
        avg_ms = sum(times) / len(times) if times else 0
        p95_ms = sorted(times)[int(len(times) * 0.95)] if times else 0
        return {
            'encoder': self.encoder_name,
            'frames_encoded': self._frames_encoded,
            'errors': self._encode_errors,
            'avg_encode_ms': round(avg_ms, 2),
            'p95_encode_ms': round(p95_ms, 2),
            'min_encode_ms': round(min(times), 2) if times else 0,
            'max_encode_ms': round(max(times), 2) if times else 0,
        }


# ---------------------------------------------------------------------------
# Synthetic frame generator (simulates CARLA sensor output)
# ---------------------------------------------------------------------------
def generate_synthetic_frame(width: int, height: int, frame_num: int) -> bytes:
    """Generate a synthetic BGRA frame with moving patterns.

    Creates visually varying frames that stress the encoder (not just
    static/black frames which compress trivially).
    """
    # Create a frame with a moving gradient + noise
    # This simulates a driving scene better than solid colors
    frame = np.zeros((height, width, 4), dtype=np.uint8)

    # Moving horizontal gradient (simulates road moving)
    offset = (frame_num * 5) % width
    x = np.arange(width, dtype=np.float32)
    gradient = ((x + offset) % width * 255 / width).astype(np.uint8)
    frame[:, :, 0] = gradient  # Blue channel
    frame[:, :, 1] = np.roll(gradient, width // 3)  # Green
    frame[:, :, 2] = np.roll(gradient, 2 * width // 3)  # Red
    frame[:, :, 3] = 255  # Alpha

    # Add some per-frame variation (simulates scene changes)
    noise_band = frame_num % height
    frame[noise_band:noise_band+10, :, :3] = np.random.randint(
        0, 255, (min(10, height - noise_band), width, 3), dtype=np.uint8
    )

    return frame.tobytes()


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------
def run_benchmark(encoder, name: str, num_frames: int = 150,
                  width: int = 1920, height: int = 1080) -> dict:
    """Run encoding benchmark and return statistics."""
    print(f"\n{'='*60}")
    print(f"  Benchmark: {name}")
    print(f"  {width}x{height} @ {num_frames} frames")
    print(f"{'='*60}")

    if not encoder.start():
        print(f"  FAILED to start {name}")
        return {'name': name, 'error': 'Failed to start'}

    encoded_sizes = []
    keyframe_count = 0
    total_t0 = time.monotonic()

    for i in range(num_frames):
        frame = generate_synthetic_frame(width, height, i)
        result = encoder.encode_frame(frame)

        if result is not None:
            is_kf, data = result
            encoded_sizes.append(len(data))
            if is_kf:
                keyframe_count += 1
        elif i > 5:
            # Allow first few frames to warm up
            pass

        # Progress
        if (i + 1) % 30 == 0:
            stats = encoder.get_stats()
            print(f"  Frame {i+1}/{num_frames}: "
                  f"avg={stats['avg_encode_ms']:.1f}ms, "
                  f"p95={stats['p95_encode_ms']:.1f}ms")

    total_elapsed = time.monotonic() - total_t0
    encoder.stop()

    stats = encoder.get_stats()
    avg_size = sum(encoded_sizes) / len(encoded_sizes) if encoded_sizes else 0
    effective_bitrate = (sum(encoded_sizes) * 8) / total_elapsed / 1000 if total_elapsed > 0 else 0
    throughput_fps = stats['frames_encoded'] / total_elapsed if total_elapsed > 0 else 0

    result = {
        'name': name,
        'encoder': stats.get('encoder', 'unknown'),
        'total_time_s': round(total_elapsed, 2),
        'frames_encoded': stats['frames_encoded'],
        'frames_received': len(encoded_sizes),
        'errors': stats['errors'],
        'throughput_fps': round(throughput_fps, 1),
        'avg_encode_ms': stats['avg_encode_ms'],
        'p95_encode_ms': stats['p95_encode_ms'],
        'min_encode_ms': stats.get('min_encode_ms', 0),
        'max_encode_ms': stats.get('max_encode_ms', 0),
        'avg_frame_size_bytes': round(avg_size),
        'effective_bitrate_kbps': round(effective_bitrate),
        'keyframes': keyframe_count,
    }

    print(f"\n  Results:")
    print(f"    Encoder:          {result['encoder']}")
    print(f"    Throughput:       {result['throughput_fps']} fps")
    print(f"    Avg encode time:  {result['avg_encode_ms']} ms")
    print(f"    P95 encode time:  {result['p95_encode_ms']} ms")
    print(f"    Min/Max encode:   {result['min_encode_ms']}/{result['max_encode_ms']} ms")
    print(f"    Avg frame size:   {result['avg_frame_size_bytes']} bytes")
    print(f"    Effective bitrate:{result['effective_bitrate_kbps']} kbps")
    print(f"    Keyframes:        {result['keyframes']}")
    print(f"    Errors:           {result['errors']}")

    return result


# ---------------------------------------------------------------------------
# WebSocket streaming server (bonus)
# ---------------------------------------------------------------------------
WS_HTML_PAGE = """<!DOCTYPE html>
<html>
<head><title>GStreamer PoC - WebCodecs H.264 Viewer</title></head>
<body style="background:#111;color:#eee;font-family:monospace;margin:0;display:flex;flex-direction:column;align-items:center;">
<h2>GStreamer PoC - H.264 via WebSocket + WebCodecs</h2>
<canvas id="canvas" width="1920" height="1080" style="max-width:95vw;border:1px solid #333;"></canvas>
<div id="stats" style="margin-top:10px;font-size:14px;">Connecting...</div>
<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');
let frameCount = 0, lastTime = performance.now(), fps = 0;

const ws = new WebSocket(location.href.replace('http','ws').replace(/\\/$/, '') + '/ws');
ws.binaryType = 'arraybuffer';

let decoder = null;
let codecConfigured = false;

ws.onmessage = async (event) => {
    if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'codec_config') {
            decoder = new VideoDecoder({
                output: (frame) => {
                    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                    frame.close();
                    frameCount++;
                    const now = performance.now();
                    if (now - lastTime > 1000) {
                        fps = frameCount / ((now - lastTime) / 1000);
                        statsEl.textContent = `FPS: ${fps.toFixed(1)} | Codec: ${msg.codec}`;
                        frameCount = 0;
                        lastTime = now;
                    }
                },
                error: (e) => console.error('Decode error:', e),
            });
            decoder.configure({
                codec: msg.codec,
                codedWidth: msg.width,
                codedHeight: msg.height,
                hardwareAcceleration: 'prefer-hardware',
            });
            codecConfigured = true;
        }
    } else if (codecConfigured && decoder) {
        const data = new Uint8Array(event.data);
        // First byte: 1=keyframe, 0=delta
        const isKey = data[0] === 1;
        const h264Data = data.slice(1);
        try {
            decoder.decode(new EncodedVideoChunk({
                type: isKey ? 'key' : 'delta',
                timestamp: performance.now() * 1000,
                data: h264Data,
            }));
        } catch(e) { console.error('Chunk error:', e); }
    }
};
ws.onopen = () => statsEl.textContent = 'Connected, waiting for codec config...';
ws.onerror = (e) => statsEl.textContent = 'WebSocket error: ' + e;
ws.onclose = () => statsEl.textContent = 'Disconnected';
</script>
</body>
</html>
"""


async def run_ws_server(host='0.0.0.0', port=8766, width=1920, height=1080,
                        fps=30, bitrate_kbps=8000):
    """Run a WebSocket server that streams GStreamer-encoded H.264 to browsers."""
    try:
        import websockets
        from websockets.server import serve
    except ImportError:
        print("[ws] Install websockets: pip install websockets")
        return

    if not GST_AVAILABLE:
        print("[ws] GStreamer not available, cannot serve")
        return

    import json
    import asyncio
    from http import HTTPStatus

    encoder = GStreamerEncoder(width=width, height=height, fps=fps,
                               bitrate_kbps=bitrate_kbps)
    if not encoder.start():
        print("[ws] Failed to start encoder")
        return

    clients = set()

    async def handler(websocket, path=None):
        # Serve HTML page for HTTP requests
        if hasattr(websocket, 'request') and websocket.request:
            if not path or path == '/' or path == '':
                # This is handled by process_request below
                pass

        clients.add(websocket)
        print(f"[ws] Client connected ({len(clients)} total)")

        # Send codec config
        if encoder._codec_config:
            await websocket.send(json.dumps({
                'type': 'codec_config',
                **encoder._codec_config,
            }))

        try:
            async for msg in websocket:
                pass  # Client doesn't send anything meaningful
        finally:
            clients.discard(websocket)
            print(f"[ws] Client disconnected ({len(clients)} total)")

    async def process_request(path, request_headers):
        """Serve the HTML page for non-WebSocket HTTP requests."""
        if path == '/' or path == '':
            return (HTTPStatus.OK, [('Content-Type', 'text/html')],
                    WS_HTML_PAGE.encode())
        return None

    # Frame generation + streaming loop
    async def stream_frames():
        frame_interval = 1.0 / fps
        frame_num = 0
        codec_sent = set()

        while True:
            t0 = time.monotonic()

            frame = generate_synthetic_frame(width, height, frame_num)
            result = encoder.encode_frame(frame)
            frame_num += 1

            if result and clients:
                is_kf, h264_data = result

                # Send codec config to new clients
                if encoder._codec_config:
                    for client in clients - codec_sent:
                        try:
                            await client.send(json.dumps({
                                'type': 'codec_config',
                                **encoder._codec_config,
                            }))
                            codec_sent.add(client)
                        except Exception:
                            pass

                # Send frame: [1-byte keyframe flag] + [h264 data]
                msg = bytes([1 if is_kf else 0]) + h264_data
                dead = set()
                for client in clients:
                    try:
                        await client.send(msg)
                    except Exception:
                        dead.add(client)
                clients -= dead
                codec_sent -= dead

            elapsed = time.monotonic() - t0
            sleep_time = max(0, frame_interval - elapsed)
            await asyncio.sleep(sleep_time)

    print(f"[ws] Starting WebSocket server on ws://{host}:{port}")
    print(f"[ws] Open http://localhost:{port}/ in a browser to view")

    try:
        async with serve(handler, host, port,
                         process_request=process_request) as server:
            await stream_frames()
    except Exception as e:
        print(f"[ws] Server error: {e}")
    finally:
        encoder.stop()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description='GStreamer NVENC Encoder PoC',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--compare', action='store_true',
                        help='Compare GStreamer vs FFmpeg subprocess encoders')
    parser.add_argument('--serve', action='store_true',
                        help='Start WebSocket server streaming to browser')
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--bitrate', type=int, default=8000,
                        help='Bitrate in kbps')
    parser.add_argument('--frames', type=int, default=150,
                        help='Number of frames to benchmark')
    parser.add_argument('--software', action='store_true',
                        help='Force software encoding (no NVENC)')
    parser.add_argument('--port', type=int, default=8766,
                        help='WebSocket server port (for --serve)')

    args = parser.parse_args()

    if args.serve:
        import asyncio
        asyncio.run(run_ws_server(
            port=args.port, width=args.width, height=args.height,
            fps=args.fps, bitrate_kbps=args.bitrate
        ))
        return

    results = []

    # GStreamer benchmark
    if GST_AVAILABLE:
        gst_enc = GStreamerEncoder(
            width=args.width, height=args.height, fps=args.fps,
            bitrate_kbps=args.bitrate, force_software=args.software
        )
        result = run_benchmark(gst_enc, "GStreamer (in-process)",
                               num_frames=args.frames,
                               width=args.width, height=args.height)
        results.append(result)
    else:
        print("\n[SKIP] GStreamer benchmark (not installed)")

    # FFmpeg subprocess benchmark (comparison)
    if args.compare:
        ffmpeg_enc = FFmpegSubprocessEncoder(
            width=args.width, height=args.height, fps=args.fps,
            bitrate_kbps=args.bitrate, force_software=args.software
        )
        result = run_benchmark(ffmpeg_enc, "FFmpeg (subprocess)",
                               num_frames=args.frames,
                               width=args.width, height=args.height)
        results.append(result)

    # Comparison summary
    if len(results) > 1:
        print(f"\n{'='*60}")
        print(f"  COMPARISON SUMMARY")
        print(f"{'='*60}")
        print(f"{'Metric':<25} {'GStreamer':<20} {'FFmpeg':<20}")
        print(f"{'-'*65}")

        gst_r = results[0]
        ffmpeg_r = results[1]

        for key in ['encoder', 'throughput_fps', 'avg_encode_ms', 'p95_encode_ms',
                     'min_encode_ms', 'max_encode_ms', 'avg_frame_size_bytes',
                     'effective_bitrate_kbps', 'errors']:
            gv = gst_r.get(key, 'N/A')
            fv = ffmpeg_r.get(key, 'N/A')
            print(f"  {key:<23} {str(gv):<20} {str(fv):<20}")

        # Highlight winner
        if gst_r.get('avg_encode_ms', 999) < ffmpeg_r.get('avg_encode_ms', 999):
            speedup = ffmpeg_r['avg_encode_ms'] / gst_r['avg_encode_ms'] if gst_r['avg_encode_ms'] > 0 else 0
            print(f"\n  >> GStreamer is {speedup:.1f}x faster (avg encode time)")
        else:
            speedup = gst_r['avg_encode_ms'] / ffmpeg_r['avg_encode_ms'] if ffmpeg_r['avg_encode_ms'] > 0 else 0
            print(f"\n  >> FFmpeg is {speedup:.1f}x faster (avg encode time)")

    elif len(results) == 1:
        print(f"\n  Run with --compare to see GStreamer vs FFmpeg side-by-side")


if __name__ == '__main__':
    main()
