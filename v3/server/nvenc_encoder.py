"""
NVENC H.264 Encoder — FFmpeg subprocess pipeline for hardware video encoding.

Encodes raw BGRA frames from CARLA's camera sensor into H.264 access units
using NVIDIA's NVENC hardware encoder via FFmpeg. This replaces the CPU-based
JPEG encoding path with ~1-2ms GPU encoding at ~5-8 Mbps (vs ~15-25 Mbps JPEG).

Usage:
    encoder = NVENCEncoder(width=1280, height=720)
    encoder.start()
    encoder.encode_frame(raw_bgra_bytes)
    frame = encoder.get_encoded_frame()  # returns (is_keyframe, data) or None
    encoder.stop()

The encoder parses FFmpeg's stdout into individual H.264 NAL units, groups them
into access units (keyframe = SPS+PPS+IDR, delta = non-IDR slice), and exposes
them via a thread-safe queue.
"""
import subprocess
import threading
import queue
import time
from typing import Optional, Tuple


class NVENCEncoder:
    """FFmpeg NVENC subprocess wrapper for encoding raw BGRA → H.264."""

    def __init__(self, width: int = 1280, height: int = 720, fps: int = 30,
                 bitrate: str = '8M'):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate

        self._process: Optional[subprocess.Popen] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._running = False

        # Thread-safe queue of encoded frames: (is_keyframe: bool, data: bytes)
        self._frame_queue: queue.Queue[Tuple[bool, bytes]] = queue.Queue(maxsize=30)

        # Codec config extracted from first keyframe (SPS/PPS bytes, avc1 string)
        self._codec_config: Optional[dict] = None
        self._codec_config_event = threading.Event()

        # Stats
        self._frames_encoded = 0
        self._encode_errors = 0

    @property
    def codec_config(self) -> Optional[dict]:
        """Return codec config dict once SPS/PPS have been extracted from the first keyframe.

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

    def start(self) -> bool:
        """Start the FFmpeg NVENC subprocess.

        Returns:
            True if FFmpeg started successfully with NVENC, False otherwise.
        """
        if self._running:
            return True

        cmd = [
            'ffmpeg',
            '-hide_banner', '-loglevel', 'error',
            # Input: raw BGRA from pipe
            '-f', 'rawvideo',
            '-pix_fmt', 'bgra',
            '-s', f'{self.width}x{self.height}',
            '-r', str(self.fps),
            '-i', 'pipe:0',
            # Output: H.264 via NVENC
            '-c:v', 'h264_nvenc',
            '-preset', 'p1',         # Fastest preset (lowest latency)
            '-tune', 'ull',          # Ultra-low latency tuning
            '-rc', 'cbr',            # Constant bitrate
            '-b:v', self.bitrate,
            '-bf', '0',              # No B-frames (latency)
            '-rc-lookahead', '0',    # No lookahead (latency)
            '-zerolatency', '1',     # Zero-latency mode
            '-g', '60',              # Keyframe every 2 seconds at 30fps
            '-f', 'h264',            # Raw H.264 bitstream output
            'pipe:1',
        ]

        try:
            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,  # Unbuffered
            )
        except FileNotFoundError:
            print("[NVENC] FFmpeg not found — falling back to JPEG encoding")
            return False
        except Exception as e:
            print(f"[NVENC] Failed to start FFmpeg: {e}")
            return False

        # Check if FFmpeg started successfully (give it a moment to fail)
        time.sleep(0.2)
        if self._process.poll() is not None:
            stderr = self._process.stderr.read().decode('utf-8', errors='replace')
            print(f"[NVENC] FFmpeg exited immediately: {stderr[:500]}")
            self._process = None
            return False

        self._running = True
        self._reader_thread = threading.Thread(
            target=self._read_output, daemon=True, name='nvenc-reader'
        )
        self._reader_thread.start()

        print(f"[NVENC] Encoder started ({self.width}x{self.height} @ {self.fps}fps, "
              f"bitrate={self.bitrate}, preset=p1/ull)")
        return True

    def stop(self):
        """Stop the FFmpeg subprocess and clean up."""
        self._running = False

        if self._process:
            try:
                if self._process.stdin:
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
            self._reader_thread = None

        # Drain the queue
        while not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                break

        self._codec_config = None
        self._codec_config_event.clear()
        print(f"[NVENC] Encoder stopped (encoded {self._frames_encoded} frames, "
              f"{self._encode_errors} errors)")

    def encode_frame(self, raw_bgra: bytes) -> bool:
        """Feed a raw BGRA frame to FFmpeg for encoding.

        Args:
            raw_bgra: Raw BGRA pixel data (width * height * 4 bytes).

        Returns:
            True if the frame was submitted successfully.
        """
        if not self._running or not self._process or not self._process.stdin:
            return False

        expected_size = self.width * self.height * 4
        if len(raw_bgra) != expected_size:
            self._encode_errors += 1
            if self._encode_errors <= 3:
                print(f"[NVENC] Frame size mismatch: got {len(raw_bgra)}, "
                      f"expected {expected_size}")
            return False

        try:
            self._process.stdin.write(raw_bgra)
            self._process.stdin.flush()
            self._frames_encoded += 1
            return True
        except (BrokenPipeError, OSError) as e:
            self._encode_errors += 1
            if self._encode_errors <= 5:
                print(f"[NVENC] Write error: {e}")
            if self._process.poll() is not None:
                stderr = ''
                try:
                    stderr = self._process.stderr.read().decode('utf-8', errors='replace')[:500]
                except Exception:
                    pass
                print(f"[NVENC] FFmpeg process died: {stderr}")
                self._running = False
            return False

    def get_encoded_frame(self) -> Optional[Tuple[bool, bytes]]:
        """Get the next encoded H.264 access unit (non-blocking).

        Returns:
            (is_keyframe, data) tuple, or None if no frame available.
            - is_keyframe: True if this is a keyframe (SPS+PPS+IDR)
            - data: Raw H.264 access unit bytes
        """
        try:
            return self._frame_queue.get_nowait()
        except queue.Empty:
            return None

    @property
    def is_running(self) -> bool:
        return self._running

    def _read_output(self):
        """Reader thread: reads FFmpeg stdout, parses NAL units into access units.

        H.264 bitstream is a sequence of NAL units separated by start codes
        (0x00000001 or 0x000001). We group NALUs into access units:
        - Keyframe: SPS (type 7) + PPS (type 8) + IDR slice (type 5)
        - Delta frame: non-IDR slice (type 1)
        """
        stdout = self._process.stdout
        buffer = bytearray()
        CHUNK_SIZE = 65536  # 64KB read chunks

        while self._running and self._process and self._process.poll() is None:
            try:
                chunk = stdout.read(CHUNK_SIZE)
                if not chunk:
                    break
                buffer.extend(chunk)

                # Parse NAL units from buffer
                self._parse_nalus(buffer)

            except Exception as e:
                if self._running:
                    print(f"[NVENC] Reader error: {e}")
                break

        if self._running:
            self._running = False
            stderr = ''
            try:
                stderr = self._process.stderr.read().decode('utf-8', errors='replace')[:500]
            except Exception:
                pass
            if stderr:
                print(f"[NVENC] FFmpeg stderr: {stderr}")

    def _parse_nalus(self, buffer: bytearray):
        """Parse H.264 NAL units from the buffer and group into access units.

        Modifies buffer in-place, removing consumed bytes.
        """
        START_CODE_3 = b'\x00\x00\x01'
        START_CODE_4 = b'\x00\x00\x00\x01'

        while True:
            # Find first start code
            pos3 = buffer.find(START_CODE_3)
            pos4 = buffer.find(START_CODE_4)

            if pos3 < 0 and pos4 < 0:
                # No start code found, keep last 3 bytes (partial start code)
                if len(buffer) > 3:
                    del buffer[:len(buffer) - 3]
                return

            # Determine start code position and length
            if pos4 >= 0 and (pos3 < 0 or pos4 <= pos3):
                first_pos = pos4
                first_len = 4
            else:
                first_pos = pos3
                first_len = 3

            # Find next start code after the first one
            search_start = first_pos + first_len
            next3 = buffer.find(START_CODE_3, search_start)
            next4 = buffer.find(START_CODE_4, search_start)

            if next3 < 0 and next4 < 0:
                # Only one start code so far, need more data
                # But only if buffer isn't getting too large (>2MB = probably a full AU)
                if len(buffer) < 2 * 1024 * 1024:
                    return
                # Large buffer with single start code: treat it as a complete NALU
                nalu_data = bytes(buffer[first_pos + first_len:])
                del buffer[:]
                self._process_nalu(nalu_data)
                return

            # Determine next start code position
            if next4 >= 0 and (next3 < 0 or next4 <= next3):
                next_pos = next4
            else:
                next_pos = next3

            # Extract NALU between start codes
            nalu_data = bytes(buffer[first_pos + first_len:next_pos])

            # Remove consumed bytes up to the next start code
            del buffer[:next_pos]

            if nalu_data:
                self._process_nalu(nalu_data)

    # Accumulator for grouping NALUs into access units
    _current_au: list = []
    _current_au_is_keyframe: bool = False

    def _process_nalu(self, nalu_data: bytes):
        """Process a single NAL unit and group into access units."""
        if not nalu_data:
            return

        nalu_type = nalu_data[0] & 0x1F

        # NAL unit types:
        #   1 = non-IDR slice (P/B frame)
        #   5 = IDR slice (keyframe)
        #   6 = SEI
        #   7 = SPS (Sequence Parameter Set)
        #   8 = PPS (Picture Parameter Set)

        if nalu_type == 7:  # SPS
            # SPS starts a new access unit — flush previous if any
            self._flush_access_unit()
            self._current_au = [nalu_data]
            self._current_au_is_keyframe = True

            # Extract codec config from SPS
            if self._codec_config is None:
                self._extract_codec_config(nalu_data)

        elif nalu_type == 8:  # PPS
            self._current_au.append(nalu_data)

        elif nalu_type == 5:  # IDR slice
            self._current_au.append(nalu_data)
            self._flush_access_unit()

        elif nalu_type == 1:  # non-IDR slice
            # Delta frame is a single-NALU access unit
            self._flush_access_unit()
            self._current_au = [nalu_data]
            self._current_au_is_keyframe = False
            self._flush_access_unit()

        elif nalu_type == 6:  # SEI
            # Append SEI to current AU (informational, not critical)
            self._current_au.append(nalu_data)

        # Ignore other types (AUD, filler, etc.)

    def _flush_access_unit(self):
        """Flush the accumulated NALUs as a complete access unit."""
        if not self._current_au:
            return

        # Reassemble with 4-byte start codes
        parts = []
        for nalu in self._current_au:
            parts.append(b'\x00\x00\x00\x01')
            parts.append(nalu)

        au_data = b''.join(parts)
        is_keyframe = self._current_au_is_keyframe

        self._current_au = []
        self._current_au_is_keyframe = False

        # Enqueue
        try:
            self._frame_queue.put_nowait((is_keyframe, au_data))
        except queue.Full:
            # Drop oldest frame to prevent queue backup
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._frame_queue.put_nowait((is_keyframe, au_data))
            except queue.Full:
                pass

    def _extract_codec_config(self, sps_data: bytes):
        """Extract codec configuration from SPS NAL unit.

        Builds the avc1.XXYYZZ codec string from the SPS profile/level bytes
        and stores SPS/PPS for WebCodecs VideoDecoder.configure().
        """
        if len(sps_data) < 4:
            return

        # SPS data starts after the NAL header byte
        # profile_idc = byte 1, constraint_set_flags = byte 2, level_idc = byte 3
        profile_idc = sps_data[1]
        constraint_flags = sps_data[2]
        level_idc = sps_data[3]

        codec_string = f'avc1.{profile_idc:02X}{constraint_flags:02X}{level_idc:02X}'

        self._codec_config = {
            'codec': codec_string,
            'width': self.width,
            'height': self.height,
            'sps': b'\x00\x00\x00\x01' + sps_data,
            'description': codec_string,
        }
        self._codec_config_event.set()

        print(f"[NVENC] Codec config extracted: {codec_string} "
              f"({self.width}x{self.height}, profile={profile_idc}, level={level_idc})")

    def get_stats(self) -> dict:
        """Return encoder statistics."""
        return {
            'frames_encoded': self._frames_encoded,
            'errors': self._encode_errors,
            'queue_size': self._frame_queue.qsize(),
            'running': self._running,
            'has_codec_config': self._codec_config is not None,
        }
