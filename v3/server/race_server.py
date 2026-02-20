"""
Race Server - Main loop: CARLA + WebSocket + model inference
Runs on the GPU instance, connects to CARLA, streams frames to browser
"""
import asyncio
import json
import time
import signal
import sys
import os
import urllib.request
import yaml
import numpy as np
from typing import Optional, Dict, Set

import websockets

from aiortc import RTCPeerConnection, RTCSessionDescription, RTCRtpSender
from webrtc_track import CarlaVideoTrack, force_codec
from nvenc_encoder import NVENCEncoder

from carla_manager import RaceManager
from model_manager import ModelManager
from frame_encoder import FrameEncoder
from race_logic import RaceState, generate_checkpoints_from_waypoints, RaceDirector, AIMistakeGenerator, TrashTalkManager, WeatherMoodManager, compute_coaching_tips
from weather_transitions import WeatherTransitionManager
from weather_manager import WeatherManager
from ai_personality import AIPersonality
from skill_matcher import SkillMatcher
from highlight_buffer import HighlightBuffer
from cost_tracker import CostTracker, DEFAULT_HOURLY_RATE, DEFAULT_DAILY_ALERT_THRESHOLD
from training_recorder import TrainingRecorder
from nvfbc_capture import NvFBCCapture


# ---------------------------------------------------------------------------
# Auto-shutdown: destroy Vast.ai instance after 10 min with no connections
# ---------------------------------------------------------------------------

IDLE_TIMEOUT_SECONDS = 10 * 60  # 10 minutes
IDLE_LOG_INTERVAL = 60          # Log countdown every 60 seconds

class AutoShutdownManager:
    """Tracks WebSocket connections and destroys the Vast.ai instance after
    a configurable idle period with zero connected clients."""

    def __init__(self):
        self.connected_clients: Set[websockets.WebSocketServerProtocol] = set()
        self._idle_task: Optional[asyncio.Task] = None
        self._shutdown_in_progress = False

        # Resolve Vast.ai instance ID from environment
        container_label = os.environ.get("VAST_CONTAINERLABEL", "")  # "C.{id}"
        if container_label.startswith("C."):
            self.instance_id = container_label[2:]
        else:
            self.instance_id = os.environ.get("INSTANCE_ID", "")

        self.api_key = os.environ.get("VASTAI_API_KEY", "")

        if self.instance_id:
            print(f"[auto-shutdown] Vast.ai instance ID: {self.instance_id}")
        else:
            print("[auto-shutdown] WARNING: No instance ID found (VAST_CONTAINERLABEL / INSTANCE_ID). "
                  "Auto-shutdown will only terminate the process, not the instance.")

        if not self.api_key:
            print("[auto-shutdown] WARNING: VASTAI_API_KEY not set. "
                  "Auto-shutdown will only terminate the process, not the instance.")

    def client_connected(self, ws: websockets.WebSocketServerProtocol):
        """Register a new client connection and cancel any pending shutdown."""
        self.connected_clients.add(ws)
        count = len(self.connected_clients)
        print(f"[auto-shutdown] Client connected. Active connections: {count}")

        # Cancel the idle timer if one is running
        if self._idle_task and not self._idle_task.done():
            self._idle_task.cancel()
            self._idle_task = None
            print("[auto-shutdown] Idle shutdown timer cancelled (client connected)")

    def client_disconnected(self, ws: websockets.WebSocketServerProtocol):
        """Unregister a client and start the idle timer if no clients remain."""
        self.connected_clients.discard(ws)
        count = len(self.connected_clients)
        print(f"[auto-shutdown] Client disconnected. Active connections: {count}")

        if count == 0 and not self._shutdown_in_progress:
            print(f"[auto-shutdown] No connections. Starting {IDLE_TIMEOUT_SECONDS // 60}-minute shutdown timer...")
            self._idle_task = asyncio.create_task(self._idle_countdown())

    async def _idle_countdown(self):
        """Wait for the idle timeout, logging progress each minute."""
        remaining = IDLE_TIMEOUT_SECONDS
        try:
            while remaining > 0:
                minutes_left = remaining // 60
                seconds_left = remaining % 60
                if seconds_left == 0:
                    print(f"[auto-shutdown] Auto-shutdown in {minutes_left} minute{'s' if minutes_left != 1 else ''} (no connections)")
                await asyncio.sleep(IDLE_LOG_INTERVAL)
                remaining -= IDLE_LOG_INTERVAL

            # Timer expired — destroy the instance
            await self._destroy_instance()

        except asyncio.CancelledError:
            # Timer was cancelled because a client reconnected
            pass

    async def _destroy_instance(self):
        """Notify remaining clients and destroy the Vast.ai GPU instance."""
        self._shutdown_in_progress = True
        print("[auto-shutdown] No connections for 10 minutes, destroying instance")

        # Send shutdown warning to any clients that may have connected in the last moment
        shutdown_msg = json.dumps({
            "type": "server_shutdown",
            "reason": "idle_timeout",
            "message": "Server shutting down due to inactivity",
        })
        for ws in list(self.connected_clients):
            try:
                await ws.send(shutdown_msg)
                await ws.close()
            except Exception:
                pass

        # Attempt to destroy the Vast.ai instance via API
        if self.instance_id and self.api_key:
            api_base = "https://console.vast.ai/api/v0"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            }

            loop = asyncio.get_event_loop()

            def _api_stop():
                """Synchronous API calls to stop/destroy the instance (runs in thread pool)."""
                # First try: PUT state=stopped
                stop_url = f"{api_base}/instances/{self.instance_id}/"
                print(f"[auto-shutdown] Sending stop request: PUT {stop_url}")
                try:
                    req = urllib.request.Request(
                        stop_url, method="PUT",
                        data=json.dumps({"state": "stopped"}).encode(),
                        headers=headers,
                    )
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        body = resp.read().decode()[:200]
                        print(f"[auto-shutdown] Stop response: {resp.status} {body}")
                except Exception as e:
                    print(f"[auto-shutdown] Stop request error: {e}")

                # Also try: DELETE to fully destroy
                destroy_url = f"{api_base}/instances/{self.instance_id}/"
                print(f"[auto-shutdown] Sending destroy request: DELETE {destroy_url}")
                try:
                    req = urllib.request.Request(
                        destroy_url, method="DELETE",
                        headers=headers,
                    )
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        body = resp.read().decode()[:200]
                        print(f"[auto-shutdown] Destroy response: {resp.status} {body}")
                except Exception as e:
                    print(f"[auto-shutdown] Destroy request error: {e}")

            try:
                await loop.run_in_executor(None, _api_stop)
            except Exception as e:
                print(f"[auto-shutdown] API error: {e}")
        else:
            print("[auto-shutdown] No instance ID or API key — cannot call Vast.ai API")

        # Forcefully exit the process as a fallback
        print("[auto-shutdown] Exiting process...")
        sys.exit(0)


