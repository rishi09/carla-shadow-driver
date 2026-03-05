#!/usr/bin/env python3
"""
Benchmark: PyNvVideoCodec vs FFmpeg subprocess NVENC encoding.

Generates synthetic 1920x1080 BGRA frames and encodes them to H.264 via:
  1. PyNvVideoCodec (direct NVENC API, no subprocess)
  2. FFmpeg subprocess pipe (current Shadow Driver approach)

Measures per-frame encode latency, throughput (fps), and total pipeline time.

Install (on GPU instance):
    pip install PyNvVideoCodec cupy-cuda12x numpy

If PyNvVideoCodec is unavailable, falls back to python_vali (VALI).
If neither is available, only runs the FFmpeg benchmark.

Requirements:
    - NVIDIA GPU (RTX 3090/4090 tested)
    - NVIDIA driver >= 525.xx
    - CUDA Toolkit 11.2+ (12.x preferred)
    - FFmpeg with h264_nvenc support (for baseline comparison)

Usage:
    python bench_pynvvideocodec.py [--frames 100] [--width 1920] [--height 1080]
"""

import argparse
import subprocess
import sys
import time
import os
from typing import Optional, List, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
WIDTH = 1920
HEIGHT = 1080
NUM_FRAMES = 100
BITRATE = "8M"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_bgra_frames_cpu(n: int, w: int, h: int) -> List[bytes]:
    """Generate N synthetic BGRA frames on CPU as raw bytes."""
    frames = []
    for i in range(n):
        # Gradient pattern that changes per frame (so encoder does real work)
        r = np.full((h, w), (i * 7) % 256, dtype=np.uint8)
        g = np.arange(w, dtype=np.uint8).reshape(1, w).repeat(h, axis=0)
        b = np.arange(h, dtype=np.uint8).reshape(h, 1).repeat(w, axis=1)
        a = np.full((h, w), 255, dtype=np.uint8)
        bgra = np.stack([b, g, r, a], axis=-1)
        frames.append(bgra.tobytes())
    return frames


