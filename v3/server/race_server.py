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
                    active = [k for k, v in self.player_keys.items() if v]
                    if not self._controls_received:
                        self._controls_received = True
                        race_status = self.race_state.status if self.race_state else "no_race"
                        print(f"First control received (race_status={race_status}, keys={active or 'none'})")
                    elif active and self._control_msg_count % 30 == 0:
                        # Log active keys every ~1 second when keys are pressed
                        print(f"Controls #{self._control_msg_count}: keys={active}")
                    elif self._control_msg_count % 90 == 0:
                        # Log every ~3 seconds even when no keys pressed
                        print(f"Controls #{self._control_msg_count}: keys=none (raw={data.get('keys', {})})")
                    # Adaptive JPEG quality based on client latency
                    latency = data.get('latency')
                    if latency is not None:
                        if latency > 200:
                            self.encoder.set_quality(50)
                        elif latency < 100:
                            self.encoder.set_quality(80)
                        else:
                            self.encoder.set_quality(70)

                elif msg_type == 'switch_model':
                    model_name = data.get('model', 'carla_pilotnet')
                    await self._switch_model(model_name)

                elif msg_type == 'start_race':
                    track = data.get('track', 'Town03')
                    laps = data.get('laps', 3)
                    weather = data.get('weather', 'clear')
                    model = data.get('model', 'carla_pilotnet')
                    self.current_model_name = model
                    await self._start_race(track, laps, weather, model)

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
                    await websocket.send(json.dumps({
                        'type': 'camera_mode_changed',
                        'mode': self.carla._camera_mode,
                    }))

        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        finally:
            # Cancel race loop tasks but do NOT destroy CARLA actors
            # This keeps the server alive for reconnecting clients
            await self._reset_race()
            self.ws_client = None
            print("Client disconnected, waiting for reconnect...")

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

        print("Race reset (actors preserved for reconnect)")

    # Model ID -> difficulty mapping
    MODEL_DIFFICULTY_MAP = {
        'carla_pilotnet': 'easy',
        'pilotnet': 'medium',
        'alpamayo': 'hard',
    }

    async def _start_race(self, track: str, laps: int, weather: str = 'clear', model: str = 'carla_pilotnet'):
        """Initialize and start a race."""
        difficulty = self.MODEL_DIFFICULTY_MAP.get(model, 'medium')
        self.difficulty = difficulty
        print(f"Starting race: track={track}, laps={laps}, weather={weather}, model={model}, difficulty={difficulty}")

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

        if not self.carla.setup_race(track):
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

                    # 3. Tick CARLA
                    self.carla.tick()

                    # 4. Update race state with vehicle positions
                    player_telem = self.carla.get_telemetry(self.carla.player_car)
                    ai_telem = self.carla.get_telemetry(self.carla.ai_car)

                    self.race_state.update_player(
                        player_telem['x'], player_telem['y'], player_telem['speed_kmh']
                    )
                    self.race_state.update_ai(
                        ai_telem['x'], ai_telem['y'], ai_telem['speed_kmh']
                    )

                    # Race Director: dynamically adjust AI speed
                    if self.race_director and self.carla._ai_autopilot:
                        gap = self.race_state.get_gap_seconds()
                        progress = self.race_director.get_race_progress(self.race_state)
                        speed_adj = self.race_director.get_speed_adjustment(gap, progress, time.time())
                        if abs(speed_adj) > 0.5:  # Only apply if meaningful
                            self.carla.adjust_ai_speed(speed_adj)

                    # AI Mistakes: periodically slow the AI to create overtaking opportunities
                    if self.mistake_generator and self.carla._ai_autopilot:
                        gap = self.race_state.get_gap_seconds()
                        mistake = self.mistake_generator.update(time.time(), gap)
                        if mistake:
                            self.carla.apply_ai_mistake(mistake)

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

    async def _send_frame(self):
        """Encode and send chase camera frame as binary WebSocket message."""
        if not self.ws_client:
            return

        frame = self.carla.get_chase_frame()
        if frame is None:
            return

        jpeg_bytes = self.encoder.encode(frame)
        if jpeg_bytes is None:
            return

        try:
            await self.ws_client.send(jpeg_bytes)
            self.frame_count += 1
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