class RaceServer:
    """WebSocket server that runs the CARLA race loop."""

    # Vercel API URLs for social presence callbacks
    CALLBACK_URL = os.environ.get('CALLBACK_URL', 'https://shadow-driver-v3.vercel.app/api/gpu/callback')
    RACE_COMPLETE_URL = os.environ.get('RACE_COMPLETE_URL', 'https://shadow-driver-v3.vercel.app/api/gpu/race-complete')
    ACTIVITY_PING_URL = os.environ.get('ACTIVITY_PING_URL', 'https://shadow-driver-v3.vercel.app/api/activity/ping')

    def __init__(self, config_path: str = "configs/race.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)

        self.carla = RaceManager(config_path)
        self.model = ModelManager()
        self.encoder = FrameEncoder(
            quality=self.config.get('streaming', {}).get('jpeg_quality', 70),
            max_width=self.config.get('streaming', {}).get('width', 1280),
            max_height=self.config.get('streaming', {}).get('height', 720),
        )
        # Separate encoder for rear-view mirror: lower quality, smaller resolution
        self.rear_encoder = FrameEncoder(
            quality=30,
            max_width=320,
            max_height=120,
        )

        self.race_state: Optional[RaceState] = None
        self.player_keys: Dict[str, bool] = {'w': False, 'a': False, 's': False, 'd': False, 'space': False}
        self.current_model_name = self.config['model'].get('default', 'carla_pilotnet')
        self.running = False
        self.ws_client = None
        self.frame_count = 0
        self.fps = 0.0
        self._fps_timer = time.time()
        self._fps_count = 0
        self._race_task: Optional[asyncio.Task] = None
        self._telemetry_task: Optional[asyncio.Task] = None
        self._controls_received = False  # Track if we've ever received controls
        self.difficulty: str = 'easy'  # Current difficulty: 'easy', 'medium', 'hard'
        self.race_director: Optional[RaceDirector] = None
        self.mistake_generator: Optional[AIMistakeGenerator] = None
        self.weather_manager: Optional[WeatherTransitionManager] = None
        self.weather_mood: Optional[WeatherMoodManager] = None
        self.weather_event_manager: Optional[WeatherManager] = None
        self.trash_talk: Optional[TrashTalkManager] = None
        self.ai_personality: Optional[AIPersonality] = None
        self.skill_matcher: Optional[SkillMatcher] = None
        self.pc: Optional[RTCPeerConnection] = None
        self.video_track: Optional[CarlaVideoTrack] = None

        # --- WebRTC data channel for low-latency controls (UDP) ---
        self._dc_pc: Optional[RTCPeerConnection] = None  # Peer connection for data channel
        self._controls_dc = None  # RTCDataChannel for receiving controls
        self._dc_controls_active: bool = False  # True when data channel is open and receiving

        # Auto-shutdown manager (shared across all client connections)
        self.shutdown_manager = AutoShutdownManager()

        # --- Highlight ring buffer (stores last 5s of frames for replay) ---
        self.highlight_buffer = HighlightBuffer()

        # --- Instance cost tracker ---
        cost_rate = float(os.environ.get('GPU_HOURLY_RATE', str(DEFAULT_HOURLY_RATE)))
        cost_threshold = float(os.environ.get('GPU_DAILY_BUDGET', str(DEFAULT_DAILY_ALERT_THRESHOLD)))
        self.cost_tracker = CostTracker(
            hourly_rate=cost_rate,
            daily_threshold=cost_threshold,
        )

        # --- Training data recorder (imitation learning) ---
        self.training_recorder = TrainingRecorder(max_frames=5000, frame_size=(200, 66))
        self._training_frame_counter: int = 0  # Counts race loop frames for 10Hz subsampling

        # --- Previous gap tracking for overtake detection in highlights ---
        self._prev_gap_seconds: Optional[float] = None
        self._highlight_collision_count: int = 0

        # --- Frame skip state (stationary camera optimization) ---
        self._last_sent_x: Optional[float] = None
        self._last_sent_y: Optional[float] = None
        self._last_sent_yaw: Optional[float] = None
        self._last_sent_time: float = 0.0
        self._frame_skip_count: int = 0  # Frames skipped since last perf log
        self._delta_skip_count: int = 0  # Frames skipped via frame delta detection

        # --- Per-second stats logging ---
        self._stats_frames_sent: int = 0        # Frames sent in current 1s window
        self._stats_skip_count: int = 0          # Frames skipped in current 1s window
        self._stats_latencies: list = []         # Latency samples in current 1s window
        self._stats_last_log_time: float = 0.0   # Timestamp of last per-second log

        # --- Session-level metrics (accumulated across entire connection) ---
        self._session_start_time: float = 0.0
        self._session_total_frames: int = 0
        self._session_total_skips: int = 0
        self._session_latencies: list = []       # All latency samples for the session
        self._session_qualities: list = []       # All quality samples for the session
        self._session_frame_sizes: list = []     # All frame sizes (bytes) for the session

        # --- Rear mirror frame counter (send at 15fps = every 2nd frame of the 30fps loop) ---
        self._rear_frame_counter: int = 0

        # --- Connection ID for session tracking ---
        self._connection_counter: int = 0

        # Instance ID for session reporting
        container_label = os.environ.get("VAST_CONTAINERLABEL", "")
        if container_label.startswith("C."):
            self._instance_id = container_label[2:]
        else:
            self._instance_id = os.environ.get("INSTANCE_ID", "unknown")

        # Player name (set by client on start_race)
        self._player_name: str = "Anonymous"

        # Activity ping task: sends periodic pings while clients are connected
        self._activity_ping_task: Optional[asyncio.Task] = None

        # --- NVENC H.264 encoder state ---
        self._nvenc_encoder: Optional[NVENCEncoder] = None
        self._h264_enabled: bool = False  # True if client negotiated h264
        self._client_supports_h264: bool = False

        # --- NvFBC GPU framebuffer capture (zero-copy alternative to CARLA sensor) ---
        # Initialized lazily when a race starts. Falls back to CARLA camera sensor
        # if NvFBC is unavailable (no Xvfb, no pynvfbc, consumer GPU, etc.)
        self._nvfbc_capture: Optional[NvFBCCapture] = None
        self._nvfbc_enabled: bool = False  # True if NvFBC is active for frame capture

        # --- Adaptive bitrate state ---
        self._current_bitrate_mbps: float = 8.0  # Current bitrate in Mbps
        self._last_bitrate_adjust_time: float = 0.0  # Rate-limit adaptation
        self._bitrate_min_mbps: float = 2.0
        self._bitrate_max_mbps: float = 12.0

    def _ping_activity(self):
        """Fire-and-forget HTTP POST to the activity ping endpoint.
        Records this instance as actively racing so the landing page
        can show a live spectator count."""
        def _do_post():
            try:
                payload = json.dumps({"instanceId": self._instance_id}).encode()
                req = urllib.request.Request(
                    self.ACTIVITY_PING_URL,
                    method="POST",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp.read()
            except Exception as e:
                # Don't crash if the API is unreachable
                print(f"[activity] Ping error (non-fatal): {e}")

        import threading
        threading.Thread(target=_do_post, daemon=True).start()

    async def _activity_ping_loop(self):
        """Send periodic activity pings every 45 seconds while clients are connected.
        The KV entry has a 60-second TTL, so pinging every 45s keeps it alive."""
        try:
            while True:
                if len(self.shutdown_manager.connected_clients) > 0:
                    self._ping_activity()
                await asyncio.sleep(45)
        except asyncio.CancelledError:
            pass

    def _report_callback(self, payload: dict):
        """Fire-and-forget HTTP POST to the callback URL (runs in background thread)."""
        def _do_post():
            try:
                data = json.dumps(payload).encode()
                req = urllib.request.Request(
                    self.CALLBACK_URL,
                    method="POST",
                    data=data,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp.read()
            except Exception as e:
                print(f"[social] Callback report error: {e}")

        import threading
        threading.Thread(target=_do_post, daemon=True).start()

    def _report_race_complete(self, name: str, track: str, player_time: float,
                              beat_ai: bool, gap: float, difficulty: str):
        """Fire-and-forget HTTP POST to report a completed race."""
        def _do_post():
            try:
                payload = {
                    "name": name,
                    "track": track,
                    "time": round(player_time, 2),
                    "beat_ai": beat_ai,
                    "gap": round(gap, 2),
                    "difficulty": difficulty,
                }
                data = json.dumps(payload).encode()
                req = urllib.request.Request(
                    self.RACE_COMPLETE_URL,
                    method="POST",
                    data=data,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp.read()
                print(f"[social] Race completion reported: {name} on {track}")
            except Exception as e:
                print(f"[social] Race complete report error: {e}")

        import threading
        threading.Thread(target=_do_post, daemon=True).start()

    async def handle_client(self, websocket):
        """Handle a single WebSocket client connection."""
        print(f"Client connected: {websocket.remote_address}")

        # Track connection for auto-shutdown
        self.shutdown_manager.client_connected(websocket)

        # Initialize session stats for this connection
        self._reset_session_stats()

        # Generate a unique connection ID for session tracking
        self._connection_counter += 1
        connection_id = f"{self._connection_counter}_{int(time.time())}"

        # Report session start for live player count
        self._report_callback({
            "instance_id": self._instance_id,
            "type": "session_start",
            "connection_id": connection_id,
        })

        # Send immediate activity ping and start periodic ping loop
        self._ping_activity()
        if self._activity_ping_task is None or self._activity_ping_task.done():
            self._activity_ping_task = asyncio.create_task(self._activity_ping_loop())

        # If there's an existing race running, stop it gracefully before accepting new client
        if self.running or self._race_task or self._telemetry_task:
            print("New client connected while race active — stopping previous race...")
            await self._reset_race()

        self.ws_client = websocket

        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    continue  # Ignore binary from client

                data = json.loads(message)
                msg_type = data.get('type')

                if msg_type == 'handshake':
                    await websocket.send(json.dumps({
                        'type': 'handshake_ack',
                        'server': 'shadow-driver-v3',
                        'models': ['carla_pilotnet', 'pilotnet', 'alpamayo'],
                    }))

                elif msg_type == 'control':
                    keys = data.get('keys', {})
                    self.player_keys = {
                        'w': keys.get('w', False),
                        'a': keys.get('a', False),
                        's': keys.get('s', False),
                        'd': keys.get('d', False),
                        'space': keys.get('space', False),
                    }
                    # Debug logging for controls
                    self._control_msg_count = getattr(self, '_control_msg_count', 0) + 1
                    if not self._controls_received:
                        self._controls_received = True
                        active = [k for k, v in self.player_keys.items() if v]
                        race_status = self.race_state.status if self.race_state else "no_race"
                        print(f"First control received (race_status={race_status}, keys={active or 'none'})")
                    elif self._control_msg_count % 30 == 0:
                        active = [k for k, v in self.player_keys.items() if v]
                        print(f"Controls #{self._control_msg_count}: {active or 'none'}")
                    # Adaptive JPEG quality based on client latency (piggy-backed on control messages)
                    latency = data.get('latency')
                    if latency is not None:
                        self.encoder.adapt_quality(float(latency))
                        self._record_latency(float(latency))

                elif msg_type == 'switch_model':
                    model_name = data.get('model', 'carla_pilotnet')
                    await self._switch_model(model_name)

                elif msg_type == 'latency_report':
                    # Client sends its measured round-trip latency (from ping/pong).
                    # We use it to adaptively adjust JPEG quality & resolution.
                    # NOTE: The frontend needs to send this message periodically:
                    #   ws.send(JSON.stringify({type: "latency_report", latency_ms: <number>}))
                    # This should be sent after each pong is received, e.g.:
                    #   const latency = Date.now() - pingTimestamp;
                    #   ws.send(JSON.stringify({type: "latency_report", latency_ms: latency}));
                    latency_ms = data.get('latency_ms')
                    if latency_ms is not None:
                        self.encoder.adapt_quality(float(latency_ms))
                        self._record_latency(float(latency_ms))

                elif msg_type == 'start_race':
                    track = data.get('track', 'Town03')
                    laps = data.get('laps', 3)
                    weather = data.get('weather', 'clear')
                    model = data.get('model', 'carla_pilotnet')
                    player_car = data.get('player_car')
                    time_of_day = data.get('time_of_day')
                    postprocess = data.get('postprocess', 'balanced')
                    # Capture player name for race completion reporting
                    self._player_name = data.get('player_name', 'Anonymous') or 'Anonymous'
                    self.current_model_name = model
                    await self._start_race(track, laps, weather, model, player_car=player_car, time_of_day=time_of_day, postprocess=postprocess)

                elif msg_type == 'ping':
                    await websocket.send(json.dumps({
                        'type': 'pong',
                        'timestamp': data.get('timestamp'),
                    }))

                elif msg_type == 'respawn':
                    self.carla.respawn_player()
                    await websocket.send(json.dumps({
                        'type': 'respawn_ack',
                    }))

                elif msg_type == 'camera_mode':
                    mode = data.get('mode', 'chase')
                    self.carla.set_camera_mode(mode)
                    # Reset frame delta hash since camera view changed completely
                    self.encoder.reset_frame_hash()
                    await websocket.send(json.dumps({
                        'type': 'camera_mode_changed',
                        'mode': self.carla._camera_mode,
                    }))

                elif msg_type == 'restart_race':
                    # Instant restart: teleport cars back to start, reset timers
                    # Reuses existing race setup without full cleanup
                    await self._restart_race(websocket)

                elif msg_type == 'pause':
                    # Photo mode: pause the race loop (stop ticking CARLA)
                    await self._pause_race()

                elif msg_type == 'resume':
                    # Photo mode exit: resume the race loop
                    await self._resume_race()

                elif msg_type == 'webrtc_offer':
                    await self._handle_webrtc_offer(websocket, data)

                elif msg_type == 'dc_offer':
                    await self._handle_dc_offer(websocket, data)

                elif msg_type == 'dc_ice_candidate':
                    await self._handle_dc_ice_candidate(data)

                elif msg_type == 'ambient_weather':
                    # Ambient Light Racing: client sends weather override based on room brightness
                    sun_alt = data.get('sun_altitude', 45)
                    clouds = data.get('cloudiness', 20)
                    precip = data.get('precipitation', 0)
                    if self.weather_event_manager:
                        self.weather_event_manager.set_ambient_override(sun_alt, clouds, precip)
                    print(f"[ambient] Weather override: sun={sun_alt}, clouds={clouds}, precip={precip}")

                elif msg_type == 'codec_negotiate':
                    # Client sends supported codecs; if h264, enable NVENC path
                    client_codecs = data.get('codecs', [])
                    await self._handle_codec_negotiate(websocket, client_codecs)

                elif msg_type == 'network_quality':
                    # Client sends network quality metrics for adaptive bitrate
                    self._handle_network_quality(data)

        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        finally:
            # Log session summary before resetting state
            self._log_session_summary()
            # Cancel race loop tasks but do NOT destroy CARLA actors
            # This keeps the server alive for reconnecting clients
            await self._reset_race()
            self.ws_client = None
            # Track disconnection for auto-shutdown timer
            self.shutdown_manager.client_disconnected(websocket)
            # Report session end for live player count
            self._report_callback({
                "instance_id": self._instance_id,
                "type": "session_end",
                "connection_id": connection_id,
            })
            print("Client disconnected, waiting for reconnect...")

    async def _handle_webrtc_offer(self, websocket, data):
        """Handle a WebRTC offer from the client: create peer connection, add video track, send answer."""
        # Close any existing peer connection
        if self.pc is not None:
            await self.pc.close()
            self.pc = None
            self.video_track = None

        self.pc = RTCPeerConnection()
        self.video_track = CarlaVideoTrack(self.carla)

        # Log connection state changes
        @self.pc.on("connectionstatechange")
        async def on_connectionstatechange():
            state = self.pc.connectionState
            print(f"WebRTC connection state: {state}")
            if state in ("failed", "closed"):
                await self.pc.close()
                self.pc = None
                self.video_track = None

        # Add video track and force H.264
        sender = self.pc.addTrack(self.video_track)
        force_codec(self.pc, sender, forced_codec="video/H264")

        # Set remote offer and create answer
        offer = RTCSessionDescription(sdp=data["sdp"], type=data["sdpType"])
        await self.pc.setRemoteDescription(offer)
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)

        await websocket.send(json.dumps({
            "type": "webrtc_answer",
            "sdp": self.pc.localDescription.sdp,
            "sdpType": self.pc.localDescription.type,
        }))
        print("WebRTC answer sent — video track active")

    async def _handle_dc_offer(self, websocket, data):
        """Handle a WebRTC data channel offer from the client.
        Creates a peer connection that accepts a 'controls' data channel
        for low-latency UDP-like game input."""
        # Close any existing data channel peer connection
        if self._dc_pc is not None:
            await self._dc_pc.close()
            self._dc_pc = None
            self._controls_dc = None
            self._dc_controls_active = False

        try:
            from aiortc import RTCConfiguration, RTCIceServer
            # Use STUN servers for ICE connectivity
            config = RTCConfiguration(iceServers=[
                RTCIceServer(urls=["stun:stun.l.google.com:19302"]),
                RTCIceServer(urls=["stun:stun1.l.google.com:19302"]),
            ])
            self._dc_pc = RTCPeerConnection(configuration=config)
        except (ImportError, TypeError):
            # Fallback: older aiortc versions may not have RTCConfiguration/RTCIceServer
            self._dc_pc = RTCPeerConnection()

        @self._dc_pc.on("connectionstatechange")
        async def on_dc_connectionstatechange():
            state = self._dc_pc.connectionState
            print(f"[DC] Connection state: {state}")
            if state in ("failed", "closed"):
                self._dc_controls_active = False
                self._controls_dc = None

        @self._dc_pc.on("datachannel")
        def on_datachannel(channel):
            print(f"[DC] Data channel received: '{channel.label}' (ordered={channel.ordered})")
            if channel.label == "controls":
                self._controls_dc = channel

                @channel.on("open")
                def on_open():
                    self._dc_controls_active = True
                    print("[DC] Controls data channel OPEN — using UDP path for input")

                @channel.on("close")
                def on_close():
                    self._dc_controls_active = False
                    print("[DC] Controls data channel closed — falling back to WebSocket")

                @channel.on("message")
                def on_message(message):
                    self._handle_dc_control_message(message)

        # Set remote offer and create answer
        offer = RTCSessionDescription(sdp=data["sdp"], type=data["sdpType"])
        await self._dc_pc.setRemoteDescription(offer)
        answer = await self._dc_pc.createAnswer()
        await self._dc_pc.setLocalDescription(answer)

        # Gather ICE candidates before sending answer
        # aiortc gathers candidates as part of setLocalDescription
        await websocket.send(json.dumps({
            "type": "dc_answer",
            "sdp": self._dc_pc.localDescription.sdp,
            "sdpType": self._dc_pc.localDescription.type,
        }))
        print("[DC] Data channel answer sent")

    async def _handle_dc_ice_candidate(self, data):
        """Handle an ICE candidate from the client for the data channel peer connection.
        Note: aiortc gathers all ICE candidates internally during setLocalDescription
        and embeds them in the SDP answer. Trickle ICE from the browser is not needed
        by aiortc, so we log and ignore these candidates."""
        if self._dc_pc is None:
            return
        candidate_str = data.get("candidate", "")
        if candidate_str:
            # aiortc does not support trickle ICE (addIceCandidate).
            # All candidates are gathered during setLocalDescription.
            # Browser-side candidates arrive here but can be safely ignored.
            pass

    def _handle_dc_control_message(self, message):
        """Process a control message received via the WebRTC data channel.
        Same format as WebSocket control messages but arrives with lower latency."""
        try:
            if isinstance(message, bytes):
                data = json.loads(message.decode('utf-8'))
            else:
                data = json.loads(message)

            msg_type = data.get('type')
            if msg_type == 'control':
                keys = data.get('keys', {})
                self.player_keys = {
                    'w': keys.get('w', False),
                    'a': keys.get('a', False),
                    's': keys.get('s', False),
                    'd': keys.get('d', False),
                    'space': keys.get('space', False),
                }
                # Debug logging (same cadence as WS path)
                self._control_msg_count = getattr(self, '_control_msg_count', 0) + 1
                if not self._controls_received:
                    self._controls_received = True
                    active = [k for k, v in self.player_keys.items() if v]
                    race_status = self.race_state.status if self.race_state else "no_race"
                    print(f"First control received via DC (race_status={race_status}, keys={active or 'none'})")
                elif self._control_msg_count % 30 == 0:
                    active = [k for k, v in self.player_keys.items() if v]
                    print(f"Controls #{self._control_msg_count} (DC): {active or 'none'}")
                # Adaptive JPEG quality
                latency = data.get('latency')
                if latency is not None:
                    self.encoder.adapt_quality(float(latency))
                    self._record_latency(float(latency))
        except Exception as e:
            print(f"[DC] Error parsing control message: {e}")

    async def _handle_codec_negotiate(self, websocket, client_codecs: list):
        """Handle codec negotiation: if client supports h264, send codec config."""
        self._client_supports_h264 = 'h264' in client_codecs

        if self._client_supports_h264 and self._nvenc_encoder and self._nvenc_encoder.is_running:
            config = self._nvenc_encoder.codec_config
            if config:
                # Send codec config as 0x12 prefix + JSON
                config_msg = json.dumps({
                    'type': 'codec_config',
                    'codec': config['codec'],
                    'width': config['width'],
                    'height': config['height'],
                }).encode('utf-8')
                await websocket.send(b'\x12' + config_msg)
                self._h264_enabled = True
                print(f"[NVENC] H.264 enabled for client (codec={config['codec']})")
            else:
                print("[NVENC] Client supports h264 but codec config not yet available")
                self._h264_enabled = False
        else:
            self._h264_enabled = False
            if not self._client_supports_h264:
                print("[NVENC] Client does not support h264, using JPEG fallback")
            elif not self._nvenc_encoder or not self._nvenc_encoder.is_running:
                print("[NVENC] Encoder not running, using JPEG fallback")

    def _handle_network_quality(self, data: dict):
        """Handle client network quality report and adapt NVENC bitrate.

        Adjusts the H.264 encoder bitrate based on observed network conditions:
        - Poor network (high jitter or drops): decrease bitrate by 20%
        - Good network (low jitter, low drops, low RTT): increase bitrate by 10%
        - Otherwise: maintain current bitrate

        Only applies when H.264 NVENC encoding is active; ignored for JPEG fallback.
        """
        # Skip if NVENC is not active
        if not self._h264_enabled or not self._nvenc_encoder or not self._nvenc_encoder.is_running:
            return

        jitter_ms = data.get('jitter_ms', 0)
        drop_rate = data.get('frame_drop_rate', 0)
        rtt_ms = data.get('rtt_ms', 0)

        # Rate-limit: don't adjust more than once every 5 seconds
        now = time.time()
        if now - self._last_bitrate_adjust_time < 5.0:
            return

        old_bitrate = self._current_bitrate_mbps

        if jitter_ms > 50 or drop_rate > 0.1:
            # Poor network: decrease by 20%
            new_bitrate = self._current_bitrate_mbps * 0.8
            direction = 'decrease'
        elif jitter_ms < 20 and drop_rate < 0.02 and rtt_ms < 100:
            # Good network: increase by 10%
            new_bitrate = self._current_bitrate_mbps * 1.1
            direction = 'increase'
        else:
            # Stable: no change
            return

        # Clamp to valid range
        new_bitrate = max(self._bitrate_min_mbps, min(self._bitrate_max_mbps, new_bitrate))

        # Skip if change is negligible (< 0.1 Mbps difference)
        if abs(new_bitrate - old_bitrate) < 0.1:
            return

        # Format as FFmpeg bitrate string (e.g. '6.4M')
        bitrate_str = f'{new_bitrate:.1f}M'

        if self._nvenc_encoder.set_bitrate(bitrate_str):
            self._current_bitrate_mbps = new_bitrate
            self._last_bitrate_adjust_time = now
            print(f"[ABR] Bitrate {direction}: {old_bitrate:.1f}M -> {new_bitrate:.1f}M "
                  f"(jitter={jitter_ms:.0f}ms, drops={drop_rate:.2f}, rtt={rtt_ms:.0f}ms)")

    def _start_nvenc_encoder(self):
        """Try to start the NVENC encoder. Falls back silently to JPEG on failure."""
        if self._nvenc_encoder and self._nvenc_encoder.is_running:
            return

        width = self.config.get('streaming', {}).get('width', 1280)
        height = self.config.get('streaming', {}).get('height', 720)
        encoder = NVENCEncoder(width=width, height=height, fps=30, bitrate='8M')

        if encoder.start():
            self._nvenc_encoder = encoder
            print("[NVENC] NVENC encoder started (H.264 hardware encoding active)")

            # Feed a blank frame to prime the encoder and extract codec config
            blank = b'\x00' * (width * height * 4)
            encoder.encode_frame(blank)
            # Wait briefly for codec config
            config = encoder.wait_for_codec_config(timeout=2.0)
            if config:
                print(f"[NVENC] Codec config ready: {config['codec']}")
            else:
                print("[NVENC] Warning: codec config not extracted from first frame")
        else:
            self._nvenc_encoder = None
            print("[NVENC] NVENC unavailable, using JPEG encoding")

    def _start_nvfbc_capture(self):
        """Try to initialize NvFBC GPU framebuffer capture.

        NvFBC captures directly from the GPU framebuffer, bypassing CARLA's
        camera sensor and eliminating CPU memory copies. This reduces capture
        latency from ~5-10ms (CARLA sensor + bytes() copy) to <1ms.

        Falls back silently to CARLA camera sensor if unavailable.
        """
        if self._nvfbc_capture and self._nvfbc_capture.available:
            self._nvfbc_enabled = True
            return

        width = self.config.get('streaming', {}).get('width', 1280)
        height = self.config.get('streaming', {}).get('height', 720)

        try:
            capture = NvFBCCapture(width=width, height=height)
            if capture.available:
                self._nvfbc_capture = capture
                self._nvfbc_enabled = True
                print(f"[NvFBC] GPU framebuffer capture active (method={capture.method})")
                print(f"[NvFBC] Frame capture will bypass CARLA camera sensor")
            else:
                self._nvfbc_capture = None
                self._nvfbc_enabled = False
                print("[NvFBC] Not available -- using CARLA camera sensor (default)")
        except Exception as e:
            self._nvfbc_capture = None
            self._nvfbc_enabled = False
            print(f"[NvFBC] Initialization error: {e}")
            print("[NvFBC] Falling back to CARLA camera sensor")

    def _stop_nvfbc_capture(self):
        """Stop and clean up NvFBC capture resources."""
        if self._nvfbc_capture:
            self._nvfbc_capture.destroy()
            self._nvfbc_capture = None
        self._nvfbc_enabled = False

    def _record_latency(self, latency_ms: float):
        """Record a latency sample for per-second and session-level stats."""
        self._stats_latencies.append(latency_ms)
        self._session_latencies.append(latency_ms)

    def _log_per_second_stats(self):
        """Log a single concise per-second stats line during an active race.

        Called from the FPS calculation block which fires every ~1 second.
        Format: [stats] fps=18 lat=340ms q=50 res=1280x720 frame_kb=47.2 skip=3 encode_ms=5.2
        """
        if not self.running or not self.race_state or self.race_state.status not in ("racing", "finishing"):
            return

        perf = self.encoder.get_perf_stats()

        avg_lat = 0
        if self._stats_latencies:
            avg_lat = int(sum(self._stats_latencies) / len(self._stats_latencies))

        fps = int(round(self.fps))
        skip = self._stats_skip_count

        print(f"[stats] fps={fps} lat={avg_lat}ms q={perf['quality']} "
              f"res={perf['resolution']} frame_kb={perf['avg_frame_size_kb']:.1f} "
              f"skip={skip} encode_ms={perf['avg_encode_ms']:.1f}")

        # Reset per-second counters
        self._stats_frames_sent = 0
        self._stats_skip_count = 0
        self._stats_latencies = []

    def _log_session_summary(self):
        """Log a summary of the play session on disconnect.

        Format: [session] duration=120s total_frames=2160 avg_fps=18.0 avg_lat=340ms avg_q=50 avg_frame_kb=47.2 total_skip=156 peak_lat=450ms
        """
        if self._session_start_time == 0:
            return

        duration = time.time() - self._session_start_time
        if duration < 1.0:
            return  # Too short to be meaningful

        total_frames = self._session_total_frames
        avg_fps = total_frames / duration if duration > 0 else 0.0

        avg_lat = 0
        peak_lat = 0
        if self._session_latencies:
            avg_lat = int(sum(self._session_latencies) / len(self._session_latencies))
            peak_lat = int(max(self._session_latencies))

        avg_q = 0
        if self._session_qualities:
            avg_q = int(sum(self._session_qualities) / len(self._session_qualities))

        avg_frame_kb = 0.0
        if self._session_frame_sizes:
            avg_frame_kb = sum(self._session_frame_sizes) / len(self._session_frame_sizes) / 1024.0

        total_skip = self._session_total_skips

        print(f"[session] duration={int(duration)}s total_frames={total_frames} "
              f"avg_fps={avg_fps:.1f} avg_lat={avg_lat}ms avg_q={avg_q} "
              f"avg_frame_kb={avg_frame_kb:.1f} total_skip={total_skip} peak_lat={peak_lat}ms")

    def _reset_session_stats(self):
        """Reset all session-level stats counters for a new connection."""
        self._session_start_time = time.time()
        self._session_total_frames = 0
        self._session_total_skips = 0
        self._session_latencies = []
        self._session_qualities = []
        self._session_frame_sizes = []
        self._stats_frames_sent = 0
        self._stats_skip_count = 0
        self._stats_latencies = []
        self._stats_last_log_time = time.time()

    async def _switch_model(self, model_name: str):
        """Switch the AI driving model."""
        weights = self.config['model'].get('weights', {}).get(model_name)
        success = self.model.load_model(model_name, weights=weights)
        self.current_model_name = model_name if success else self.current_model_name

        if self.ws_client:
            await self.ws_client.send(json.dumps({
                'type': 'model_switched',
                'model': self.current_model_name,
                'success': success,
            }))

    async def _reset_race(self):
        """Stop the current race loop and telemetry loop without destroying CARLA actors.
        Called on client disconnect to keep the server alive for reconnections.
        Full cleanup (actor destruction) only happens when starting a new race."""
        self.running = False

        # Cancel the race loop task
        if self._race_task and not self._race_task.done():
            self._race_task.cancel()
            try:
                await self._race_task
            except asyncio.CancelledError:
                pass
        self._race_task = None

        # Cancel the telemetry loop task
        if self._telemetry_task and not self._telemetry_task.done():
            self._telemetry_task.cancel()
            try:
                await self._telemetry_task
            except asyncio.CancelledError:
                pass
        self._telemetry_task = None

        # Reset input state
        self.player_keys = {'w': False, 'a': False, 's': False, 'd': False, 'space': False}
        self._controls_received = False
        self.race_state = None
        self.race_director = None
        self.mistake_generator = None
        self.weather_manager = None
        self.weather_mood = None
        self.weather_event_manager = None
        self.trash_talk = None
        self.ai_personality = None
        self.skill_matcher = None
        self.difficulty = 'easy'
        self.frame_count = 0
        self.fps = 0.0
        self._fps_count = 0
        self._fps_timer = time.time()

        # Reset frame skip state
        self._last_sent_x = None
        self._last_sent_y = None
        self._last_sent_yaw = None
        self._last_sent_time = 0.0
        self._frame_skip_count = 0
        self._delta_skip_count = 0
        self._rear_frame_counter = 0

        # Reset encoder frame hash for delta detection
        self.encoder.reset_frame_hash()
        self.rear_encoder.reset_frame_hash()

        # Stop NVENC encoder if running
        if self._nvenc_encoder:
            self._nvenc_encoder.stop()
            self._nvenc_encoder = None
        self._h264_enabled = False
        self._client_supports_h264 = False

        # Stop NvFBC capture if active
        self._stop_nvfbc_capture()

        # Reset adaptive bitrate state
        self._current_bitrate_mbps = 8.0
        self._last_bitrate_adjust_time = 0.0

        # Stop training recorder if active
        if self.training_recorder.recording:
            self.training_recorder.stop_recording()
        self._training_frame_counter = 0

        # Close WebRTC peer connection
        if self.pc is not None:
            await self.pc.close()
            self.pc = None
            self.video_track = None
            print("WebRTC peer connection closed")

        # Close data channel peer connection
        if self._dc_pc is not None:
            await self._dc_pc.close()
            self._dc_pc = None
            self._controls_dc = None
            self._dc_controls_active = False
            print("[DC] Data channel peer connection closed")

        # Log session cost and reset highlight buffer
        self.cost_tracker.log_session_cost("race reset")
        self.highlight_buffer.reset()
        self._prev_gap_seconds = None
        self._highlight_collision_count = 0

        print("Race reset (actors preserved for reconnect)")

    async def _restart_race(self, websocket):
        """Instant restart: teleport cars back to start and reset race state.
        Does NOT do full cleanup/respawn -- keeps existing actors, cameras, and AI settings.
        Much faster than _start_race since we skip map loading, vehicle spawning, etc."""
        print("Instant race restart requested")

        # Stop current race/telemetry loops
        self.running = False

        if self._race_task and not self._race_task.done():
            self._race_task.cancel()
            try:
                await self._race_task
            except asyncio.CancelledError:
                pass
        self._race_task = None

        if self._telemetry_task and not self._telemetry_task.done():
            self._telemetry_task.cancel()
            try:
                await self._telemetry_task
            except asyncio.CancelledError:
                pass
        self._telemetry_task = None

        # Teleport both cars back to the starting line
        self.carla.reset_to_start()

        # Reset input state
        self.player_keys = {'w': False, 'a': False, 's': False, 'd': False, 'space': False}
        self._controls_received = False

        # Reset frame skip state
        self._last_sent_x = None
        self._last_sent_y = None
        self._last_sent_yaw = None
        self._last_sent_time = 0.0
        self._frame_skip_count = 0
        self._delta_skip_count = 0
        self._rear_frame_counter = 0
        self.encoder.reset_frame_hash()
        self.rear_encoder.reset_frame_hash()

        # Reset FPS counters
        self.frame_count = 0
        self.fps = 0.0
        self._fps_count = 0
        self._fps_timer = time.time()

        # Reset training recorder for fresh recording on restart
        if self.training_recorder.recording:
            self.training_recorder.stop_recording()
        self._training_frame_counter = 0

        # Regenerate checkpoints from the (now-reset) player position
        checkpoints = generate_checkpoints_from_waypoints(
            self.carla.world,
            num_checkpoints=self.config.get('race', {}).get('checkpoints', 10),
            radius=self.config.get('race', {}).get('checkpoint_radius', 15.0),
            start_location=self.carla.player_car.get_location(),
        )

        if not checkpoints:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'Failed to generate checkpoints for restart',
            }))
            return

        # Create fresh race state with same lap count
        old_laps = self.race_state.total_laps if self.race_state else 3
        self.race_state = RaceState(checkpoints, total_laps=old_laps)
        self.race_state.start_countdown()

        # Re-create race director and mistake generator with same difficulty
        self.race_director = RaceDirector(difficulty=self.difficulty)
        self.mistake_generator = AIMistakeGenerator(difficulty=self.difficulty)
        self.weather_mood = WeatherMoodManager(total_laps=old_laps)
        self.trash_talk = TrashTalkManager()
        self.ai_personality = AIPersonality()
        self.skill_matcher = SkillMatcher(difficulty=self.difficulty)

        # Re-create event-driven weather manager
        if self.carla.world:
            self.weather_event_manager = WeatherManager(self.carla.world, is_night=False)
            self.weather_event_manager.set_target_mood('CALM', transition_time=5.0)

        # Reset highlight buffer and start new cost session
        self.highlight_buffer.reset()
        self._prev_gap_seconds = None
        self._highlight_collision_count = 0
        self.cost_tracker.log_session_cost("restart")
        self.cost_tracker.start_session()

        self.running = True

        # Send ack to client
        await websocket.send(json.dumps({'type': 'restart_ack'}))

        # Restart the race/telemetry loops
        self._race_task = asyncio.create_task(self._race_loop())
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())

        print("Instant restart complete -- countdown started")

    async def _pause_race(self):
        """Pause the race loop for photo mode. Stops CARLA ticking but preserves all state."""
        if not self.running:
            return
        print("Race paused (photo mode)")
        self.running = False

        # Cancel the race loop task
        if self._race_task and not self._race_task.done():
            self._race_task.cancel()
            try:
                await self._race_task
            except asyncio.CancelledError:
                pass
        self._race_task = None

        # Cancel the telemetry loop task
        if self._telemetry_task and not self._telemetry_task.done():
            self._telemetry_task.cancel()
            try:
                await self._telemetry_task
            except asyncio.CancelledError:
                pass
        self._telemetry_task = None

    async def _resume_race(self):
        """Resume the race loop after photo mode. Restarts the CARLA tick and telemetry loops."""
        if self.running:
            return
        if not self.race_state:
            return
        print("Race resumed (photo mode exit)")
        self.running = True
        self._race_task = asyncio.create_task(self._race_loop())
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())

    # Model ID -> difficulty mapping
    MODEL_DIFFICULTY_MAP = {
        'carla_pilotnet': 'easy',
        'pilotnet': 'medium',
        'alpamayo': 'hard',
    }

    async def _start_race(self, track: str, laps: int, weather: str = 'clear', model: str = 'carla_pilotnet', player_car: str = None, time_of_day: str = None, postprocess: str = 'balanced'):
        """Initialize and start a race."""
        self._current_track = track  # Store for race completion reporting
        difficulty = self.MODEL_DIFFICULTY_MAP.get(model, 'medium')
        self.difficulty = difficulty
        print(f"Starting race: track={track}, laps={laps}, weather={weather}, model={model}, difficulty={difficulty}, player_car={player_car}, time_of_day={time_of_day}, postprocess={postprocess}")

        # Stop any existing race loop first
        await self._reset_race()
        # Restore difficulty after reset
        self.difficulty = difficulty

        # Apply post-processing preset BEFORE setup_race (which creates cameras)
        self.carla.set_postprocess_preset(postprocess)

        # Always clean up CARLA actors before setting up fresh
        print("Cleaning up previous race actors...")
        self.carla.cleanup()
        import time as _time; _time.sleep(1)  # Let CARLA fully remove old actors

        # Connect to CARLA and set up race
        if not self.carla.connect():
            if self.ws_client:
                await self.ws_client.send(json.dumps({
                    'type': 'error',
                    'message': 'Failed to connect to CARLA',
                }))
            return

        if not self.carla.setup_race(track, player_car=player_car):
            if self.ws_client:
                await self.ws_client.send(json.dumps({
                    'type': 'error',
                    'message': 'Failed to set up race',
                }))
            return

        # Apply weather settings
        self.carla.set_weather(weather)

        # Apply time-of-day preset (overrides sun position/atmosphere from weather)
        if time_of_day:
            self.carla.set_time_of_day(time_of_day)

        # Set up AI based on difficulty
        if difficulty == 'easy':
            # Easy: CARLA autopilot at slow/cautious settings, no model needed
            print("AI Mode: EASY - CARLA autopilot (slow, cautious)")
            self.carla.enable_ai_autopilot(difficulty='easy')

        elif difficulty == 'medium':
            # Medium: PilotNet neural network for steering + rule-based throttle/brake
            print("AI Mode: MEDIUM - PilotNet neural network")
            model_loaded = self.model.load_model('pilotnet')
            if model_loaded and getattr(self.model.current_model, 'has_weights', False):
                # Neural net loaded with weights - disable autopilot, race loop handles control
                self.carla.disable_ai_autopilot()
                print("  PilotNet weights loaded successfully - using neural network control")
            else:
                # Weights failed to load - fall back to medium autopilot
                print("  PilotNet weights not available - falling back to CARLA autopilot (medium)")
                self.carla.enable_ai_autopilot(difficulty='medium')
                self.difficulty = 'easy'  # Treat as easy so race loop skips inference

        elif difficulty == 'hard':
            # Hard: CARLA autopilot at maximum aggression, no model needed
            print("AI Mode: HARD - CARLA autopilot (aggressive)")
            self.carla.enable_ai_autopilot(difficulty='hard')

        else:
            # Unknown difficulty, default to easy autopilot
            print(f"Unknown difficulty '{difficulty}', defaulting to easy autopilot")
            self.carla.enable_ai_autopilot(difficulty='easy')
            self.difficulty = 'easy'

        # Generate checkpoints from CARLA map, starting from player spawn
        checkpoints = generate_checkpoints_from_waypoints(
            self.carla.world,
            num_checkpoints=self.config.get('race', {}).get('checkpoints', 10),
            radius=self.config.get('race', {}).get('checkpoint_radius', 15.0),
            start_location=self.carla.player_car.get_location(),
        )

        if not checkpoints:
            if self.ws_client:
                await self.ws_client.send(json.dumps({
                    'type': 'error',
                    'message': 'Failed to generate checkpoints',
                }))
            return

        self.race_state = RaceState(checkpoints, total_laps=laps)
        self.race_state.start_countdown()
        self.running = True
        self.race_director = RaceDirector(difficulty=self.difficulty)
        self.mistake_generator = AIMistakeGenerator(difficulty=self.difficulty)
        self.weather_manager = WeatherTransitionManager(weather, total_laps=laps)
        self.weather_mood = WeatherMoodManager(total_laps=laps)
        self.trash_talk = TrashTalkManager()
        self.ai_personality = AIPersonality()
        self.skill_matcher = SkillMatcher(difficulty=self.difficulty)

        # Event-driven weather manager: smooth lerp transitions based on race events
        is_night = time_of_day == 'night' or weather == 'night'
        self.weather_event_manager = WeatherManager(self.carla.world, is_night=is_night)
        self.weather_event_manager.set_target_mood('CALM', transition_time=5.0)

        # Start cost tracking and reset highlight buffer for new race
        self.cost_tracker.start_session()
        self.highlight_buffer.reset()
        self._prev_gap_seconds = None
        self._highlight_collision_count = 0

        # Try to start NVENC encoder for H.264 video (falls back to JPEG)
        self._start_nvenc_encoder()

        # Try to initialize NvFBC GPU framebuffer capture
        # NvFBC bypasses CARLA's camera sensor, capturing directly from the GPU
        # framebuffer. This eliminates CPU memory copies in the capture pipeline.
        # Falls back silently to CARLA camera sensor if unavailable.
        self._start_nvfbc_capture()

        # Run the frame loop (30fps) and telemetry loop (30Hz) concurrently
        self._race_task = asyncio.create_task(self._race_loop())
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())

    async def _race_loop(self):
        """Main race loop: sends JPEG frames at ~30fps. Telemetry is sent separately at 30Hz."""
        target_dt = 1.0 / 30.0  # 30 FPS target
        next_frame_time = time.monotonic() + target_dt

        while self.running and self.ws_client:

            try:
                # Handle countdown
                if self.race_state.status == "countdown":
                    countdown = self.race_state.get_countdown()
                    if countdown == 0:
                        self.race_state.start_race()
                        # Start recording training data
                        self.training_recorder.start_recording()
                        self._training_frame_counter = 0
                        # Log any pre-buffered key state so we know controls are flowing
                        active_keys = [k for k, v in self.player_keys.items() if v]
                        if active_keys:
                            print(f"Race started! Active keys at start: {active_keys}")
                        else:
                            print("Race started! Controls now active (no keys pressed yet)")
                    # Tick CARLA during countdown so camera feeds stay alive
                    # (in sync mode, no tick = no new camera frames)
                    self.carla.tick()
                    # Still send frames during countdown (but don't apply controls)
                    await self._send_frame()

                elif self.race_state.status == "racing":
                    # Yield to let the message handler update player_keys
                    # world.tick() blocks the event loop for ~30ms, starving
                    # the message handler coroutine. This sleep(0) gives it
                    # a chance to process queued WebSocket messages.
                    await asyncio.sleep(0)

                    # 1. Apply player controls (with difficulty + checkpoint for assists)
                    next_cp = None
                    if self.race_state:
                        cp_idx = self.race_state.player_checkpoint % len(self.race_state.checkpoints)
                        cp_x, cp_y, _ = self.race_state.checkpoints[cp_idx]
                        next_cp = (cp_x, cp_y)
                    self.carla.apply_player_control(
                        self.player_keys,
                        difficulty=self.difficulty,
                        next_checkpoint=next_cp,
                    )

                    # 2. AI control based on difficulty
                    if self.difficulty == 'medium':
                        # Neural network mode: get AI camera frame, run PilotNet, apply control
                        ai_frame = self.carla.get_ai_frame()
                        if ai_frame is not None:
                            try:
                                prediction = self.model.predict(ai_frame)
                                if prediction:
                                    # Use neural net steering + rule-based throttle/brake
                                    ai_telem_for_control = self.carla.get_telemetry(self.carla.ai_car)
                                    self.carla.apply_neural_ai_control(
                                        prediction['steering'],
                                        ai_telem_for_control['speed_kmh']
                                    )
                            except Exception as e:
                                print(f"Neural net inference error: {e}")
                    # For easy/hard, CARLA autopilot handles AI control automatically

                    # 3. Tick CARLA (blocking call ~30ms)
                    self.carla.tick()

                    # Yield again after tick to process any queued messages
                    await asyncio.sleep(0)

                    # 4. Update race state with vehicle positions
                    player_telem = None
                    ai_telem = None
                    try:
                        player_telem = self.carla.get_telemetry(self.carla.player_car)
                        ai_telem = self.carla.get_telemetry(self.carla.ai_car)
                    except Exception as e:
                        print(f"Telemetry read error (non-fatal): {e}")

                    if player_telem and ai_telem:
                        self.race_state.update_player(
                            player_telem['x'], player_telem['y'], player_telem['speed_kmh']
                        )
                        self.race_state.update_ai(
                            ai_telem['x'], ai_telem['y'], ai_telem['speed_kmh']
                        )

                    # 4b. Speed-based resolution scaling
                    if player_telem:
                        self.encoder.update_speed_resolution(player_telem['speed_kmh'])

                    # 4b1. Record training data at 10Hz (every 3rd frame of 30fps loop)
                    self._training_frame_counter += 1
                    if self._training_frame_counter % 3 == 0 and player_telem:
                        training_frame = self.carla.get_chase_frame()
                        if training_frame is not None:
                            self.training_recorder.record_frame(
                                training_frame,
                                steer=player_telem.get('steer', 0.0),
                                throttle=player_telem.get('throttle', 0.0),
                                brake=player_telem.get('brake', 0.0),
                                speed=player_telem['speed_kmh'],
                            )

                    # 4b2. Skill Matcher: feed player telemetry for adaptive AI
                    if self.skill_matcher and player_telem:
                        self.skill_matcher.record_speed(player_telem['speed_kmh'])

                        # Detect new checkpoint hits by comparing with previous count
                        prev_cp = getattr(self, '_prev_player_checkpoint', 0)
                        curr_cp = self.race_state.player_checkpoint
                        if curr_cp > prev_cp:
                            self.skill_matcher.record_checkpoint(curr_cp)
                        self._prev_player_checkpoint = curr_cp

                        # Detect new lap completions
                        prev_lap_count = getattr(self, '_prev_player_lap_count', 0)
                        curr_lap_count = len(self.race_state.player_lap_times)
                        if curr_lap_count > prev_lap_count:
                            self.skill_matcher.record_lap_time(
                                self.race_state.player_lap_times[-1]
                            )
                        self._prev_player_lap_count = curr_lap_count

                        # Update skill score (internally throttled to every 30s)
                        if self.skill_matcher.update():
                            # Apply skill-based speed adjustment to AI traffic manager
                            if self.carla._ai_autopilot:
                                skill_speed_adj = self.skill_matcher.get_speed_adjustment()
                                self.carla.adjust_ai_speed(skill_speed_adj)

                    # 4c. AI Personality: update emotional state based on race conditions
                    if self.ai_personality and self.race_state:
                        personality_progress = 0.0
                        if self.race_director:
                            personality_progress = self.race_director.get_race_progress(self.race_state)
                        self.ai_personality.update(self.race_state, race_progress=personality_progress)
                        # Apply personality speed modifier on top of race director adjustments
                        personality_speed_mod = self.ai_personality.get_speed_modifier()
                        if abs(personality_speed_mod) > 0.5 and self.carla._ai_autopilot:
                            self.carla.adjust_ai_speed(personality_speed_mod)

                    # 4d. AI Blocking: on Hard, defensively slow when player is close behind
                    if self.race_state and self.carla._ai_autopilot:
                        self.carla.update_ai_blocking(self.difficulty, self.race_state)

                    # Race Director: dynamically adjust AI speed (distance-based rubber banding)
                    if self.race_director and self.carla._ai_autopilot:
                        gap = self.race_state.get_gap_seconds()
                        progress = self.race_director.get_race_progress(self.race_state)
                        speed_adj = self.race_director.get_speed_adjustment(
                            gap, progress, time.time(), race_state=self.race_state
                        )
                        if abs(speed_adj) > 0.5:  # Only apply if meaningful
                            self.carla.adjust_ai_speed(speed_adj)

                    # AI Mistakes: periodically slow the AI to create overtaking opportunities
                    # Personality emotion affects mistake frequency via interval multiplier
                    if self.mistake_generator and self.carla._ai_autopilot:
                        gap = self.race_state.get_gap_seconds()
                        was_active = self.mistake_generator._active_mistake is not None
                        # Scale mistake penalty by personality aggression (aggressive = bigger mistakes)
                        mistake = self.mistake_generator.update(time.time(), gap)
                        if mistake and self.ai_personality:
                            params = self.ai_personality.get_driving_params()
                            # Scale speed_penalty by aggression: high aggression = bigger mistakes from pushing too hard
                            mistake = dict(mistake)  # copy to avoid mutating template
                            mistake['speed_penalty'] = mistake.get('speed_penalty', 0) * (0.5 + params['aggression'] * 0.8)
                        if mistake:
                            self.carla.apply_ai_mistake(mistake)
                        elif was_active and self.mistake_generator._active_mistake is None:
                            # Mistake just ended this frame: reset AI speed to base
                            self.carla.adjust_ai_speed(0.0)

                    # 5. Record player position for ghost replay
                    if player_telem:
                        lap_time = self.race_state.get_current_lap_time("player")
                        yaw = player_telem.get('yaw', 0.0)
                        self.race_state.record_player_position(
                            player_telem['x'], player_telem['y'], yaw, lap_time
                        )

                    # 6. Drift detection: compare heading vs velocity direction
                    drift_event = None
                    if player_telem:
                        drift_event = self.race_state.update_drift(
                            heading_deg=player_telem.get('yaw', 0.0),
                            velocity_x=player_telem.get('velocity_x', 0.0),
                            velocity_y=player_telem.get('velocity_y', 0.0),
                            speed_kmh=player_telem['speed_kmh'],
                            steer=player_telem.get('steer', 0.0),
                        )

                    # 6b. Send drift_end event as a separate message for popup display
                    if drift_event and drift_event.get('event') == 'drift_end' and self.ws_client:
                        try:
                            await self.ws_client.send(json.dumps({
                                'type': 'drift_end',
                                'score': drift_event['score'],
                                'combo': drift_event.get('combo', 1),
                                'multiplier': drift_event.get('multiplier', ''),
                                'total_score': drift_event.get('total_score', 0),
                            }))
                        except Exception:
                            pass

                        # 6c. Drift boost: activate 5% throttle boost for 1.5s on score > 200
                        if drift_event['score'] > 200 and hasattr(self, 'carla_manager') and self.carla_manager and hasattr(self.carla_manager, 'activate_drift_boost'):
                            self.carla_manager.activate_drift_boost(drift_event['score'])

                        # 6d. Feed drift score to skill matcher for adaptive AI
                        if self.skill_matcher:
                            self.skill_matcher.record_drift_score(drift_event['score'])

                    # 7. Race commentary: contextual messages
                    commentary = self.race_state.get_commentary(drift_event=drift_event)
                    if commentary and self.ws_client:
                        try:
                            await self.ws_client.send(json.dumps({
                                'type': 'commentary',
                                'text': commentary['text'],
                                'category': commentary['category'],
                            }))
                        except Exception:
                            pass

                    # 7b. AI trash talk: opponent taunts and challenges
                    if self.trash_talk and self.ws_client:
                        trash_msg = self.trash_talk.check_events(self.race_state)
                        if trash_msg:
                            try:
                                await self.ws_client.send(json.dumps(trash_msg))
                            except Exception:
                                pass

                    # 8. Dynamic weather transitions (time-of-day sun path + intensity-based mood)
                    if self.weather_manager and self.race_director:
                        progress = self.race_director.get_race_progress(self.race_state)
                        weather_params = self.weather_manager.update(progress)
                        if weather_params:
                            # Overlay mood-driven weather on top of the time-of-day sun path.
                            # Mood controls clouds/rain/fog/wind, transition manager controls sun.
                            if self.weather_mood:
                                mood_params = self.weather_mood.update(self.race_state)
                                if mood_params:
                                    weather_params['cloudiness'] = max(weather_params.get('cloudiness', 0), mood_params.get('cloudiness', 0))
                                    weather_params['precipitation'] = max(weather_params.get('precipitation', 0), mood_params.get('precipitation', 0))
                                    weather_params['fog_density'] = max(weather_params.get('fog_density', 0), mood_params.get('fog_density', 0))
                                    weather_params['wind_intensity'] = max(weather_params.get('wind_intensity', 0), mood_params.get('wind_intensity', 0))
                            self.carla.set_weather_params(**weather_params)
                        elif self.weather_mood:
                            # Even if time-of-day doesn't need update, mood might
                            mood_params = self.weather_mood.update(self.race_state)
                            if mood_params:
                                self.carla.set_weather_params(**mood_params)

                    # 8b. Event-driven weather mood transitions (close gap, final lap, etc.)
                    if self.weather_event_manager and self.race_state:
                        gap = self.race_state.get_gap_seconds()
                        # Determine if we are on the final lap
                        is_final_lap = (
                            self.race_state.player_lap >= self.race_state.total_laps - 1
                            or self.race_state.ai_lap >= self.race_state.total_laps - 1
                        )
                        # Compute progress through the final lap (0.0-1.0)
                        final_lap_progress = 0.0
                        if is_final_lap:
                            num_cps = len(self.race_state.checkpoints)
                            if num_cps > 0:
                                # Use the leader's checkpoint within the final lap
                                leader_cp = max(
                                    self.race_state.player_checkpoint % num_cps,
                                    self.race_state.ai_checkpoint % num_cps,
                                )
                                final_lap_progress = leader_cp / num_cps

                        self.weather_event_manager.evaluate_race_events(
                            self.race_state,
                            is_final_lap=is_final_lap,
                            final_lap_progress=final_lap_progress,
                            gap_seconds=gap,
                        )
                        self.weather_event_manager.update(1.0 / 30.0)

                    # 8c. Highlight detection: capture ring buffer on highlight events
                    self._check_highlight_events(player_telem, ai_telem, drift_event)

                    # 8d. Cost tracker periodic update
                    self.cost_tracker.update()

                    # 9. Send chase camera frame to browser
                    await self._send_frame()

                elif self.race_state.status == "finishing":
                    # One racer finished - continue simulation for 30s grace period
                    # so the other racer can still finish and get a time
                    await asyncio.sleep(0)
                    next_cp_finish = None
                    if self.race_state:
                        cp_idx = self.race_state.player_checkpoint % len(self.race_state.checkpoints)
                        cp_x, cp_y, _ = self.race_state.checkpoints[cp_idx]
                        next_cp_finish = (cp_x, cp_y)
                    self.carla.apply_player_control(
                        self.player_keys,
                        difficulty=self.difficulty,
                        next_checkpoint=next_cp_finish,
                    )
                    self.carla.tick()
                    await asyncio.sleep(0)

                    # Update positions (this may trigger the second racer finishing)
                    try:
                        player_telem = self.carla.get_telemetry(self.carla.player_car)
                        ai_telem = self.carla.get_telemetry(self.carla.ai_car)
                        self.race_state.update_player(
                            player_telem['x'], player_telem['y'], player_telem['speed_kmh']
                        )
                        self.race_state.update_ai(
                            ai_telem['x'], ai_telem['y'], ai_telem['speed_kmh']
                        )
                    except Exception as e:
                        print(f"Finishing state telemetry error: {e}")

                    # Check if grace period expired
                    self.race_state.check_finishing_timeout()

                    await self._send_frame()

                elif self.race_state.status == "finished":
                    # Stop training data recording
                    training_frames = self.training_recorder.stop_recording()

                    # Capture finish as a highlight
                    self.highlight_buffer.capture_highlight('finish', metadata={
                        'winner': self.race_state.winner,
                    })

                    # Send AI trash talk for race finish (before race_finished message)
                    if self.trash_talk and self.ws_client:
                        trash_msg = self.trash_talk.check_events(self.race_state)
                        if trash_msg:
                            try:
                                await self.ws_client.send(json.dumps(trash_msg))
                            except Exception:
                                pass

                    # Send final race result
                    if self.ws_client:
                        paths = self.race_state.get_paths()
                        stats = self.race_state.get_stats()
                        racing_line = self.race_state.get_racing_line()
                        sector_times = self.race_state.get_sector_times()
                        coaching_tips = compute_coaching_tips(self.race_state)
                        await self.ws_client.send(json.dumps({
                            'type': 'race_finished',
                            'winner': self.race_state.winner,
                            'player_time': self.race_state.player_finish_time,
                            'ai_time': self.race_state.ai_finish_time,
                            'player_laps': self.race_state.player_lap_times,
                            'ai_laps': self.race_state.ai_lap_times,
                            'player_path': paths['player'],
                            'ai_path': paths['ai'],
                            'racing_line': racing_line,
                            'player_max_speed': stats['player_max_speed'],
                            'ai_max_speed': stats['ai_max_speed'],
                            'player_distance': stats['player_distance'],
                            'ai_distance': stats['ai_distance'],
                            'player_collisions': stats['player_collisions'],
                            'total_drift_score': stats.get('total_drift_score', 0),
                            'best_single_drift': stats.get('best_single_drift', 0),
                            'drift_count': stats.get('drift_count', 0),
                            'highlights': self.highlight_buffer.get_highlights(),
                            'session_cost': self.cost_tracker.get_cost_summary(),
                            'training_frames': training_frames,
                            'coaching_tips': coaching_tips,
                            'sector_times': sector_times,
                        }))

                    # Report race completion for social presence feed
                    difficulty_label = {'easy': 'Easy', 'medium': 'Medium', 'hard': 'Hard'}.get(self.difficulty, 'Easy')
                    player_time = self.race_state.player_finish_time or 0
                    ai_time = self.race_state.ai_finish_time or 0
                    beat_ai = self.race_state.winner == 'player'
                    gap = ai_time - player_time if (player_time and ai_time) else 0
                    track_name = getattr(self, '_current_track', 'Unknown')
                    self._report_race_complete(
                        name=self._player_name,
                        track=track_name,
                        player_time=player_time,
                        beat_ai=beat_ai,
                        gap=gap,
                        difficulty=difficulty_label,
                    )

                    # Log session cost at race end
                    self.cost_tracker.log_session_cost("race finished")

                    self.running = False
                    break

            except Exception as e:
                print(f"Race loop error: {e}")
                import traceback
                traceback.print_exc()

            # Frame timing: use absolute target to prevent drift accumulation
            # If we're behind schedule (next_frame_time already passed), don't sleep
            now = time.monotonic()
            sleep_time = next_frame_time - now
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)
            # Schedule next frame relative to the target, not to now,
            # so we don't accumulate drift from sleep overshooting
            next_frame_time += target_dt
            # If we fell behind by more than 2 frames, reset to avoid burst catching up
            if next_frame_time < time.monotonic() - target_dt:
                next_frame_time = time.monotonic() + target_dt

            # FPS calculation
            self._fps_count += 1
            now_wall = time.time()
            if now_wall - self._fps_timer >= 1.0:
                self.fps = self._fps_count / (now_wall - self._fps_timer)
                self._fps_count = 0
                self._fps_timer = now_wall
                # Per-second stats line
                self._log_per_second_stats()

        # Race loop ended (finished or client disconnected)
        # Don't cleanup actors here — _reset_race handles loop cancellation,
        # and _start_race handles actor cleanup before new races.
        if self._telemetry_task and not self._telemetry_task.done():
            self._telemetry_task.cancel()
            try:
                await self._telemetry_task
            except asyncio.CancelledError:
                pass
            self._telemetry_task = None
        print("Race loop ended")

    def _should_skip_frame(self) -> bool:
        """Check if the frame can be skipped because the car is stationary.

        Skip conditions (ALL must be true):
          - Position delta < 0.1m
          - Yaw delta < 0.5 degrees
          - Speed < 2 km/h
          - Less than 1 second since last sent frame (ensures at least 1 fps when idle)

        Never skip during countdown or when we have no previous reference frame.
        """
        # Never skip if we haven't sent a frame yet
        if self._last_sent_x is None:
            return False

        # Never skip during countdown
        if self.race_state and self.race_state.status == "countdown":
            return False

        # Get current player telemetry
        if not self.carla.player_car:
            return False

        try:
            telem = self.carla.get_telemetry(self.carla.player_car)
        except Exception:
            return False

        speed_kmh = telem.get('speed_kmh', 0.0)

        # Always send frames when car is moving
        if speed_kmh > 2.0:
            return False

        x, y = telem['x'], telem['y']
        yaw = telem.get('yaw', 0.0)

        # Check position delta
        dx = x - self._last_sent_x
        dy = y - self._last_sent_y
        pos_delta = (dx * dx + dy * dy) ** 0.5

        if pos_delta >= 0.1:
            return False

        # Check yaw delta (handle wraparound at +/-180)
        yaw_delta = abs(yaw - self._last_sent_yaw)
        if yaw_delta > 180:
            yaw_delta = 360 - yaw_delta
        if yaw_delta >= 0.5:
            return False

        # Stationary: but enforce at least 1 frame per second
        now = time.time()
        if now - self._last_sent_time >= 1.0:
            return False

        return True

    async def _send_frame(self):
        """Encode and send chase camera frame as binary WebSocket message.
        Also sends rear-view mirror frames at half rate (15fps).

        Binary frame format: 1-byte type prefix + data
          0x00 = main camera JPEG frame
          0x01 = rear-view mirror JPEG frame
          0x10 = H.264 keyframe (SPS+PPS+IDR)
          0x11 = H.264 delta frame (non-IDR slice)
          0x12 = codec config JSON

        Optimizations:
          - Skipped when WebRTC is active and connected (video flows via RTP track)
          - Position-based skip: if car is stationary, skip encoding entirely
          - Frame delta skip: if frame content is similar to last sent, send
            a lightweight 'no_change' JSON message instead of re-encoding JPEG
          - JPEG encoding runs in thread pool to avoid blocking asyncio event loop
          - Periodically sends perf_stats to client for debug overlay
          - When NVENC H.264 is enabled: uses GPU hardware encoding (1-2ms vs 5-10ms JPEG)
        """
        if not self.ws_client:
            return

        # When WebRTC is streaming video, skip JPEG-over-WebSocket
        # But only if the connection is actually established (not just negotiated)
        if self.pc is not None and self.pc.connectionState == "connected":
            return

        # Position-based frame skip: don't encode/send if camera hasn't moved
        if self._should_skip_frame():
            self._frame_skip_count += 1
            self._stats_skip_count += 1
            self._session_total_skips += 1
            return

        # --- H.264 NVENC path ---
        if self._h264_enabled and self._nvenc_encoder and self._nvenc_encoder.is_running:
            # Try NvFBC capture first (zero-copy from GPU framebuffer)
            # Falls back to CARLA camera sensor if NvFBC unavailable
            raw_frame = None
            if self._nvfbc_enabled and self._nvfbc_capture:
                raw_frame = self._nvfbc_capture.capture_frame()

            # Fallback: CARLA camera sensor (bytes(image.raw_data) -> CPU copy)
            if raw_frame is None:
                raw_frame = self.carla.get_chase_frame_raw()

            if raw_frame is None:
                return

            # Feed raw BGRA to NVENC (this returns immediately, encoding is pipelined)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._nvenc_encoder.encode_frame, raw_frame)

            # Drain all available encoded frames
            while True:
                result = self._nvenc_encoder.get_encoded_frame()
                if result is None:
                    break

                is_keyframe, h264_data = result
                prefix = b'\x10' if is_keyframe else b'\x11'

                try:
                    await self.ws_client.send(prefix + h264_data)
                    self.frame_count += 1
                    self._stats_frames_sent += 1
                    self._session_total_frames += 1
                except Exception:
                    pass

            # Update frame skip tracking with current position
            if self.carla.player_car:
                try:
                    telem = self.carla.get_telemetry(self.carla.player_car)
                    self._last_sent_x = telem['x']
                    self._last_sent_y = telem['y']
                    self._last_sent_yaw = telem.get('yaw', 0.0)
                    self._last_sent_time = time.time()
                except Exception:
                    pass

            # Perf logging
            if self.frame_count % 90 == 0:
                stats = self._nvenc_encoder.get_stats()
                capture_info = ""
                if self._nvfbc_enabled and self._nvfbc_capture:
                    cap_stats = self._nvfbc_capture.get_stats()
                    capture_info = (f", capture={cap_stats['method']}, "
                                    f"cap_avg={cap_stats['avg_capture_ms']:.2f}ms")
                print(f"[perf] frame #{self.frame_count}: "
                      f"nvenc_encoded={stats['frames_encoded']}, "
                      f"queue={stats['queue_size']}, "
                      f"errors={stats['errors']}, "
                      f"fps={self.fps:.1f}"
                      f"{capture_info}")
                self._frame_skip_count = 0
                self._delta_skip_count = 0

            # Rear-view mirror (still JPEG, lower priority)
            self._rear_frame_counter += 1
            if self._rear_frame_counter % 2 == 0:
                await self._send_rear_frame()

            return

        # --- JPEG fallback path (original) ---

        # Try NvFBC capture for JPEG path too (convert BGRA bytes -> RGB numpy)
        # NvFBC is most beneficial with NVENC (raw bytes -> GPU encode), but
        # can also feed the JPEG encoder after a BGRA->RGB conversion.
        frame = None
        if self._nvfbc_enabled and self._nvfbc_capture:
            raw_frame = self._nvfbc_capture.capture_frame()
            if raw_frame is not None:
                try:
                    width = self.config.get('streaming', {}).get('width', 1280)
                    height = self.config.get('streaming', {}).get('height', 720)
                    array = np.frombuffer(raw_frame, dtype=np.uint8)
                    array = array.reshape((height, width, 4))
                    # BGRA -> RGB
                    frame = array[:, :, :3][:, :, ::-1].copy()
                except Exception:
                    frame = None

        # Fallback: CARLA camera sensor (default path)
        if frame is None:
            frame = self.carla.get_chase_frame()

        if frame is None:
            return

        # Frame delta detection: check if this frame is similar to the last sent
        # This is fast (<0.5ms) and saves encoding + bandwidth when idle
        # Disable during countdown -- scene is static but client needs frames for HUD
        is_countdown = self.race_state and self.race_state.status == "countdown"
        if not is_countdown and self.encoder.is_frame_similar(frame):
            self._delta_skip_count += 1
            self._stats_skip_count += 1
            self._session_total_skips += 1
            # Send a lightweight no_change message so the client knows
            # the connection is alive and can keep displaying the last frame
            try:
                await self.ws_client.send(json.dumps({'type': 'no_change'}))
            except Exception:
                pass
            return

        # Encode JPEG in a thread pool to avoid blocking the event loop (~5-10ms)
        loop = asyncio.get_event_loop()
        jpeg_bytes = await loop.run_in_executor(None, self.encoder.encode, frame)

        if jpeg_bytes is None:
            return

        try:
            # Prepend type byte 0x00 for main camera frame
            await self.ws_client.send(b'\x00' + jpeg_bytes)
            self.frame_count += 1

            # Track frame for per-second and session stats
            self._stats_frames_sent += 1
            self._session_total_frames += 1
            self._session_qualities.append(self.encoder.quality)
            self._session_frame_sizes.append(len(jpeg_bytes))

            # Push frame to highlight ring buffer for replay capture
            self.highlight_buffer.push_frame(jpeg_bytes)

            # Update frame skip tracking with current position
            if self.carla.player_car:
                try:
                    telem = self.carla.get_telemetry(self.carla.player_car)
                    self._last_sent_x = telem['x']
                    self._last_sent_y = telem['y']
                    self._last_sent_yaw = telem.get('yaw', 0.0)
                    self._last_sent_time = time.time()
                except Exception:
                    pass

            # Enhanced perf logging every 90 frames (~3 seconds)
            if self.frame_count % 90 == 0:
                perf = self.encoder.get_perf_stats()
                print(f"[perf] frame #{self.frame_count}: "
                      f"avg_encode={perf['avg_encode_ms']:.1f}ms, "
                      f"avg_size={perf['avg_frame_size_kb']:.0f}KB, "
                      f"fps={self.fps:.1f}, quality={perf['quality']}, "
                      f"res={perf['resolution']}, "
                      f"pos_skip={self._frame_skip_count}, "
                      f"delta_skip={self._delta_skip_count}"
                      f"{' [AUTO-REDUCED]' if perf['auto_reduced'] else ''}")
                # Reset skip counters for next interval
                self._frame_skip_count = 0
                self._delta_skip_count = 0

            # Send perf_stats to client periodically (every 3 seconds)
            if self.encoder.should_send_perf_stats(interval=3.0):
                perf = self.encoder.get_perf_stats()
                perf['type'] = 'perf_stats'
                perf['fps'] = round(self.fps, 1)
                perf['frames_sent'] = self.frame_count
                try:
                    await self.ws_client.send(json.dumps(perf))
                except Exception:
                    pass

            # --- Rear-view mirror frame (sent at 15fps = every 2nd main frame) ---
            self._rear_frame_counter += 1
            if self._rear_frame_counter % 2 == 0:
                await self._send_rear_frame()

        except Exception:
            pass

    async def _send_rear_frame(self):
        """Encode and send rear-view mirror frame with 0x01 type prefix.

        Uses a separate low-quality encoder (JPEG quality 30, 320x120).
        Only sent when WebSocket is open and WebRTC is not streaming.
        """
        if not self.ws_client:
            return
        if self.pc is not None and self.pc.connectionState == "connected":
            return

        rear_frame = self.carla.get_rear_frame()
        if rear_frame is None:
            return

        loop = asyncio.get_event_loop()
        jpeg_bytes = await loop.run_in_executor(None, self.rear_encoder.encode, rear_frame)
        if jpeg_bytes is None:
            return

        try:
            # Prepend type byte 0x01 for rear camera frame
            await self.ws_client.send(b'\x01' + jpeg_bytes)
        except Exception:
            pass

    def _check_highlight_events(self, player_telem, ai_telem, drift_event):
        """Check for highlight-worthy events and snapshot the ring buffer.

        Detects:
          - Overtakes: gap sign changes (player passes AI or vice versa)
          - Collisions: significant impact from collision sensor
          - Drifts: drift score exceeding 500 points
          - Near-misses: cars within 2m at combined speed > 100 km/h

        Args:
            player_telem: Player telemetry dict (may be None).
            ai_telem: AI telemetry dict (may be None).
            drift_event: Drift event dict from race_state.update_drift() (may be None).
        """
        if not self.race_state or self.race_state.status != "racing":
            return

        # --- Overtake detection ---
        gap = self.race_state.get_gap_seconds()
        if gap is not None and self._prev_gap_seconds is not None:
            # Gap sign change = overtake (positive = player ahead, negative = AI ahead)
            if (self._prev_gap_seconds > 0.5 and gap < -0.1) or \
               (self._prev_gap_seconds < -0.5 and gap > 0.1):
                overtaker = 'player' if gap > 0 else 'ai'
                self.highlight_buffer.capture_highlight('overtake', metadata={
                    'overtaker': overtaker,
                    'gap': round(abs(gap), 2),
                })
        self._prev_gap_seconds = gap

        # --- Collision detection ---
        # Note: we don't call get_recent_collisions() here because the telemetry
        # loop already consumes them. Instead, check the drift angle as a proxy
        # for collision intensity, or use the collision count from race_state.
        # We use a separate flag set from the telemetry loop.
        collision_count = getattr(self, '_highlight_collision_count', 0)
        current_collisions = getattr(self.race_state, '_player_collisions', 0)
        if current_collisions > collision_count:
            # New collisions detected since last check
            new_collisions = current_collisions - collision_count
            if new_collisions > 0:
                self.highlight_buffer.capture_highlight('collision', metadata={
                    'count': new_collisions,
                })
        self._highlight_collision_count = current_collisions

        # --- Drift detection (score > 500) ---
        if drift_event and drift_event.get('event') == 'drift_end':
            score = drift_event.get('score', 0)
            if score > 500:
                self.highlight_buffer.capture_highlight('drift', metadata={
                    'score': round(score, 0),
                    'combo': drift_event.get('combo', 1),
                })

        # --- Near-miss detection (cars within 2m at speed) ---
        if player_telem and ai_telem:
            dx = player_telem['x'] - ai_telem['x']
            dy = player_telem['y'] - ai_telem['y']
            distance = (dx * dx + dy * dy) ** 0.5
            combined_speed = player_telem['speed_kmh'] + ai_telem['speed_kmh']
            if distance < 2.0 and combined_speed > 100.0:
                self.highlight_buffer.capture_highlight('near_miss', metadata={
                    'distance': round(distance, 2),
                    'combined_speed': round(combined_speed, 1),
                })

    async def _telemetry_loop(self):
        """Send race telemetry JSON at ~30Hz, independent of the 30fps frame loop.

        Reads the latest vehicle telemetry from CARLA (getters work between
        ticks) and sends a race_state JSON message to the client.
        """
        target_dt = 1.0 / 30.0  # 30 Hz (was 60Hz, reduced to cut bandwidth)

        while self.running and self.ws_client:
            loop_start = time.time()

            try:
                if self.race_state and self.race_state.status in ("countdown", "racing", "finishing"):
                    # Read current telemetry (works between CARLA ticks)
                    player_telem = None
                    ai_telem = None
                    if self.race_state.status in ("racing", "finishing"):
                        try:
                            player_telem = self.carla.get_telemetry(self.carla.player_car)
                            ai_telem = self.carla.get_telemetry(self.carla.ai_car)
                        except Exception:
                            pass  # Telemetry read failed, send state without vehicle data
                    await self._send_race_state(player_telem, ai_telem)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"Telemetry loop error: {e}")

            elapsed = time.time() - loop_start
            sleep_time = target_dt - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    async def _send_race_state(self, player_telem: Optional[Dict] = None,
                                ai_telem: Optional[Dict] = None):
        """Send race state as JSON WebSocket message."""
        if not self.ws_client or not self.race_state:
            return

        state = self.race_state.to_dict()
        state['type'] = 'race_state'
        state['model'] = self.current_model_name
        state['fps'] = round(self.fps, 1)
        state['jpeg_quality'] = self.encoder.get_quality()
        state['camera_mode'] = self.carla._camera_mode

        # Include recent collisions (returns and clears stored events)
        recent_collisions = self.carla.get_recent_collisions()
        if recent_collisions:
            state['collisions'] = [{'intensity': c['intensity']} for c in recent_collisions]
            # Track collision count in race stats
            for _ in recent_collisions:
                self.race_state.report_player_collision()
                # Feed collisions to skill matcher for adaptive AI
                if self.skill_matcher:
                    self.skill_matcher.record_collision()

        # Fill in telemetry from both vehicles
        if player_telem:
            state['player']['speed_kmh'] = round(player_telem['speed_kmh'], 1)
            state['player']['gear'] = player_telem.get('gear', 0)
            state['player']['rpm'] = round(player_telem.get('rpm', 0), 0)
            state['player']['throttle'] = round(player_telem.get('throttle', 0), 2)
            state['player']['brake'] = round(player_telem.get('brake', 0), 2)
            state['player']['steer'] = round(player_telem.get('steer', 0), 2)
            state['player']['yaw'] = round(player_telem.get('yaw', 0), 1)
        if ai_telem:
            state['ai']['speed_kmh'] = round(ai_telem['speed_kmh'], 1)
            state['ai']['gear'] = ai_telem.get('gear', 0)
            state['ai']['rpm'] = round(ai_telem.get('rpm', 0), 0)
            state['ai']['throttle'] = round(ai_telem.get('throttle', 0), 2)
            state['ai']['brake'] = round(ai_telem.get('brake', 0), 2)
            state['ai']['steer'] = round(ai_telem.get('steer', 0), 2)

        # Calculate gap between player and AI
        gap = self.race_state.get_gap_seconds()
        state['player']['gap_seconds'] = round(gap, 2) if gap is not None else None
        state['ai']['gap_seconds'] = round(-gap, 2) if gap is not None else None

        # Race Director info
        if self.race_director:
            progress = self.race_director.get_race_progress(self.race_state)
            state['race_progress'] = round(progress, 2)

        # AI Personality emotion for HUD display
        if self.ai_personality:
            state['ai_emotion'] = self.ai_personality.to_dict()

        # Weather mood info for frontend overlay effects
        if self.weather_mood:
            state['weather_mood'] = self.weather_mood.get_mood()

        # Event-driven weather mood (merges with intensity-based mood)
        if self.weather_event_manager:
            event_weather = self.weather_event_manager.get_weather_state()
            if 'weather_mood' in state:
                # Merge: use the more intense mood between intensity-based and event-based
                existing = state['weather_mood']
                if event_weather['intensity'] > existing.get('intensity', 0):
                    state['weather_mood']['mood'] = event_weather['mood']
                    state['weather_mood']['intensity'] = event_weather['intensity']
                # Take the max of each weather effect for overlay
                for key in ('precipitation', 'fog_density', 'wind_intensity', 'cloudiness'):
                    state['weather_mood'][key] = max(
                        existing.get(key, 0),
                        event_weather.get(key, 0),
                    )
                # Include wetness from event manager
                state['weather_mood']['wetness'] = event_weather.get('wetness', 0)
            else:
                state['weather_mood'] = event_weather

        try:
            await self.ws_client.send(json.dumps(state))
        except Exception:
            pass


