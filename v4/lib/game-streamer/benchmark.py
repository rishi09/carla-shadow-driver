"""
benchmark.py -- Compare GStreamer vs FFmpeg encoder backends.

Runs both backends side-by-side on synthetic frames and reports
latency, throughput, CPU/GPU usage for each.

Usage:
    python benchmark.py                    # Full benchmark
    python benchmark.py --frames 300       # Custom frame count
    python benchmark.py --resolution 1080  # 1920x1080

Output:
    Markdown table comparing backends across key metrics.

Requires:
    - GStreamer with nvh264enc (for GStreamer backend test)
    - FFmpeg with h264_nvenc (for FFmpeg backend test)
    - psutil (for CPU measurement)
    - nvidia-smi (for GPU measurement)
"""

import argparse
import asyncio
import json
import logging
import os
import subprocess
import time
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

# Import our library
from game_streamer import GStreamerEncoder, FFmpegEncoder

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("benchmark")


@dataclass
class BenchmarkResult:
    """Results from a single benchmark run."""
    backend: str
    resolution: str
    total_frames: int
    duration_seconds: float
    fps_achieved: float
    encode_ms_avg: float
    encode_ms_p50: float
    encode_ms_p95: float
    encode_ms_p99: float
    encode_ms_min: float
    encode_ms_max: float
    output_bytes_total: int
    output_bitrate_kbps: float
    cpu_percent_avg: float
    startup_ms: float
    error_count: int


