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
from race_logic import RaceState, generate_checkpoints_from_waypoints


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
        self.player_keys: Dict[str, bool] = {'w': False, 'a': False, 's': False, 'd': False}
        self.current_model_name = self.config['model'].get('default', 'carla_pilotnet')
        self.running = False
        self.ws_client = None
        self.frame_count = 0
        self.fps = 0.0
        self._fps_timer = time.time()
        self._fps_count = 0

    async def handle_client(self, websocket):
        """Handle a single WebSocket client connection."""
        print(f"Client connected: {websocket.remote_address}")
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
                        'models': ['carla_pilotnet', 'alpamayo'],
                    }))

                elif msg_type == 'control':
                    keys = data.get('keys', {})
                    self.player_keys = {
                        'w': keys.get('w', False),
                        'a': keys.get('a', False),
                        's': keys.get('s', False),
                        'd': keys.get('d', False),
                    }

                elif msg_type == 'switch_model':
                    model_name = data.get('model', 'carla_pilotnet')
                    await self._switch_model(model_name)

                elif msg_type == 'start_race':
                    track = data.get('track', 'Town03')
                    laps = data.get('laps', 3)
                    await self._start_race(track, laps)

                elif msg_type == 'ping':
                    await websocket.send(json.dumps({
                        'type': 'pong',
                        'timestamp': data.get('timestamp'),
                    }))

        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")
        finally:
            self.ws_client = None
            self.running = False

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

    async def _start_race(self, track: str, laps: int):
        """Initialize and start a race."""
        print(f"Starting race: track={track}, laps={laps}")

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

        # Load AI model
        weights = self.config['model'].get('weights', {}).get(self.current_model_name)
        self.model.load_model(self.current_model_name, weights=weights)

        # Generate checkpoints from CARLA map
        checkpoints = generate_checkpoints_from_waypoints(
            self.carla.world,
            num_checkpoints=self.config.get('race', {}).get('checkpoints', 10),
            radius=self.config.get('race', {}).get('checkpoint_radius', 15.0),
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

        # Run the race loop
        asyncio.create_task(self._race_loop())

    async def _race_loop(self):
        """Main race loop: runs at ~20fps."""
        target_dt = 1.0 / 20.0  # 20 FPS target

        while self.running and self.ws_client:
            loop_start = time.time()

            try:
                # Handle countdown
                if self.race_state.status == "countdown":
                    countdown = self.race_state.get_countdown()
                    if countdown == 0:
                        self.race_state.start_race()
                    # Still send frames during countdown
                    await self._send_frame()
                    await self._send_race_state()

                elif self.race_state.status == "racing":
                    # 1. Apply player controls
                    self.carla.apply_player_control(self.player_keys)

                    # 2. Get AI camera frame and run inference
                    ai_frame = self.carla.get_ai_frame()
                    if ai_frame is not None:
                        prediction = self.model.predict(ai_frame)
                        if prediction:
                            self.carla.apply_ai_control(prediction)

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

                    # 5. Send chase camera frame to browser
                    await self._send_frame()

                    # 6. Send race state
                    await self._send_race_state(player_telem, ai_telem)

                elif self.race_state.status == "finished":
                    # Send final race result
                    if self.ws_client:
                        await self.ws_client.send(json.dumps({
                            'type': 'race_finished',
                            'winner': self.race_state.winner,
                            'player_time': self.race_state.player_finish_time,
                            'ai_time': self.race_state.ai_finish_time,
                            'player_laps': self.race_state.player_lap_times,
                            'ai_laps': self.race_state.ai_lap_times,
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

        # Cleanup after race
        self.carla.cleanup()

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

    async def _send_race_state(self, player_telem: Optional[Dict] = None,
                                ai_telem: Optional[Dict] = None):
        """Send race state as JSON WebSocket message."""
        if not self.ws_client or not self.race_state:
            return

        state = self.race_state.to_dict()
        state['type'] = 'race_state'
        state['model'] = self.current_model_name
        state['fps'] = round(self.fps, 1)

        # Fill in speeds from telemetry
        if player_telem:
            state['player']['speed_kmh'] = round(player_telem['speed_kmh'], 1)
        if ai_telem:
            state['ai']['speed_kmh'] = round(ai_telem['speed_kmh'], 1)

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
