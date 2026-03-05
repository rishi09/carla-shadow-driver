"""
test_streamer.py -- Test harness for game_streamer library.

Generates synthetic frames (animated gradient with a moving box)
and streams them via GameStreamer to verify the full pipeline works.

Usage:
    python test_streamer.py                  # Auto-detect encoder
    python test_streamer.py --backend ffmpeg # Force FFmpeg backend
    python test_streamer.py --software       # CPU-only (no GPU needed)
    python test_streamer.py --port 9000      # Custom port

Then open viewer.html in a browser and connect to ws://localhost:8765
"""

import argparse
import asyncio
import logging
import time

import numpy as np

from game_streamer import GameStreamer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test")


def generate_frame(width: int, height: int, frame_num: int) -> np.ndarray:
    """Generate a synthetic BGRA test frame with animated elements.

    Creates a color gradient background with a bouncing white box
    and frame counter overlay. This validates that:
    - Pixel data flows correctly through the pipeline
    - Motion is visible (proves frames are updating, not stuck)
    - Color channels are in the right order (BGRA, not RGBA)
    """
    frame = np.zeros((height, width, 4), dtype=np.uint8)

    # Animated gradient background
    t = frame_num / 60.0  # Time parameter
    for y in range(height):
        r = int(127 + 127 * np.sin(2 * np.pi * y / height + t))
        g = int(127 + 127 * np.sin(2 * np.pi * y / height + t + 2.094))
        b = int(127 + 127 * np.sin(2 * np.pi * y / height + t + 4.189))
        frame[y, :, 0] = b   # Blue channel
        frame[y, :, 1] = g   # Green channel
        frame[y, :, 2] = r   # Red channel
        frame[y, :, 3] = 255 # Alpha

    # Bouncing white box (proves motion)
    box_size = 80
    box_x = int((width - box_size) * (0.5 + 0.4 * np.sin(t * 1.5)))
    box_y = int((height - box_size) * (0.5 + 0.4 * np.cos(t * 1.1)))
    frame[box_y:box_y + box_size, box_x:box_x + box_size, :3] = 255

    # Frame counter in top-left (simple block digits)
    # Draw a block for the frame number (crude but GPU-free)
    counter_y, counter_x = 20, 20
    digit_w, digit_h = 8, 12
    for i, ch in enumerate(f"F{frame_num:05d}"):
        cx = counter_x + i * (digit_w + 2)
        val = ord(ch) * 3 % 200 + 55
        frame[counter_y:counter_y + digit_h, cx:cx + digit_w, :3] = val

    return frame


async def main():
    parser = argparse.ArgumentParser(description="Test the GameStreamer library")
    parser.add_argument("--width", type=int, default=1280, help="Frame width")
    parser.add_argument("--height", type=int, default=720, help="Frame height")
    parser.add_argument("--fps", type=int, default=30, help="Target FPS")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port")
    parser.add_argument("--bitrate", type=int, default=4_000_000, help="Bitrate (bps)")
    parser.add_argument("--backend", choices=["auto", "gstreamer", "ffmpeg", "software"],
                        default="auto", help="Encoder backend")
    parser.add_argument("--software", action="store_true",
                        help="Use software encoder (no GPU)")
    parser.add_argument("--duration", type=int, default=0,
                        help="Stop after N seconds (0=infinite)")
    args = parser.parse_args()

    backend = "software" if args.software else args.backend

    streamer = GameStreamer(
        width=args.width,
        height=args.height,
        fps=args.fps,
        encoder=backend,
        port=args.port,
        bitrate=args.bitrate,
    )

    logger.info(f"Starting GameStreamer ({args.width}x{args.height}@{args.fps}fps)")
    logger.info(f"Open viewer.html and connect to ws://localhost:{args.port}")

    await streamer.start()

    frame_num = 0
    frame_interval = 1.0 / args.fps
    start_time = time.monotonic()
    last_stats = start_time

    try:
        while True:
            t0 = time.monotonic()

            # Generate and send frame
            frame = generate_frame(args.width, args.height, frame_num)
            streamer.send_frame(frame)
            frame_num += 1

            # Print stats every 5 seconds
            if t0 - last_stats >= 5.0:
                m = streamer.metrics.to_dict()
                logger.info(
                    f"[stats] fps={m['fps']:.1f} encode={m['encode_ms_avg']:.1f}ms "
                    f"bitrate={m['bitrate_kbps']}kbps sent={m['frames_sent']} "
                    f"clients={m['clients']} backend={m['backend']}"
                )
                last_stats = t0

            # Check duration limit
            if args.duration > 0 and (t0 - start_time) >= args.duration:
                break

            # Sleep to maintain target FPS
            elapsed = time.monotonic() - t0
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            else:
                await asyncio.sleep(0)  # Yield to event loop

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    finally:
        await streamer.stop()
        m = streamer.metrics.to_dict()
        logger.info(f"Final stats: {m}")


if __name__ == "__main__":
    asyncio.run(main())
