#!/usr/bin/env python3
"""
WebTransport PoC Server for Shadow Driver v3
---------------------------------------------
Sends fake "video frames" (50KB random blobs) at 30fps as datagrams (fragmented)
and fake "telemetry" (JSON) at 30Hz on a reliable unidirectional stream.

Usage:
    python server.py [--host 0.0.0.0] [--port 4433] [--cert cert.pem] [--key key.pem]

Requires: aioquic >= 1.2.0
    pip install aioquic

Generate self-signed cert (required for WebTransport):
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
        -days 14 -nodes -keyout key.pem -out cert.pem \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
"""

import argparse
import asyncio
import hashlib
import json
import os
import struct
import time
from typing import Dict, Optional

from aioquic.asyncio import QuicConnectionProtocol, serve
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import (
    DatagramReceived,
    H3Event,
    HeadersReceived,
    WebTransportStreamDataReceived,
)
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import DatagramFrameReceived, QuicEvent

# --- Constants ---
VIDEO_FPS = 30
VIDEO_FRAME_SIZE = 50_000  # 50KB fake frame
TELEMETRY_HZ = 30
# QUIC datagrams are limited by path MTU (~1200 bytes).
# We fragment video frames into chunks that fit in a single datagram.
# Header: 4 bytes frame_id + 2 bytes chunk_idx + 2 bytes total_chunks + 8 bytes timestamp
DATAGRAM_HEADER_SIZE = 16
MAX_DATAGRAM_PAYLOAD = 1100  # conservative, leaves room for QUIC/HTTP3 overhead
CHUNK_DATA_SIZE = MAX_DATAGRAM_PAYLOAD - DATAGRAM_HEADER_SIZE