async def main():
    """Start the race server."""
    config_path = "configs/race.yaml"
    server = RaceServer(config_path)

    port = 8765
    print(f"Starting Shadow Driver v3 Race Server on port {port}...")

    # HTTP health check handler for non-WebSocket requests (e.g. GET /health)
    async def process_request(path, request_headers):
        if path == "/health":
            import subprocess
            health = {
                "status": "ok",
                "clients": len(server.shutdown_manager.connected_clients),
                "race_running": server.running,
            }
            # CARLA status
            try:
                carla_running = bool(subprocess.run(
                    ["pgrep", "-f", "CarlaUE4"], capture_output=True
                ).returncode == 0)
                health["carla"] = "running" if carla_running else "stopped"
            except Exception:
                health["carla"] = "unknown"
            # GPU info (temperature + VRAM)
            try:
                result = subprocess.run(
                    ["nvidia-smi", "--query-gpu=temperature.gpu,memory.used,memory.total",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    parts = result.stdout.strip().split(", ")
                    if len(parts) == 3:
                        health["gpu_temp_c"] = int(parts[0])
                        health["vram_used_mb"] = int(parts[1])
                        health["vram_total_mb"] = int(parts[2])
            except Exception:
                pass
            body = json.dumps(health).encode()
            return (200, [("Content-Type", "application/json")], body)
        return None  # Continue with WebSocket handshake

    async with websockets.serve(
        server.handle_client, "0.0.0.0", port,
        process_request=process_request,
    ):
        print(f"Server ready. Waiting for connections on ws://0.0.0.0:{port}")

        # Start the auto-shutdown timer immediately (no clients connected yet)
        print(f"[auto-shutdown] Starting initial {IDLE_TIMEOUT_SECONDS // 60}-minute idle timer...")
        server.shutdown_manager._idle_task = asyncio.create_task(
            server.shutdown_manager._idle_countdown()
        )

        # Keep running until interrupted
        stop = asyncio.Future()
        loop = asyncio.get_event_loop()

        def signal_handler():
            stop.set_result(None)

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, signal_handler)

        await stop


if __name__ == "__main__":
    asyncio.run(main())
