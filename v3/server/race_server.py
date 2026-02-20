"""
Race Server - Main loop: CARLA + WebSocket + model inference
Runs on the GPU instance, connects to CARLA, streams frames to browser
"""
import asyncio
import json
import time
import signal
import sys
import yaml
import numpy as np
from typing import Optional, Dict

import websockets

from aiortc import RTCPeerConnection, RTCSessionDescription, RTCRtpSender
from webrtc_track import CarlaVideoTrack, force_codec

from carla_manager import RaceManager
from model_manager import ModelManager
from frame_encoder import FrameEncoder
from race_logic import RaceState, generate_checkpoints_from_waypoints, RaceDirector, AIMistakeGenerator


class RaceServer:
    """WebSocket server that runs the CARLA race loop."""

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
        self.pc: Optional[RTCPeerConnection] = None
        self.video_track: Optional[CarlaVideoTrack] = None

        # --- Frame skip state (stationary camera optimization) ---
        self._last_sent_x: Optional[float] = None
        self._last_sent_y: Optional[float] = None
        self._last_sent_yaw: Optional[float] = None
        self._last_sent_time: float = 0.0
        self._frame_skip_count: int = 0  # Frames skipped since last perf log
        self._delta_skip_count: int = 0  # Frames skipped via frame delta detection

    async def handle_client(self, websocket):
        """Handle a single WebSocket client connection."""
        print(f"Client connected: {websocket.remote_address}")

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

                elif msg_type == 'start_race':
                    track = data.get('track', 'Town03')
                    laps = data.get('laps', 3)
                    weather = data.get('weather', 'clear')
                    model = data.get('model', 'carla_pilotnet')
                    player_car = data.get('player_car')
                    self.current_model_name = model
                    await self._start_race(track, laps, weather, model, player_car=player_car)

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

                elif msg_type == 'webrtc_offer':
                    await self._handle_webrtc_offer(websocket, data)

        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        finally:
            # Cancel race loop tasks but do NOT destroy CARLA actors
            # This keeps the server alive for reconnecting clients
            await self._reset_race()
            self.ws_client = None
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

        # Reset encoder frame hash for delta detection
        self.encoder.reset_frame_hash()

        # Close WebRTC peer connection
        if self.pc is not None:
            await self.pc.close()
            self.pc = None
            self.video_track = None
            print("WebRTC peer connection closed")

        print("Race reset (actors preserved for reconnect)")

    # Model ID -> difficulty mapping
    MODEL_DIFFICULTY_MAP = {
        'carla_pilotnet': 'easy',
        'pilotnet': 'medium',
        'alpamayo': 'hard',
    }

    async def _start_race(self, track: str, laps: int, weather: str = 'clear', model: str = 'carla_pilotnet', player_car: str = None):
        """Initialize and start a race."""
        difficulty = self.MODEL_DIFFICULTY_MAP.get(model, 'medium')
        self.difficulty = difficulty
        print(f"Starting race: track={track}, laps={laps}, weather={weather}, model={model}, difficulty={difficulty}, player_car={player_car}")

        # Stop any existing race loop first
        await self._reset_race()
        # Restore difficulty after reset
        self.difficulty = difficulty

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

        # Run the frame loop (30fps) and telemetry loop (60Hz) concurrently
        self._race_task = asyncio.create_task(self._race_loop())
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())

    async def _race_loop(self):
        """Main race loop: sends JPEG frames at ~30fps. Telemetry is sent separately at 60Hz."""
        target_dt = 1.0 / 30.0  # 30 FPS target

        while self.running and self.ws_client:
            loop_start = time.time()

            try:
                # Handle countdown
                if self.race_state.status == "countdown":
                    countdown = self.race_state.get_countdown()
                    if countdown == 0:
                        self.race_state.start_race()
                        # Log any pre-buffered key state so we know controls are flowing
                        active_keys = [k for k, v in self.player_keys.items() if v]
                        if active_keys:
                            print(f"Race started! Active keys at start: {active_keys}")
                        else:
                            print("Race started! Controls now active (no keys pressed yet)")
                    # Still send frames during countdown (but don't apply controls)
                    await self._send_frame()

                elif self.race_state.status == "racing":
                    # Yield to let the message handler update player_keys
                    # world.tick() blocks the event loop for ~30ms, starving
                    # the message handler coroutine. This sleep(0) gives it
                    # a chance to process queued WebSocket messages.
                    await asyncio.sleep(0)

                    # 1. Apply player controls
                    self.carla.apply_player_control(self.player_keys)

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
                    player_telem = self.carla.get_telemetry(self.carla.player_car)
                    ai_telem = self.carla.get_telemetry(self.carla.ai_car)

                    self.race_state.update_player(
                        player_telem['x'], player_telem['y'], player_telem['speed_kmh']
                    )
                    self.race_state.update_ai(
                        ai_telem['x'], ai_telem['y'], ai_telem['speed_kmh']
                    )

                    # 4b. Speed-based resolution scaling
                    self.encoder.update_speed_resolution(player_telem['speed_kmh'])

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
                    if self.mistake_generator and self.carla._ai_autopilot:
                        gap = self.race_state.get_gap_seconds()
                        was_active = self.mistake_generator._active_mistake is not None
                        mistake = self.mistake_generator.update(time.time(), gap)
                        if mistake:
                            self.carla.apply_ai_mistake(mistake)
                        elif was_active and self.mistake_generator._active_mistake is None:
                            # Mistake just ended this frame: reset AI speed to base
                            self.carla.adjust_ai_speed(0.0)

                    # 5. Record player position for ghost replay
                    lap_time = self.race_state.get_current_lap_time("player")
                    yaw = player_telem.get('yaw', 0.0)
                    self.race_state.record_player_position(
                        player_telem['x'], player_telem['y'], yaw, lap_time
                    )

                    # 6. Send chase camera frame to browser
                    await self._send_frame()

                elif self.race_state.status == "finished":
                    # Send final race result
                    if self.ws_client:
                        paths = self.race_state.get_paths()
                        stats = self.race_state.get_stats()
                        await self.ws_client.send(json.dumps({
                            'type': 'race_finished',
                            'winner': self.race_state.winner,
                            'player_time': self.race_state.player_finish_time,
                            'ai_time': self.race_state.ai_finish_time,
                            'player_laps': self.race_state.player_lap_times,
                            'ai_laps': self.race_state.ai_lap_times,
                            'player_path': paths['player'],
                            'ai_path': paths['ai'],
                            'player_max_speed': stats['player_max_speed'],
                            'ai_max_speed': stats['ai_max_speed'],
                            'player_distance': stats['player_distance'],
                            'ai_distance': stats['ai_distance'],
                            'player_collisions': stats['player_collisions'],
                        }))
                    self.running = False
                    break

            except Exception as e:
                print(f"Race loop error: {e}")
                import traceback
                traceback.print_exc()

            # Frame timing
            elapsed = time.time() - loop_start
            sleep_time = target_dt - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

            # FPS calculation
            self._fps_count += 1
            now = time.time()
            if now - self._fps_timer >= 1.0:
                self.fps = self._fps_count / (now - self._fps_timer)
                self._fps_count = 0
                self._fps_timer = now

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
        Skipped when WebRTC is active and connected (video flows via the RTP track instead).
        Uses thread pool for JPEG encoding to avoid blocking the asyncio event loop."""
        if not self.ws_client:
            return

        # When WebRTC is streaming video, skip JPEG-over-WebSocket
        # But only if the connection is actually established (not just negotiated)
        if self.pc is not None and self.pc.connectionState == "connected":
            return

        # Frame skip: don't encode/send if the camera view hasn't changed
        if self._should_skip_frame():
            self._frame_skip_count += 1
            return

        frame = self.carla.get_chase_frame()
        if frame is None:
            return

        # Encode JPEG in a thread pool to avoid blocking the event loop (~5-10ms)
        t0 = time.time()
        loop = asyncio.get_event_loop()
        jpeg_bytes = await loop.run_in_executor(None, self.encoder.encode, frame)
        encode_ms = (time.time() - t0) * 1000

        if jpeg_bytes is None:
            return

        # Track encode times for perf logging
        self._encode_times.append(encode_ms)

        try:
            await self.ws_client.send(jpeg_bytes)
            self.frame_count += 1

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
                avg_encode = 0.0
                if self._encode_times:
                    avg_encode = sum(self._encode_times) / len(self._encode_times)
                print(f"[perf] frame #{self.frame_count}: encode={encode_ms:.1f}ms, "
                      f"avg_encode={avg_encode:.1f}ms, size={len(jpeg_bytes)//1024}KB, "
                      f"fps={self.fps:.1f}, quality={self.encoder.get_quality()}, "
                      f"skipped={self._frame_skip_count}")
                # Reset counters for next interval
                self._encode_times.clear()
                self._frame_skip_count = 0
        except Exception:
            pass

    async def _telemetry_loop(self):
        """Send race telemetry JSON at 60Hz, independent of the 30fps frame loop.

        Reads the latest vehicle telemetry from CARLA (getters work between
        ticks) and sends a race_state JSON message to the client.
        """
        target_dt = 1.0 / 30.0  # 30 Hz (was 60Hz, reduced to cut bandwidth)

        while self.running and self.ws_client:
            loop_start = time.time()

            try:
                if self.race_state and self.race_state.status in ("countdown", "racing"):
                    # Read current telemetry (works between CARLA ticks)
                    player_telem = None
                    ai_telem = None
                    if self.race_state.status == "racing":
                        player_telem = self.carla.get_telemetry(self.carla.player_car)
                        ai_telem = self.carla.get_telemetry(self.carla.ai_car)
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

    async with websockets.serve(server.handle_client, "0.0.0.0", port):
        print(f"Server ready. Waiting for connections on ws://0.0.0.0:{port}")

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
