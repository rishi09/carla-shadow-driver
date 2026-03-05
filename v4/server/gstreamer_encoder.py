"""
GStreamer NVENC H.264 Encoder — In-process hardware video encoding via GStreamer.

Drop-in replacement for NVENCEncoder (nvenc_encoder.py) that uses GStreamer's
in-process nvh264enc element instead of an FFmpeg subprocess. Same public API:
start(), encode_frame(), get_encoded_frame(), set_bitrate(), stop(), get_stats(),
codec_config property, wait_for_codec_config(), is_running property.

Key advantages over the FFmpeg subprocess approach:
  - Instant bitrate changes via set_property("bitrate", kbps) — no subprocess restart
  - No IPC overhead (no pipe writes, no stdout parsing, no NAL reassembly)
  - Force keyframe via GStreamer event (no subprocess restart)
  - In-process memory: frames stay in Python address space

Pipeline:
  appsrc (BGRA) -> videoconvert (NV12) -> nvh264enc (H.264) -> h264parse -> appsink

Falls back to x264enc (software) when NVENC is unavailable (no GPU / no nvcodec plugin).

GStreamer version requirements:
  - GStreamer >= 1.18 for nvcodec plugin (nvh264enc)
  - Ubuntu 20.04 ships GStreamer 1.16 (NO nvcodec) — needs PPA or conda
  - Ubuntu 22.04+ ships GStreamer 1.20+ (has nvcodec)
  - The Docker image (carlasim/carla:0.9.15, Ubuntu 18.04) does NOT include GStreamer.
    To use this encoder, add to Dockerfile:
      RUN apt-get update && apt-get install -y \\
          gstreamer1.0-plugins-base gstreamer1.0-plugins-good \\
          gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly \\
          gstreamer1.0-tools python3-gi python3-gst-1.0 \\
          gir1.2-gst-plugins-base-1.0
    Or use conda: conda install -c conda-forge gstreamer gst-plugins-bad pygobject

Usage:
    from gstreamer_encoder import GStreamerNVENCEncoder

    encoder = GStreamerNVENCEncoder(width=1920, height=1080, fps=30, bitrate='8M')
    encoder.start()
    encoder.encode_frame(raw_bgra_bytes)        # non-blocking push
    result = encoder.get_encoded_frame()          # non-blocking pull -> (is_keyframe, data) or None
    encoder.set_bitrate('6M')                     # instant, no restart
    encoder.force_keyframe()                      # force IDR on next frame
    encoder.stop()
"""
import queue
import threading
import time
from collections import deque
from typing import Optional, Tuple

# ---------------------------------------------------------------------------
# GStreamer import with graceful fallback
# ---------------------------------------------------------------------------
_GST_AVAILABLE = False
_GST_IMPORT_ERROR = None

try:
    import gi
    gi.require_version('Gst', '1.0')
    gi.require_version('GstApp', '1.0')
    from gi.repository import Gst, GstApp, GLib
    Gst.init(None)
    _GST_AVAILABLE = True
except (ImportError, ValueError) as e:
    _GST_IMPORT_ERROR = str(e)


def _parse_bitrate_string(bitrate_str: str) -> int:
    """Convert a bitrate string like '8M', '500k', '12M' to kbps (int).

    Examples:
        '8M'  -> 8000
        '12M' -> 12000
        '6.4M' -> 6400
        '500k' -> 500
        '2500' -> 2500 (assumed bps, converted: 2500 / 1000 -> 2)
    """
    s = bitrate_str.strip()
    if s.upper().endswith('M'):
        return int(float(s[:-1]) * 1000)
    elif s.upper().endswith('K'):
        return int(float(s[:-1]))
    else:
        # Assume bits per second, convert to kbps
        return int(float(s) / 1000)


def _kbps_to_bitrate_string(kbps: int) -> str:
    """Convert kbps integer back to a bitrate string like '8M' or '500k'.

    Examples:
        8000  -> '8M'
        12000 -> '12M'
        6400  -> '6.4M'
        500   -> '500k'
    """
    if kbps >= 1000 and kbps % 1000 == 0:
        return f'{kbps // 1000}M'
    elif kbps >= 1000:
        return f'{kbps / 1000:.1f}M'
    else:
        return f'{kbps}k'