def bgra_to_nv12_cpu(bgra_bytes: bytes, w: int, h: int) -> bytes:
    """Convert BGRA raw bytes to NV12 on CPU using numpy.

    NV12 layout: full-res Y plane, then half-res interleaved UV plane.
    Total size = w * h * 1.5
    """
    bgra = np.frombuffer(bgra_bytes, dtype=np.uint8).reshape((h, w, 4))
    B = bgra[:, :, 0].astype(np.float32)
    G = bgra[:, :, 1].astype(np.float32)
    R = bgra[:, :, 2].astype(np.float32)

    # BT.601 conversion
    Y = (0.299 * R + 0.587 * G + 0.114 * B).clip(0, 255).astype(np.uint8)
    U = ((-0.169 * R - 0.331 * G + 0.500 * B) + 128).clip(0, 255).astype(np.uint8)
    V = ((0.500 * R - 0.419 * G - 0.081 * B) + 128).clip(0, 255).astype(np.uint8)

    # Subsample U, V by 2x2
    U_sub = U[0::2, 0::2]
    V_sub = V[0::2, 0::2]

    # Interleave U and V for NV12
    uv = np.empty((h // 2, w), dtype=np.uint8)
    uv[:, 0::2] = U_sub
    uv[:, 1::2] = V_sub

    return Y.tobytes() + uv.tobytes()


def bgra_to_nv12_gpu(bgra_gpu, w: int, h: int):
    """Convert BGRA CuPy array to NV12 on GPU. Returns CuPy array.

    Input: cupy array of shape (h, w, 4), dtype uint8
    Output: cupy array of shape (h * 3 // 2, w), dtype uint8 (NV12 layout)
    """
    import cupy as cp

    B = bgra_gpu[:, :, 0].astype(cp.float32)
    G = bgra_gpu[:, :, 1].astype(cp.float32)
    R = bgra_gpu[:, :, 2].astype(cp.float32)

    Y = (0.299 * R + 0.587 * G + 0.114 * B).clip(0, 255).astype(cp.uint8)
    U = ((-0.169 * R - 0.331 * G + 0.500 * B) + 128).clip(0, 255).astype(cp.uint8)
    V = ((0.500 * R - 0.419 * G - 0.081 * B) + 128).clip(0, 255).astype(cp.uint8)

    U_sub = U[0::2, 0::2]
    V_sub = V[0::2, 0::2]

    # Build NV12 buffer: Y plane on top, interleaved UV on bottom
    nv12 = cp.empty((h * 3 // 2, w), dtype=cp.uint8)
    nv12[:h, :] = Y
    nv12[h:, 0::2] = U_sub
    nv12[h:, 1::2] = V_sub

    return nv12


# ---------------------------------------------------------------------------
# Benchmark 1: FFmpeg subprocess NVENC (current approach)
# ---------------------------------------------------------------------------

def bench_ffmpeg_subprocess(frames: List[bytes], w: int, h: int) -> dict:
    """Benchmark FFmpeg subprocess NVENC encoding (current Shadow Driver pipeline).

    Feeds raw BGRA bytes via stdin pipe, reads H.264 from stdout.
    Measures total encode time and per-frame latency.
    """
    print("\n" + "=" * 60)
    print("BENCHMARK: FFmpeg subprocess NVENC (current approach)")
    print("=" * 60)

    cmd = [
        "ffmpeg",
        "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo",
        "-pix_fmt", "bgra",
        "-s", f"{w}x{h}",
        "-r", "30",
        "-i", "pipe:0",
        "-c:v", "h264_nvenc",
        "-preset", "p1",
        "-tune", "ull",
        "-rc", "cbr",
        "-b:v", BITRATE,
        "-bf", "0",
        "-rc-lookahead", "0",
        "-zerolatency", "1",
        "-g", "60",
        "-f", "h264",
        "pipe:1",
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
    except FileNotFoundError:
        print("  ERROR: ffmpeg not found in PATH")
        return {"error": "ffmpeg not found"}

    # Give FFmpeg a moment to initialize
    time.sleep(0.3)
    if proc.poll() is not None:
        stderr = proc.stderr.read().decode("utf-8", errors="replace")
        print(f"  ERROR: FFmpeg exited immediately: {stderr[:300]}")
        return {"error": f"FFmpeg startup failed: {stderr[:200]}"}

    latencies = []
    total_output = 0
    total_start = time.perf_counter()

    for i, frame in enumerate(frames):
        t0 = time.perf_counter()
        try:
            proc.stdin.write(frame)
            proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            print(f"  ERROR: Write failed at frame {i}: {e}")
            break

        # Non-blocking read of whatever output is available
        # (FFmpeg buffers internally, so output arrives in bursts)
        import select
        ready, _, _ = select.select([proc.stdout], [], [], 0.001)
        if ready:
            chunk = proc.stdout.read(65536)
            if chunk:
                total_output += len(chunk)

        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000)

    # Close stdin to signal EOF, then read remaining output
    proc.stdin.close()
    flush_start = time.perf_counter()
    remaining = proc.stdout.read()
    flush_time = (time.perf_counter() - flush_start) * 1000
    if remaining:
        total_output += len(remaining)

    total_time = (time.perf_counter() - total_start) * 1000
    proc.wait(timeout=5)

    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p50 = sorted(latencies)[len(latencies) // 2] if latencies else 0
    p99 = sorted(latencies)[int(len(latencies) * 0.99)] if latencies else 0
    fps = len(frames) / (total_time / 1000) if total_time > 0 else 0

    result = {
        "method": "FFmpeg subprocess NVENC",
        "frames": len(frames),
        "total_ms": total_time,
        "flush_ms": flush_time,
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50,
        "p99_latency_ms": p99,
        "throughput_fps": fps,
        "output_bytes": total_output,
        "bits_per_frame": (total_output * 8 / len(frames)) if frames else 0,
    }

    print(f"  Frames:       {result['frames']}")
    print(f"  Total time:   {result['total_ms']:.1f} ms")
    print(f"  Flush time:   {result['flush_ms']:.1f} ms")
    print(f"  Avg latency:  {result['avg_latency_ms']:.2f} ms/frame")
    print(f"  P50 latency:  {result['p50_latency_ms']:.2f} ms")
    print(f"  P99 latency:  {result['p99_latency_ms']:.2f} ms")
    print(f"  Throughput:   {result['throughput_fps']:.1f} fps")
    print(f"  Output size:  {result['output_bytes']:,} bytes ({result['bits_per_frame']:.0f} bits/frame)")
    return result


# ---------------------------------------------------------------------------
# Benchmark 2: PyNvVideoCodec direct NVENC
# ---------------------------------------------------------------------------

def bench_pynvvideocodec(frames: List[bytes], w: int, h: int) -> Optional[dict]:
    """Benchmark PyNvVideoCodec direct NVENC encoding.

    Uses NVIDIA's official Python bindings for the Video Codec SDK.
    Accepts NV12 input (must convert from BGRA first).
    """
    print("\n" + "=" * 60)
    print("BENCHMARK: PyNvVideoCodec (direct NVENC, CPU input buffer)")
    print("=" * 60)

    try:
        import PyNvVideoCodec as nvc
    except ImportError:
        print("  PyNvVideoCodec not installed.")
        print("  Install: pip install PyNvVideoCodec")
        return None

    # Create encoder with CPU input buffer (usecpuinputbuffer=True)
    # Accepts NV12 numpy arrays
    try:
        encoder = nvc.CreateEncoder(
            gpuid=0,
            codec=nvc.CudaVideoCodec.H264,
            width=w,
            height=h,
            framerate=30,
            preset=nvc.EncodePreset.P1,
            tuninginfo=nvc.EncodeTuningInfo.ULTRA_LOW_LATENCY,
            codecconfig=nvc.CodecConfig.CBR,
            bitrate=8_000_000,
        )
    except Exception as e:
        print(f"  ERROR: Failed to create encoder: {e}")
        print(f"  (This may require specific NVIDIA driver/CUDA versions)")
        return None

    # Pre-convert all frames from BGRA to NV12 (CPU)
    print("  Converting BGRA -> NV12 (CPU)...")
    nv12_frames = []
    conv_start = time.perf_counter()
    for frame in frames:
        nv12_frames.append(bgra_to_nv12_cpu(frame, w, h))
    conv_time = (time.perf_counter() - conv_start) * 1000
    print(f"  Conversion time: {conv_time:.1f} ms ({conv_time/len(frames):.2f} ms/frame)")

    # Encode
    latencies = []
    total_output = 0
    total_start = time.perf_counter()

    for i, nv12_data in enumerate(nv12_frames):
        nv12_np = np.frombuffer(nv12_data, dtype=np.uint8)

        t0 = time.perf_counter()
        try:
            bitstream = encoder.Encode(nv12_np)
            if bitstream:
                total_output += len(bitstream)
        except Exception as e:
            print(f"  ERROR: Encode failed at frame {i}: {e}")
            break
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000)

    # Flush
    flush_start = time.perf_counter()
    try:
        remaining = encoder.EndEncode()
        if remaining:
            total_output += len(remaining)
    except Exception:
        pass
    flush_time = (time.perf_counter() - flush_start) * 1000

    total_time = (time.perf_counter() - total_start) * 1000

    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p50 = sorted(latencies)[len(latencies) // 2] if latencies else 0
    p99 = sorted(latencies)[int(len(latencies) * 0.99)] if latencies else 0
    fps = len(frames) / (total_time / 1000) if total_time > 0 else 0

    result = {
        "method": "PyNvVideoCodec (CPU input)",
        "frames": len(frames),
        "total_ms": total_time,
        "flush_ms": flush_time,
        "conv_ms_per_frame": conv_time / len(frames),
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50,
        "p99_latency_ms": p99,
        "throughput_fps": fps,
        "output_bytes": total_output,
        "bits_per_frame": (total_output * 8 / len(frames)) if frames else 0,
    }

    print(f"  Frames:         {result['frames']}")
    print(f"  Total time:     {result['total_ms']:.1f} ms")
    print(f"  Flush time:     {result['flush_ms']:.1f} ms")
    print(f"  Conv overhead:  {result['conv_ms_per_frame']:.2f} ms/frame (BGRA->NV12 on CPU)")
    print(f"  Avg latency:    {result['avg_latency_ms']:.2f} ms/frame (encode only)")
    print(f"  P50 latency:    {result['p50_latency_ms']:.2f} ms")
    print(f"  P99 latency:    {result['p99_latency_ms']:.2f} ms")
    print(f"  Throughput:     {result['throughput_fps']:.1f} fps (encode only)")
    print(f"  Output size:    {result['output_bytes']:,} bytes ({result['bits_per_frame']:.0f} bits/frame)")
    return result


# ---------------------------------------------------------------------------
# Benchmark 3: PyNvVideoCodec with GPU input (CuPy CUDA array interface)
# ---------------------------------------------------------------------------

def bench_pynvvideocodec_gpu(frames: List[bytes], w: int, h: int) -> Optional[dict]:
    """Benchmark PyNvVideoCodec with GPU memory input via CUDA array interface.

    Uses CuPy to hold frames on GPU and passes them via __cuda_array_interface__
    to the encoder (usecpuinputbuffer=False equivalent).
    """
    print("\n" + "=" * 60)
    print("BENCHMARK: PyNvVideoCodec (GPU input via CUDA array interface)")
    print("=" * 60)

    try:
        import PyNvVideoCodec as nvc
    except ImportError:
        print("  PyNvVideoCodec not installed.")
        return None

    try:
        import cupy as cp
    except ImportError:
        print("  CuPy not installed. Install: pip install cupy-cuda12x")
        return None

    # Create encoder
    try:
        encoder = nvc.CreateEncoder(
            gpuid=0,
            codec=nvc.CudaVideoCodec.H264,
            width=w,
            height=h,
            framerate=30,
            preset=nvc.EncodePreset.P1,
            tuninginfo=nvc.EncodeTuningInfo.ULTRA_LOW_LATENCY,
            codecconfig=nvc.CodecConfig.CBR,
            bitrate=8_000_000,
        )
    except Exception as e:
        print(f"  ERROR: Failed to create encoder: {e}")
        return None

    # Upload BGRA frames to GPU and convert to NV12 on GPU
    print("  Uploading BGRA to GPU and converting to NV12...")
    gpu_nv12_frames = []
    upload_start = time.perf_counter()
    for frame in frames:
        bgra_np = np.frombuffer(frame, dtype=np.uint8).reshape((h, w, 4))
        bgra_gpu = cp.asarray(bgra_np)
        nv12_gpu = bgra_to_nv12_gpu(bgra_gpu, w, h)
        gpu_nv12_frames.append(nv12_gpu)
    cp.cuda.Stream.null.synchronize()
    upload_time = (time.perf_counter() - upload_start) * 1000
    print(f"  Upload+convert time: {upload_time:.1f} ms ({upload_time/len(frames):.2f} ms/frame)")

    # Encode from GPU memory
    latencies = []
    total_output = 0
    total_start = time.perf_counter()

    for i, nv12_gpu in enumerate(gpu_nv12_frames):
        # Flatten to 1D for encoder (it expects a flat buffer with __cuda_array_interface__)
        nv12_flat = nv12_gpu.ravel()

        t0 = time.perf_counter()
        try:
            bitstream = encoder.Encode(nv12_flat)
            if bitstream:
                total_output += len(bitstream)
        except Exception as e:
            if i == 0:
                print(f"  ERROR: GPU encode failed at frame {i}: {e}")
                print(f"  Falling back to CPU input benchmark only.")
                return None
            break
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000)

    # Flush
    flush_start = time.perf_counter()
    try:
        remaining = encoder.EndEncode()
        if remaining:
            total_output += len(remaining)
    except Exception:
        pass
    flush_time = (time.perf_counter() - flush_start) * 1000

    total_time = (time.perf_counter() - total_start) * 1000

    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p50 = sorted(latencies)[len(latencies) // 2] if latencies else 0
    p99 = sorted(latencies)[int(len(latencies) * 0.99)] if latencies else 0
    fps = len(frames) / (total_time / 1000) if total_time > 0 else 0

    result = {
        "method": "PyNvVideoCodec (GPU input, zero-copy)",
        "frames": len(frames),
        "total_ms": total_time,
        "flush_ms": flush_time,
        "upload_conv_ms_per_frame": upload_time / len(frames),
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50,
        "p99_latency_ms": p99,
        "throughput_fps": fps,
        "output_bytes": total_output,
        "bits_per_frame": (total_output * 8 / len(frames)) if frames else 0,
    }

    print(f"  Frames:           {result['frames']}")
    print(f"  Total time:       {result['total_ms']:.1f} ms")
    print(f"  Flush time:       {result['flush_ms']:.1f} ms")
    print(f"  Upload+conv:      {result['upload_conv_ms_per_frame']:.2f} ms/frame (BGRA->NV12 on GPU)")
    print(f"  Avg latency:      {result['avg_latency_ms']:.2f} ms/frame (encode only)")
    print(f"  P50 latency:      {result['p50_latency_ms']:.2f} ms")
    print(f"  P99 latency:      {result['p99_latency_ms']:.2f} ms")
    print(f"  Throughput:       {result['throughput_fps']:.1f} fps (encode only)")
    print(f"  Output size:      {result['output_bytes']:,} bytes ({result['bits_per_frame']:.0f} bits/frame)")
    return result


# ---------------------------------------------------------------------------
# Benchmark 4: VALI (python_vali) as alternative
# ---------------------------------------------------------------------------

def bench_vali(frames: List[bytes], w: int, h: int) -> Optional[dict]:
    """Benchmark VALI (python_vali) encoding as an alternative to PyNvVideoCodec.

    VALI is the successor to NVIDIA VideoProcessingFramework (VPF).
    Uses PyNvEncoder with Surface-based GPU memory management.
    """
    print("\n" + "=" * 60)
    print("BENCHMARK: VALI (python_vali) - PyNvEncoder")
    print("=" * 60)

    try:
        import python_vali as vali
    except ImportError:
        print("  python_vali not installed.")
        print("  Install: pip install python_vali")
        return None

    try:
        # Get NVENC params to verify GPU encoding support
        params = vali.GetNvencParams()
        print(f"  VALI NVENC params available: {len(params)} presets")
    except Exception as e:
        print(f"  ERROR: NVENC not available via VALI: {e}")
        return None

    # VALI encoding workflow:
    # 1. Create Surface (GPU memory)
    # 2. Upload frame data to Surface via PyFrameUploader
    # 3. Convert Surface format (BGRA -> NV12) via PySurfaceConverter
    # 4. Encode Surface via PyNvEncoder
    try:
        # Create uploader for BGRA frames
        uploader = vali.PyFrameUploader(w, h, vali.PixelFormat.BGRA, 0)

        # Create converter BGRA -> NV12
        converter = vali.PySurfaceConverter(
            w, h, vali.PixelFormat.BGRA, vali.PixelFormat.NV12, 0
        )

        # Create encoder
        encoder = vali.PyNvEncoder(
            {
                "preset": "P1",
                "tuning_info": "ultra_low_latency",
                "codec": "h264",
                "s": f"{w}x{h}",
                "bitrate": "8M",
                "bf": "0",
                "rc": "cbr",
            },
            0,  # GPU ID
        )
    except Exception as e:
        print(f"  ERROR: Failed to initialize VALI pipeline: {e}")
        return None

    latencies = []
    total_output = 0
    total_start = time.perf_counter()

    for i, frame in enumerate(frames):
        frame_np = np.frombuffer(frame, dtype=np.uint8).reshape((h, w, 4))

        t0 = time.perf_counter()
        try:
            # Upload to GPU surface
            surface_bgra = uploader.Run(frame_np)
            if surface_bgra is None or surface_bgra.Empty():
                continue

            # Convert BGRA -> NV12 on GPU
            surface_nv12 = converter.Run(surface_bgra)
            if surface_nv12 is None or surface_nv12.Empty():
                continue

            # Encode
            packet = np.ndarray(0, dtype=np.uint8)
            success = encoder.EncodeSingleSurface(surface_nv12, packet)
            if success and len(packet) > 0:
                total_output += len(packet)

        except Exception as e:
            if i == 0:
                print(f"  ERROR: VALI encode failed at frame {i}: {e}")
                return None
            break

        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000)

    # Flush
    flush_start = time.perf_counter()
    try:
        while True:
            packet = np.ndarray(0, dtype=np.uint8)
            success = encoder.Flush(packet)
            if not success or len(packet) == 0:
                break
            total_output += len(packet)
    except Exception:
        pass
    flush_time = (time.perf_counter() - flush_start) * 1000

    total_time = (time.perf_counter() - total_start) * 1000

    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    p50 = sorted(latencies)[len(latencies) // 2] if latencies else 0
    p99 = sorted(latencies)[int(len(latencies) * 0.99)] if latencies else 0
    fps = len(frames) / (total_time / 1000) if total_time > 0 else 0

    result = {
        "method": "VALI (python_vali) PyNvEncoder",
        "frames": len(frames),
        "total_ms": total_time,
        "flush_ms": flush_time,
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50,
        "p99_latency_ms": p99,
        "throughput_fps": fps,
        "output_bytes": total_output,
        "bits_per_frame": (total_output * 8 / len(frames)) if frames else 0,
    }

    print(f"  Frames:       {result['frames']}")
    print(f"  Total time:   {result['total_ms']:.1f} ms")
    print(f"  Flush time:   {result['flush_ms']:.1f} ms")
    print(f"  Avg latency:  {result['avg_latency_ms']:.2f} ms/frame (upload+convert+encode)")
    print(f"  P50 latency:  {result['p50_latency_ms']:.2f} ms")
    print(f"  P99 latency:  {result['p99_latency_ms']:.2f} ms")
    print(f"  Throughput:   {result['throughput_fps']:.1f} fps")
    print(f"  Output size:  {result['output_bytes']:,} bytes ({result['bits_per_frame']:.0f} bits/frame)")
    return result


# ---------------------------------------------------------------------------
# Summary comparison
# ---------------------------------------------------------------------------

def print_summary(results: List[dict]):
    """Print comparison summary table."""
    print("\n" + "=" * 60)
    print("SUMMARY COMPARISON")
    print("=" * 60)

    # Header
    print(f"{'Method':<42} {'Avg ms':>8} {'P50 ms':>8} {'P99 ms':>8} {'FPS':>8}")
    print("-" * 76)

    baseline_ms = None
    for r in results:
        if "error" in r:
            print(f"  {r['method']:<40} {'ERROR':>8}")
            continue

        label = r["method"]
        avg = r["avg_latency_ms"]
        p50 = r["p50_latency_ms"]
        p99 = r["p99_latency_ms"]
        fps = r["throughput_fps"]

        if baseline_ms is None:
            baseline_ms = avg

        speedup = ""
        if baseline_ms and baseline_ms > 0 and avg > 0:
            ratio = baseline_ms / avg
            if abs(ratio - 1.0) > 0.05:
                speedup = f" ({ratio:.1f}x)"

        print(f"  {label:<40} {avg:>7.2f} {p50:>8.2f} {p99:>8.2f} {fps:>7.1f}{speedup}")

    print()
    print("Notes:")
    print("  - FFmpeg subprocess latency includes pipe write + kernel copy overhead")
    print("  - PyNvVideoCodec CPU input includes host-to-device copy inside Encode()")
    print("  - PyNvVideoCodec GPU input is true zero-copy (data stays on GPU)")
    print("  - BGRA->NV12 conversion cost is measured separately (not in encode latency)")
    print("  - Real-world gains depend on CARLA frame source (CPU vs GPU memory)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Benchmark PyNvVideoCodec vs FFmpeg subprocess NVENC encoding"
    )
    parser.add_argument("--frames", type=int, default=NUM_FRAMES,
                        help=f"Number of frames to encode (default: {NUM_FRAMES})")
    parser.add_argument("--width", type=int, default=WIDTH,
                        help=f"Frame width (default: {WIDTH})")
    parser.add_argument("--height", type=int, default=HEIGHT,
                        help=f"Frame height (default: {HEIGHT})")
    args = parser.parse_args()

    print("PyNvVideoCodec vs FFmpeg NVENC Benchmark")
    print(f"Resolution: {args.width}x{args.height}, Frames: {args.frames}")
    print(f"Bitrate: {BITRATE}, Codec: H.264")

    # Check GPU
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            print(f"GPU: {result.stdout.strip()}")
    except Exception:
        print("WARNING: nvidia-smi not available")

    # Generate test frames
    print(f"\nGenerating {args.frames} synthetic BGRA frames ({args.width}x{args.height})...")
    gen_start = time.perf_counter()
    frames = generate_bgra_frames_cpu(args.frames, args.width, args.height)
    gen_time = (time.perf_counter() - gen_start) * 1000
    frame_size_mb = len(frames[0]) / (1024 * 1024)
    print(f"  Generated in {gen_time:.0f} ms ({frame_size_mb:.1f} MB/frame)")

    results = []

    # Benchmark 1: FFmpeg subprocess (baseline)
    r1 = bench_ffmpeg_subprocess(frames, args.width, args.height)
    results.append(r1)

    # Benchmark 2: PyNvVideoCodec CPU input
    r2 = bench_pynvvideocodec(frames, args.width, args.height)
    if r2:
        results.append(r2)

    # Benchmark 3: PyNvVideoCodec GPU input (zero-copy)
    r3 = bench_pynvvideocodec_gpu(frames, args.width, args.height)
    if r3:
        results.append(r3)

    # Benchmark 4: VALI alternative
    r4 = bench_vali(frames, args.width, args.height)
    if r4:
        results.append(r4)

    # Summary
    if len(results) > 1:
        print_summary(results)
    elif len(results) == 1:
        print("\nOnly one benchmark ran. Install PyNvVideoCodec or VALI for comparison:")
        print("  pip install PyNvVideoCodec        # NVIDIA official")
        print("  pip install python_vali           # VALI (VPF successor)")
        print("  pip install cupy-cuda12x          # For GPU-side BGRA->NV12 conversion")


if __name__ == "__main__":
    main()