def generate_test_frames(width: int, height: int, count: int) -> List[bytes]:
    """Pre-generate test frames to remove generation overhead from benchmark."""
    print(f"  Generating {count} test frames ({width}x{height})...")
    frames = []
    for i in range(count):
        frame = np.zeros((height, width, 4), dtype=np.uint8)
        t = i / 30.0
        # Gradient + motion
        y_coords = np.arange(height).reshape(-1, 1)
        frame[:, :, 0] = ((y_coords * 255 // height + int(t * 50)) % 256).astype(np.uint8)
        frame[:, :, 1] = ((y_coords * 200 // height + int(t * 30)) % 256).astype(np.uint8)
        frame[:, :, 2] = ((y_coords * 150 // height + int(t * 70)) % 256).astype(np.uint8)
        frame[:, :, 3] = 255
        # Moving box
        bx = int((width - 100) * (0.5 + 0.4 * np.sin(t)))
        by = int((height - 100) * (0.5 + 0.4 * np.cos(t * 0.7)))
        frame[by:by + 100, bx:bx + 100, :3] = 255
        frames.append(frame.tobytes())
    return frames


def get_cpu_percent() -> float:
    """Get current process CPU percentage."""
    try:
        import psutil
        return psutil.Process(os.getpid()).cpu_percent()
    except ImportError:
        return 0.0


def get_gpu_utilization() -> Optional[float]:
    """Get NVIDIA GPU utilization percentage via nvidia-smi."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return float(result.stdout.strip().split('\n')[0])
    except Exception:
        pass
    return None


def benchmark_encoder(encoder, frames: List[bytes], label: str) -> Optional[BenchmarkResult]:
    """Run a benchmark on a single encoder backend."""
    width = 1280  # Default, will be overridden
    height = 720

    print(f"\n  [{label}] Starting encoder...")

    # Measure startup time
    t_start = time.monotonic()
    success = encoder.start()
    startup_ms = (time.monotonic() - t_start) * 1000

    if not success:
        print(f"  [{label}] FAILED to start encoder. Skipping.")
        return None

    print(f"  [{label}] Encoder started in {startup_ms:.0f}ms")

    encode_times = []
    output_sizes = []
    errors = 0
    cpu_samples = []

    # Warm up: encode 5 frames
    for frame_data in frames[:5]:
        encoder.encode_frame(frame_data)
        time.sleep(0.01)

    # Drain warmup output
    while True:
        result = encoder.get_encoded_frame()
        if result is None:
            break

    # Main benchmark
    print(f"  [{label}] Encoding {len(frames)} frames...")
    t_bench_start = time.monotonic()

    for i, frame_data in enumerate(frames):
        t0 = time.monotonic()
        ok = encoder.encode_frame(frame_data)
        encode_ms = (time.monotonic() - t0) * 1000
        encode_times.append(encode_ms)

        if not ok:
            errors += 1

        # Sample CPU every 30 frames
        if i % 30 == 0:
            cpu_samples.append(get_cpu_percent())

    # Allow pipeline to flush
    time.sleep(0.5)

    # Drain all output
    while True:
        result = encoder.get_encoded_frame()
        if result is None:
            break
        _, data = result
        output_sizes.append(len(data))

    t_bench_end = time.monotonic()
    duration = t_bench_end - t_bench_start

    encoder.stop()

    if not encode_times:
        print(f"  [{label}] No encode times recorded!")
        return None

    # Compute statistics
    encode_sorted = sorted(encode_times)
    n = len(encode_sorted)

    result = BenchmarkResult(
        backend=label,
        resolution=f"{encoder.width}x{encoder.height}",
        total_frames=len(frames),
        duration_seconds=round(duration, 2),
        fps_achieved=round(len(frames) / duration, 1),
        encode_ms_avg=round(sum(encode_times) / n, 2),
        encode_ms_p50=round(encode_sorted[n // 2], 2),
        encode_ms_p95=round(encode_sorted[int(n * 0.95)], 2),
        encode_ms_p99=round(encode_sorted[int(n * 0.99)], 2),
        encode_ms_min=round(encode_sorted[0], 2),
        encode_ms_max=round(encode_sorted[-1], 2),
        output_bytes_total=sum(output_sizes),
        output_bitrate_kbps=round(sum(output_sizes) * 8 / 1000 / max(duration, 0.01), 1),
        cpu_percent_avg=round(sum(cpu_samples) / max(len(cpu_samples), 1), 1),
        startup_ms=round(startup_ms, 0),
        error_count=errors,
    )

    print(f"  [{label}] Done: {result.fps_achieved} FPS, "
          f"avg encode {result.encode_ms_avg}ms, "
          f"p95 {result.encode_ms_p95}ms, "
          f"output {result.output_bitrate_kbps} kbps")

    return result


def print_results(results: List[BenchmarkResult]):
    """Print results as a markdown table."""
    print("\n" + "=" * 80)
    print("BENCHMARK RESULTS")
    print("=" * 80)

    headers = [
        "Backend", "Resolution", "FPS", "Encode Avg", "Encode P95",
        "Encode P99", "Bitrate", "Startup", "Errors"
    ]
    print(f"\n| {'|'.join(f' {h:>12s} ' for h in headers)} |")
    print(f"|{'|'.join('-' * 14 for _ in headers)}|")

    for r in results:
        row = [
            r.backend,
            r.resolution,
            f"{r.fps_achieved:.0f}",
            f"{r.encode_ms_avg:.1f}ms",
            f"{r.encode_ms_p95:.1f}ms",
            f"{r.encode_ms_p99:.1f}ms",
            f"{r.output_bitrate_kbps:.0f}kbps",
            f"{r.startup_ms:.0f}ms",
            str(r.error_count),
        ]
        print(f"| {'|'.join(f' {v:>12s} ' for v in row)} |")

    # Comparison summary
    if len(results) >= 2:
        print("\n--- Comparison ---")
        a, b = results[0], results[1]
        if a.encode_ms_avg > 0 and b.encode_ms_avg > 0:
            ratio = a.encode_ms_avg / b.encode_ms_avg
            faster = a.backend if ratio < 1 else b.backend
            factor = min(ratio, 1 / ratio)
            print(f"  Encode latency: {faster} is {1/factor:.1f}x faster on average")
        if a.fps_achieved > 0 and b.fps_achieved > 0:
            higher = a.backend if a.fps_achieved > b.fps_achieved else b.backend
            print(f"  Throughput: {higher} achieved higher FPS "
                  f"({max(a.fps_achieved, b.fps_achieved):.0f} vs "
                  f"{min(a.fps_achieved, b.fps_achieved):.0f})")
        if a.startup_ms > 0 and b.startup_ms > 0:
            faster_start = a.backend if a.startup_ms < b.startup_ms else b.backend
            print(f"  Startup: {faster_start} starts faster "
                  f"({min(a.startup_ms, b.startup_ms):.0f}ms vs "
                  f"{max(a.startup_ms, b.startup_ms):.0f}ms)")


def main():
    parser = argparse.ArgumentParser(description="Benchmark GStreamer vs FFmpeg")
    parser.add_argument("--frames", type=int, default=300, help="Number of test frames")
    parser.add_argument("--resolution", type=int, default=720,
                        help="Vertical resolution (720, 1080)")
    parser.add_argument("--bitrate", type=int, default=8_000_000, help="Target bitrate")
    parser.add_argument("--fps", type=int, default=30, help="Target FPS")
    args = parser.parse_args()

    if args.resolution >= 1080:
        width, height = 1920, 1080
    else:
        width, height = 1280, 720

    print(f"Benchmark: {width}x{height} @ {args.fps}fps, {args.frames} frames, "
          f"bitrate={args.bitrate // 1000}kbps")

    # Pre-generate frames
    frames = generate_test_frames(width, height, args.frames)

    results = []

    # GPU info
    gpu_util = get_gpu_utilization()
    if gpu_util is not None:
        print(f"GPU utilization at start: {gpu_util}%")

    # --- GStreamer NVENC ---
    print("\n[1/3] Benchmarking GStreamer + NVENC...")
    gst_enc = GStreamerEncoder(width, height, args.fps, args.bitrate)
    if gst_enc._import_gstreamer() and gst_enc._check_nvenc_available():
        r = benchmark_encoder(gst_enc, frames, "GStreamer-NVENC")
        if r:
            results.append(r)
    else:
        print("  GStreamer NVENC not available, skipping")

    # --- FFmpeg NVENC ---
    print("\n[2/3] Benchmarking FFmpeg + NVENC...")
    ff_enc = FFmpegEncoder(width, height, args.fps, args.bitrate, use_gpu=True)
    r = benchmark_encoder(ff_enc, frames, "FFmpeg-NVENC")
    if r:
        results.append(r)

    # --- FFmpeg x264 (software) ---
    print("\n[3/3] Benchmarking FFmpeg + x264 (software)...")
    sw_enc = FFmpegEncoder(width, height, args.fps, args.bitrate, use_gpu=False)
    r = benchmark_encoder(sw_enc, frames, "FFmpeg-x264")
    if r:
        results.append(r)

    if results:
        print_results(results)
    else:
        print("\nNo benchmarks completed successfully.")
        print("Check that GStreamer and/or FFmpeg are installed with NVENC support.")


if __name__ == "__main__":
    main()