class GStreamerNVENCEncoder:
    """In-process NVENC H.264 encoder via GStreamer — drop-in replacement for NVENCEncoder.

    Maintains the same public API as nvenc_encoder.NVENCEncoder:
      - Constructor: (width, height, fps, bitrate) where bitrate is a string like '8M'
      - start() -> bool
      - stop()
      - encode_frame(raw_bgra: bytes) -> bool  (non-blocking push)
      - get_encoded_frame() -> Optional[Tuple[bool, bytes]]  (non-blocking pull)
      - set_bitrate(bitrate_str: str) -> bool
      - get_stats() -> dict
      - wait_for_codec_config(timeout) -> Optional[dict]
      - codec_config property -> Optional[dict]
      - is_running property -> bool
    """

    def __init__(self, width: int = 1920, height: int = 1080, fps: int = 30,
                 bitrate: str = '8M'):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate  # stored as string for API compat with NVENCEncoder
        self._bitrate_kbps = _parse_bitrate_string(bitrate)

        # GStreamer elements
        self._pipeline: Optional['Gst.Pipeline'] = None
        self._appsrc = None      # GstApp.AppSrc
        self._appsink = None     # GstApp.AppSink
        self._encoder_element = None  # nvh264enc or x264enc
        self._mainloop = None    # GLib.MainLoop
        self._mainloop_thread: Optional[threading.Thread] = None

        # Async pull thread: drains appsink into the frame queue
        self._pull_thread: Optional[threading.Thread] = None

        # Thread-safe queue matching NVENCEncoder's interface:
        # items are (is_keyframe: bool, data: bytes)
        self._frame_queue: queue.Queue[Tuple[bool, bytes]] = queue.Queue(maxsize=30)

        # Codec config extracted from first keyframe (SPS/PPS)
        self._codec_config: Optional[dict] = None
        self._codec_config_event = threading.Event()

        # State
        self._running = False
        self._using_nvenc = False

        # Stats
        self._frames_encoded = 0
        self._encode_errors = 0
        self._encode_times: deque = deque(maxlen=300)

        # Frame timing for PTS
        self._frame_duration_ns = int(1e9 / fps)
        self._frame_count = 0

        # Adaptive bitrate state (matches NVENCEncoder)
        self._last_bitrate_change: float = 0.0
        self._bitrate_change_min_interval: float = 5.0

        # Lock for pipeline state changes
        self._pipeline_lock = threading.Lock()

    @property
    def codec_config(self) -> Optional[dict]:
        """Return codec config dict once SPS/PPS have been extracted from first keyframe.

        Returns:
            dict with keys: codec (str), width (int), height (int),
                            sps (bytes), pps (bytes), description (str)
            or None if not yet available.
        """
        return self._codec_config

    def wait_for_codec_config(self, timeout: float = 5.0) -> Optional[dict]:
        """Block until codec config is available (or timeout)."""
        self._codec_config_event.wait(timeout=timeout)
        return self._codec_config

    @property
    def is_running(self) -> bool:
        return self._running

    # ------------------------------------------------------------------
    # Pipeline construction
    # ------------------------------------------------------------------

    def _check_nvenc_available(self) -> bool:
        """Check if GStreamer nvh264enc plugin is available."""
        registry = Gst.Registry.get()
        # Try standard name first, then GStreamer 1.24+ device-specific name
        for name in ('nvh264enc', 'nvh264device0enc'):
            factory = registry.find_feature(name, Gst.ElementFactory.__gtype__)
            if factory is not None:
                return True
        return False

    def _build_pipeline_string(self, use_nvenc: bool) -> str:
        """Build the GStreamer pipeline description string.

        Pipeline topology:
          appsrc (BGRA) -> videoconvert (NV12/I420) -> encoder -> h264parse -> appsink

        Key encoder settings match NVENCEncoder's FFmpeg flags:
          - CBR rate control (constant bitrate for streaming)
          - Zero latency (no reordering, no lookahead, no B-frames)
          - Spatial-AQ for better perceptual quality at zero latency cost
          - GOP size 60 (keyframe every 2s at 30fps)
          - h264parse config-interval=-1: repeat SPS/PPS before every IDR
        """
        caps_in = (
            f"video/x-raw,format=BGRA,width={self.width},"
            f"height={self.height},framerate={self.fps}/1"
        )

        # VBV buffer size: ~1.5x per-frame budget for low latency
        vbv = int((self._bitrate_kbps + self.fps - 1) / self.fps * 1.5)

        if use_nvenc:
            pipeline = (
                f'appsrc name=src emit-signals=false is-live=true '
                f'  format=GST_FORMAT_TIME block=true max-bytes=0 '
                f'  caps="{caps_in}" '
                f'! videoconvert '
                f'! video/x-raw,format=NV12 '
                f'! nvh264enc name=encoder '
                f'    preset=low-latency-hq '
                f'    rc-mode=cbr '
                f'    bitrate={self._bitrate_kbps} '
                f'    gop-size=60 '
                f'    zerolatency=true '
                f'    bframes=0 '
                f'    aud=false '
                f'    rc-lookahead=0 '
                f'    spatial-aq=true '
                f'    aq-strength=8 '
                f'    vbv-buffer-size={vbv} '
                f'! h264parse config-interval=-1 '
                f'! appsink name=sink emit-signals=true sync=false '
                f'    max-buffers=4 drop=true'
            )
        else:
            # Software x264enc fallback
            pipeline = (
                f'appsrc name=src emit-signals=false is-live=true '
                f'  format=GST_FORMAT_TIME block=true max-bytes=0 '
                f'  caps="{caps_in}" '
                f'! videoconvert '
                f'! video/x-raw,format=I420 '
                f'! x264enc name=encoder '
                f'    speed-preset=ultrafast '
                f'    tune=zerolatency '
                f'    bitrate={self._bitrate_kbps} '
                f'    key-int-max=60 '
                f'    bframes=0 '
                f'    byte-stream=true '
                f'    sliced-threads=true '
                f'! h264parse config-interval=-1 '
                f'! appsink name=sink emit-signals=true sync=false '
                f'    max-buffers=4 drop=true'
            )

        return pipeline

    # ------------------------------------------------------------------
    # Start / Stop
    # ------------------------------------------------------------------

    def start(self) -> bool:
        """Start the GStreamer encoding pipeline.

        Returns:
            True if the pipeline started successfully, False otherwise.
        """
        if self._running:
            return True

        if not _GST_AVAILABLE:
            print(f"[GstNVENC] GStreamer not available: {_GST_IMPORT_ERROR}")
            print("[GstNVENC] Install: apt-get install python3-gi python3-gst-1.0 "
                  "gstreamer1.0-plugins-base gstreamer1.0-plugins-bad")
            return False

        use_nvenc = self._check_nvenc_available()
        if use_nvenc:
            print("[GstNVENC] NVENC plugin detected, using hardware encoding (nvh264enc)")
        else:
            print("[GstNVENC] NVENC not available, falling back to x264enc (software)")

        pipeline_str = self._build_pipeline_string(use_nvenc)

        try:
            self._pipeline = Gst.parse_launch(pipeline_str)
        except GLib.GError as e:
            if use_nvenc:
                # Retry with software fallback
                print(f"[GstNVENC] NVENC pipeline failed ({e}), retrying with x264enc")
                pipeline_str = self._build_pipeline_string(use_nvenc=False)
                try:
                    self._pipeline = Gst.parse_launch(pipeline_str)
                    use_nvenc = False
                except GLib.GError as e2:
                    print(f"[GstNVENC] x264enc pipeline also failed: {e2}")
                    return False
            else:
                print(f"[GstNVENC] Pipeline creation failed: {e}")
                return False

        self._using_nvenc = use_nvenc

        # Get element references
        self._appsrc = self._pipeline.get_by_name("src")
        self._appsink = self._pipeline.get_by_name("sink")
        self._encoder_element = self._pipeline.get_by_name("encoder")

        if not self._appsrc or not self._appsink:
            print("[GstNVENC] Failed to get appsrc/appsink elements")
            self._pipeline = None
            return False

        # Install bus error handler
        bus = self._pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message::error", self._on_bus_error)
        bus.connect("message::warning", self._on_bus_warning)

        # Start the GLib main loop in a background thread
        # (required for bus message handling and state transitions)
        self._mainloop = GLib.MainLoop()
        self._mainloop_thread = threading.Thread(
            target=self._run_mainloop, daemon=True, name='gst-mainloop'
        )
        self._mainloop_thread.start()

        # Set pipeline to PLAYING
        ret = self._pipeline.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            print("[GstNVENC] Failed to set pipeline to PLAYING")
            self._cleanup_pipeline()
            return False

        self._running = True
        self._frame_count = 0
        self._frames_encoded = 0
        self._encode_errors = 0
        self._encode_times.clear()

        # Start the pull thread that drains appsink into _frame_queue
        self._pull_thread = threading.Thread(
            target=self._pull_loop, daemon=True, name='gst-pull'
        )
        self._pull_thread.start()

        encoder_name = "nvh264enc" if use_nvenc else "x264enc"
        print(f"[GstNVENC] Encoder started ({self.width}x{self.height} @ {self.fps}fps, "
              f"bitrate={self.bitrate}, encoder={encoder_name})")
        return True

    def stop(self):
        """Stop the GStreamer pipeline and clean up."""
        if not self._running:
            return

        self._running = False

        # Signal EOS to flush the encoder
        if self._appsrc:
            try:
                self._appsrc.end_of_stream()
            except Exception:
                pass

        self._cleanup_pipeline()

        # Wait for pull thread to finish
        if self._pull_thread:
            self._pull_thread.join(timeout=2)
            self._pull_thread = None

        # Drain the queue
        while not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                break

        self._codec_config = None
        self._codec_config_event.clear()

        print(f"[GstNVENC] Encoder stopped (encoded {self._frames_encoded} frames, "
              f"{self._encode_errors} errors)")

    def _cleanup_pipeline(self):
        """Tear down GStreamer pipeline and main loop."""
        if self._pipeline:
            self._pipeline.set_state(Gst.State.NULL)
            self._pipeline = None

        self._appsrc = None
        self._appsink = None
        self._encoder_element = None

        if self._mainloop:
            self._mainloop.quit()
        if self._mainloop_thread:
            self._mainloop_thread.join(timeout=2)
            self._mainloop_thread = None
        self._mainloop = None

    def _run_mainloop(self):
        """Run the GLib main loop (blocking, runs in background thread)."""
        try:
            self._mainloop.run()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Bus message handlers
    # ------------------------------------------------------------------

    def _on_bus_error(self, bus, message):
        """Handle GStreamer pipeline errors."""
        err, debug = message.parse_error()
        print(f"[GstNVENC] Pipeline error: {err.message}")
        if debug:
            print(f"[GstNVENC] Debug: {debug[:200]}")
        self._running = False

    def _on_bus_warning(self, bus, message):
        """Handle GStreamer pipeline warnings."""
        warn, debug = message.parse_warning()
        print(f"[GstNVENC] Pipeline warning: {warn.message}")

    # ------------------------------------------------------------------
    # Encode (push) / Get (pull)
    # ------------------------------------------------------------------

    def encode_frame(self, raw_bgra: bytes) -> bool:
        """Feed a raw BGRA frame to the GStreamer encoder (non-blocking push).

        The frame is pushed into the appsrc element. Encoded output is pulled
        asynchronously by the pull thread and placed in the frame queue.

        Args:
            raw_bgra: Raw BGRA pixel data (width * height * 4 bytes).

        Returns:
            True if the frame was submitted successfully.
        """
        if not self._running or not self._appsrc:
            return False

        expected_size = self.width * self.height * 4
        if len(raw_bgra) != expected_size:
            self._encode_errors += 1
            if self._encode_errors <= 3:
                print(f"[GstNVENC] Frame size mismatch: got {len(raw_bgra)}, "
                      f"expected {expected_size}")
            return False

        try:
            # Create GStreamer buffer from raw bytes
            buf = Gst.Buffer.new_wrapped(bytes(raw_bgra))

            # Set PTS so the encoder knows frame timing
            pts = self._frame_count * self._frame_duration_ns
            buf.pts = pts
            buf.dts = pts
            buf.duration = self._frame_duration_ns
            self._frame_count += 1

            # Push buffer into the pipeline (block=true in appsrc caps means
            # this will block if appsrc's internal queue is full, providing backpressure)
            ret = self._appsrc.push_buffer(buf)
            if ret != Gst.FlowReturn.OK:
                self._encode_errors += 1
                if self._encode_errors <= 5:
                    print(f"[GstNVENC] appsrc.push_buffer returned {ret}")
                return False

            self._frames_encoded += 1
            return True

        except Exception as e:
            self._encode_errors += 1
            if self._encode_errors <= 5:
                print(f"[GstNVENC] encode_frame error: {e}")
            return False

    def get_encoded_frame(self) -> Optional[Tuple[bool, bytes]]:
        """Get the next encoded H.264 access unit (non-blocking).

        Returns:
            (is_keyframe, data) tuple, or None if no frame available.
            - is_keyframe: True if this is a keyframe (contains SPS+PPS+IDR)
            - data: Raw H.264 access unit bytes (Annex B format with start codes)
        """
        try:
            return self._frame_queue.get_nowait()
        except queue.Empty:
            return None

    def _pull_loop(self):
        """Background thread: pull encoded samples from appsink into the frame queue.

        This matches NVENCEncoder's reader thread architecture: the encoder
        produces frames asynchronously and a background thread collects them
        into a thread-safe queue for get_encoded_frame() to drain.
        """
        while self._running:
            if not self._appsink:
                break

            try:
                # try_pull_sample with 100ms timeout — balances responsiveness
                # with CPU usage. Short enough to not delay frames, long enough
                # to not busy-spin.
                sample = self._appsink.try_pull_sample(100 * Gst.MSECOND)
                if sample is None:
                    continue

                t0 = time.monotonic()

                # Extract encoded H.264 bytes
                gst_buffer = sample.get_buffer()
                success, map_info = gst_buffer.map(Gst.MapFlags.READ)
                if not success:
                    self._encode_errors += 1
                    continue

                h264_data = bytes(map_info.data)
                gst_buffer.unmap(map_info)

                if not h264_data:
                    continue

                # Determine if this is a keyframe
                is_keyframe = self._check_keyframe(h264_data)

                # Extract codec config from first keyframe
                if is_keyframe and self._codec_config is None:
                    self._extract_codec_config(h264_data)

                # Enqueue the frame
                try:
                    self._frame_queue.put_nowait((is_keyframe, h264_data))
                except queue.Full:
                    # Drop oldest frame to prevent queue backup
                    try:
                        self._frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        self._frame_queue.put_nowait((is_keyframe, h264_data))
                    except queue.Full:
                        pass

                t1 = time.monotonic()
                self._encode_times.append((t1 - t0) * 1000)

            except Exception as e:
                if self._running:
                    print(f"[GstNVENC] Pull thread error: {e}")
                    time.sleep(0.01)  # avoid tight error loop

    # ------------------------------------------------------------------
    # Keyframe detection + codec config extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _check_keyframe(h264_data: bytes) -> bool:
        """Check if H.264 data contains a keyframe (IDR NAL unit type 5).

        Scans for NAL start codes (0x00000001 or 0x000001) and checks the
        NAL unit type field (lower 5 bits of the first byte after start code).
        """
        i = 0
        end = len(h264_data) - 4
        while i < end:
            if h264_data[i:i + 4] == b'\x00\x00\x00\x01':
                nal_type = h264_data[i + 4] & 0x1F
                if nal_type == 5:  # IDR slice
                    return True
                i += 4
            elif h264_data[i:i + 3] == b'\x00\x00\x01':
                nal_type = h264_data[i + 3] & 0x1F
                if nal_type == 5:
                    return True
                i += 3
            else:
                i += 1
        return False

    def _extract_codec_config(self, h264_data: bytes):
        """Extract SPS/PPS and build avc1 codec string from keyframe data.

        Builds the avc1.XXYYZZ codec string from the SPS profile/level bytes
        and stores SPS data for WebCodecs VideoDecoder.configure().

        The codec config dict matches NVENCEncoder's format:
            codec: str       - e.g. 'avc1.640028'
            width: int
            height: int
            sps: bytes       - SPS NAL unit with start code prefix
            description: str - same as codec
        """
        sps_nalu = None
        pps_nalu = None
        i = 0
        while i < len(h264_data) - 4:
            sc_len = 0
            if h264_data[i:i + 4] == b'\x00\x00\x00\x01':
                sc_len = 4
            elif h264_data[i:i + 3] == b'\x00\x00\x01':
                sc_len = 3

            if sc_len > 0:
                nalu_start = i + sc_len
                nal_type = h264_data[nalu_start] & 0x1F if nalu_start < len(h264_data) else 0

                # Find end of this NALU (next start code or end of data)
                nalu_end = len(h264_data)
                j = nalu_start + 1
                while j < len(h264_data) - 3:
                    if h264_data[j:j + 3] == b'\x00\x00\x01' or \
                       h264_data[j:j + 4] == b'\x00\x00\x00\x01':
                        nalu_end = j
                        break
                    j += 1

                if nal_type == 7:  # SPS
                    sps_nalu = h264_data[nalu_start:nalu_end]
                elif nal_type == 8:  # PPS
                    pps_nalu = h264_data[nalu_start:nalu_end]

                i = nalu_end
            else:
                i += 1

        if sps_nalu and len(sps_nalu) >= 4:
            profile_idc = sps_nalu[1]
            constraint_flags = sps_nalu[2]
            level_idc = sps_nalu[3]
            codec_string = f'avc1.{profile_idc:02X}{constraint_flags:02X}{level_idc:02X}'

            self._codec_config = {
                'codec': codec_string,
                'width': self.width,
                'height': self.height,
                'sps': b'\x00\x00\x00\x01' + sps_nalu,
                'description': codec_string,
            }
            self._codec_config_event.set()

            print(f"[GstNVENC] Codec config extracted: {codec_string} "
                  f"({self.width}x{self.height}, profile={profile_idc}, level={level_idc})")

    # ------------------------------------------------------------------
    # Adaptive bitrate
    # ------------------------------------------------------------------

    def set_bitrate(self, bitrate_str: str) -> bool:
        """Dynamically change encoder bitrate — instant, no restart needed.

        GStreamer allows changing element properties on a running pipeline.
        This is the key advantage over the FFmpeg subprocess approach which
        requires killing and restarting the process.

        Rate-limited to at most one change every 5 seconds (matching NVENCEncoder).

        Args:
            bitrate_str: Target bitrate string (e.g. '6M', '2M', '12M', '6.4M').

        Returns:
            True if the change was applied, False if rate-limited, same value,
            or encoder not running.
        """
        if not self._running or not self._encoder_element:
            return False

        # Rate-limit
        now = time.time()
        if now - self._last_bitrate_change < self._bitrate_change_min_interval:
            return False

        # Skip if bitrate is already the same
        if bitrate_str == self.bitrate:
            return False

        new_kbps = _parse_bitrate_string(bitrate_str)
        old_bitrate = self.bitrate

        try:
            self._encoder_element.set_property("bitrate", new_kbps)
            self._bitrate_kbps = new_kbps
            self.bitrate = bitrate_str
            self._last_bitrate_change = now
            print(f"[GstNVENC] Bitrate changed: {old_bitrate} -> {bitrate_str} "
                  f"({new_kbps} kbps, no restart)")
            return True
        except Exception as e:
            print(f"[GstNVENC] Failed to change bitrate: {e}")
            return False

    def force_keyframe(self):
        """Force the encoder to produce a keyframe on the next frame.

        Uses GStreamer's GstForceKeyUnit event, which is cleaner than
        NVENCEncoder's approach of restarting the FFmpeg subprocess.
        Useful after bitrate changes or client reconnections.
        """
        if not self._encoder_element:
            return

        try:
            # GstForceKeyUnit downstream event — tells the encoder to insert
            # an IDR frame with full SPS/PPS headers
            event = Gst.Event.new_custom(
                Gst.EventType.CUSTOM_DOWNSTREAM,
                Gst.Structure.new_from_string(
                    "GstForceKeyUnit, all-headers=true"
                )
            )
            self._encoder_element.send_event(event)
        except Exception as e:
            print(f"[GstNVENC] Failed to force keyframe: {e}")

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return encoder statistics.

        The dict format matches NVENCEncoder.get_stats() for compatibility:
            frames_encoded: int
            errors: int
            queue_size: int
            running: bool
            has_codec_config: bool
            bitrate: str
        Plus additional GStreamer-specific fields:
            encoder: str  ('nvh264enc' or 'x264enc')
            avg_encode_ms: float
            p95_encode_ms: float
        """
        times = list(self._encode_times)
        avg_ms = sum(times) / len(times) if times else 0.0
        p95_ms = sorted(times)[int(len(times) * 0.95)] if len(times) > 1 else avg_ms

        return {
            # NVENCEncoder-compatible fields
            'frames_encoded': self._frames_encoded,
            'errors': self._encode_errors,
            'queue_size': self._frame_queue.qsize(),
            'running': self._running,
            'has_codec_config': self._codec_config is not None,
            'bitrate': self.bitrate,
            # GStreamer-specific fields
            'encoder': 'nvh264enc' if self._using_nvenc else 'x264enc',
            'avg_encode_ms': round(avg_ms, 2),
            'p95_encode_ms': round(p95_ms, 2),
        }