class WebTransportSession:
    """Manages a single WebTransport session with video + telemetry."""

    def __init__(self, session_id: int, protocol: "WebTransportProtocol"):
        self.session_id = session_id
        self.protocol = protocol
        self.accepted = False
        self._video_task: Optional[asyncio.Task] = None
        self._telemetry_task: Optional[asyncio.Task] = None
        self._frame_id = 0
        self._start_time = time.monotonic()
        self._frames_sent = 0
        self._telemetry_sent = 0
        self._telemetry_stream_id: Optional[int] = None

    async def start(self):
        """Start sending video datagrams and telemetry stream."""
        self.accepted = True
        self._start_time = time.monotonic()
        # Open a unidirectional stream for telemetry
        self._telemetry_stream_id = self.protocol._quic.get_next_available_stream_id(
            is_unidirectional=True
        )
        self._video_task = asyncio.ensure_future(self._send_video_loop())
        self._telemetry_task = asyncio.ensure_future(self._send_telemetry_loop())
        print(f"[session {self.session_id}] Started video + telemetry streams")

    async def stop(self):
        """Stop all sending tasks."""
        for task in [self._video_task, self._telemetry_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        elapsed = time.monotonic() - self._start_time
        print(
            f"[session {self.session_id}] Stopped. "
            f"Sent {self._frames_sent} frames, {self._telemetry_sent} telemetry "
            f"in {elapsed:.1f}s ({self._frames_sent/max(elapsed,0.01):.1f} fps)"
        )

    async def _send_video_loop(self):
        """Send fake video frames as fragmented datagrams at 30fps."""
        interval = 1.0 / VIDEO_FPS
        while True:
            t0 = time.monotonic()
            self._frame_id += 1
            frame_data = os.urandom(VIDEO_FRAME_SIZE)
            timestamp_ns = int(time.monotonic() * 1_000_000)  # microseconds

            # Fragment frame into MTU-sized chunks
            total_chunks = (len(frame_data) + CHUNK_DATA_SIZE - 1) // CHUNK_DATA_SIZE
            for i in range(total_chunks):
                offset = i * CHUNK_DATA_SIZE
                chunk = frame_data[offset : offset + CHUNK_DATA_SIZE]
                # Header: frame_id(4) + chunk_idx(2) + total_chunks(2) + timestamp(8)
                header = struct.pack(
                    "!IHHQ", self._frame_id, i, total_chunks, timestamp_ns
                )
                datagram = header + chunk
                try:
                    self.protocol._http.send_datagram(
                        stream_id=self.session_id, data=datagram
                    )
                    self.protocol.transmit()
                except Exception as e:
                    print(f"[session {self.session_id}] Datagram send error: {e}")
                    return

            self._frames_sent += 1
            if self._frames_sent % 300 == 0:  # Log every 10s
                elapsed = time.monotonic() - self._start_time
                print(
                    f"[session {self.session_id}] "
                    f"Video: {self._frames_sent} frames in {elapsed:.1f}s "
                    f"({self._frames_sent/elapsed:.1f} fps), "
                    f"{total_chunks} chunks/frame"
                )

            # Sleep remainder of interval
            dt = time.monotonic() - t0
            if dt < interval:
                await asyncio.sleep(interval - dt)

    async def _send_telemetry_loop(self):
        """Send fake telemetry JSON on a reliable unidirectional stream."""
        interval = 1.0 / TELEMETRY_HZ
        while True:
            t0 = time.monotonic()
            telemetry = {
                "type": "telemetry",
                "ts": int(time.monotonic() * 1_000_000),
                "speed": 120.5 + (self._telemetry_sent % 40),
                "rpm": 5000 + (self._telemetry_sent % 2000),
                "gear": 4,
                "lap": 1,
                "pos": [100.0, 200.0, 0.5],
                "seq": self._telemetry_sent,
            }
            data = json.dumps(telemetry).encode() + b"\n"
            try:
                self.protocol._quic.send_stream_data(
                    self._telemetry_stream_id, data, end_stream=False
                )
                self.protocol.transmit()
            except Exception as e:
                print(f"[session {self.session_id}] Telemetry send error: {e}")
                return

            self._telemetry_sent += 1
            dt = time.monotonic() - t0
            if dt < interval:
                await asyncio.sleep(interval - dt)


class WebTransportProtocol(QuicConnectionProtocol):
    """HTTP/3 protocol handler with WebTransport support."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._http: Optional[H3Connection] = None
        self._sessions: Dict[int, WebTransportSession] = {}

    def quic_event_received(self, event: QuicEvent):
        if self._http is None:
            self._http = H3Connection(self._quic, enable_webtransport=True)

        for h3_event in self._http.handle_event(event):
            self._h3_event_received(h3_event)

    def _h3_event_received(self, event: H3Event):
        if isinstance(event, HeadersReceived):
            headers = dict(event.headers)
            method = headers.get(b":method", b"").decode()
            path = headers.get(b":path", b"").decode()
            protocol = headers.get(b":protocol", b"").decode()

            if method == "CONNECT" and protocol == "webtransport":
                # Accept WebTransport session
                self._http.send_headers(
                    stream_id=event.stream_id,
                    headers=[
                        (b":status", b"200"),
                        (b"sec-webtransport-http3-draft", b"draft02"),
                    ],
                )
                self.transmit()
                session = WebTransportSession(event.stream_id, self)
                self._sessions[event.stream_id] = session
                asyncio.ensure_future(session.start())
                print(f"[server] WebTransport session accepted: {event.stream_id}")

            elif method == "GET" and path == "/":
                # Serve the test client HTML
                self._serve_client_page(event.stream_id)

            else:
                self._http.send_headers(
                    stream_id=event.stream_id,
                    headers=[(b":status", b"404")],
                    end_stream=True,
                )
                self.transmit()

        elif isinstance(event, DatagramReceived):
            # Client sent a datagram (e.g., ping)
            data = event.data
            if data == b"ping":
                self._http.send_datagram(
                    stream_id=event.stream_id, data=b"pong"
                )
                self.transmit()

        elif isinstance(event, WebTransportStreamDataReceived):
            # Client data on a stream (unused in this PoC)
            pass

    def _serve_client_page(self, stream_id: int):
        """Serve the HTML test client."""
        try:
            client_path = os.path.join(os.path.dirname(__file__), "client.html")
            with open(client_path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            body = b"<h1>client.html not found</h1>"

        self._http.send_headers(
            stream_id=stream_id,
            headers=[
                (b":status", b"200"),
                (b"content-type", b"text/html; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        )
        self._http.send_data(stream_id=stream_id, data=body, end_stream=True)
        self.transmit()

    def connection_lost(self, exc):
        for session in self._sessions.values():
            asyncio.ensure_future(session.stop())
        self._sessions.clear()
        super().connection_lost(exc)


def main():
    parser = argparse.ArgumentParser(description="WebTransport PoC Server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=4433, help="Listen port")
    parser.add_argument("--cert", default="cert.pem", help="TLS certificate")
    parser.add_argument("--key", default="key.pem", help="TLS private key")
    args = parser.parse_args()

    # Configure QUIC
    config = QuicConfiguration(
        alpn_protocols=H3_ALPN,
        is_client=False,
        max_datagram_frame_size=65536,
    )
    config.load_cert_chain(args.cert, args.key)

    print(f"[server] Starting WebTransport server on {args.host}:{args.port}")
    print(f"[server] Open https://localhost:{args.port}/ in Chrome for the test client")
    print(f"[server] Video: {VIDEO_FPS}fps, {VIDEO_FRAME_SIZE//1000}KB frames, "
          f"{MAX_DATAGRAM_PAYLOAD}B datagrams")

    loop = asyncio.get_event_loop()
    loop.run_until_complete(
        serve(
            args.host,
            args.port,
            configuration=config,
            create_protocol=WebTransportProtocol,
        )
    )

    try:
        loop.run_forever()
    except KeyboardInterrupt:
        print("\n[server] Shutting down")


if __name__ == "__main__":
    main()
