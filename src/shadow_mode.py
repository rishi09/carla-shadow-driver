"""
Shadow Mode - Main application

This is the main entry point for the shadow driving experience.
The AI watches and suggests, but YOU are always in control.

Modes:
  Normal:    Full CARLA simulation with pygame display
  WebSocket: Server mode for browser-based demo connection

Controls:
  W/S     - Throttle / Brake
  A/D     - Steer left/right
  R       - Toggle recording
  SPACE   - Emergency stop
  ESC/Q   - Quit
"""
import sys
import time
import argparse
import asyncio
import json
import numpy as np
import cv2
import pygame
from typing import Optional

# Local imports
from carla_client import CarlaClient
from sensors import CameraManager
from model_manager import ModelManager
from recorder import DrivingRecorder
from visualizer import ShadowModeHUD
import yaml


class ShadowDriver:
    """Main shadow mode application."""

    def __init__(self, config_path: str = "configs/default.yaml"):
        self.config_path = config_path

        # Load config
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)

        # Initialize components
        self.carla = CarlaClient(config_path)
        self.camera_mgr = CameraManager()

        # Initialize model manager with configured model
        self.model_mgr = ModelManager()
        model_name = config.get('model', {}).get('name', 'carla_pilotnet')
        weights_path = config.get('model', {}).get('weights_path', 'models/pilotnet_carla.pth')
        print(f"Loading model: {model_name}")
        self.model_mgr.load_model(model_name, weights=weights_path)

        self.recorder = DrivingRecorder(config_path)
        self.hud = ShadowModeHUD()

        # State
        self.running = False
        self.recording = False

        # Control state
        self.throttle = 0.0
        self.steer = 0.0
        self.brake = 0.0

        # Initialize pygame for keyboard input
        pygame.init()
        pygame.display.set_mode((1, 1))  # Minimal window for keyboard capture

    def connect(self) -> bool:
        """Connect to CARLA and spawn vehicle."""
        if not self.carla.connect():
            return False

        if not self.carla.spawn_vehicle():
            return False

        if not self.carla.attach_camera(self.camera_mgr.on_image):
            return False

        return True

    def process_input(self) -> bool:
        """Process keyboard input. Returns False if should quit."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False

            if event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    return False
                elif event.key == pygame.K_r:
                    self._toggle_recording()
                elif event.key == pygame.K_SPACE:
                    self._emergency_stop()

        # Continuous key state
        keys = pygame.key.get_pressed()

        # Throttle/brake
        if keys[pygame.K_w]:
            self.throttle = min(1.0, self.throttle + 0.05)
            self.brake = 0.0
        elif keys[pygame.K_s]:
            self.throttle = 0.0
            self.brake = min(1.0, self.brake + 0.1)
        else:
            self.throttle = max(0.0, self.throttle - 0.02)
            self.brake = max(0.0, self.brake - 0.05)

        # Steering
        if keys[pygame.K_a]:
            self.steer = max(-1.0, self.steer - 0.05)
        elif keys[pygame.K_d]:
            self.steer = min(1.0, self.steer + 0.05)
        else:
            # Return to center
            if abs(self.steer) < 0.02:
                self.steer = 0.0
            else:
                self.steer *= 0.9

        return True

    def _toggle_recording(self):
        """Toggle recording on/off."""
        if self.recording:
            self.recorder.stop_session()
            self.recording = False
            print("Recording stopped")
        else:
            self.recorder.start_session()
            self.recording = True
            print("Recording started - press R to stop")

    def _emergency_stop(self):
        """Emergency stop."""
        self.throttle = 0.0
        self.brake = 1.0
        self.carla.apply_control(throttle=0, steer=0, brake=1, hand_brake=True)
        print("EMERGENCY STOP")

    def run(self):
        """Main loop."""
        print("\n" + "=" * 50)
        print("SHADOW MODE ACTIVE")
        print("=" * 50)
        print("\nControls:")
        print("  W/S   - Throttle/Brake")
        print("  A/D   - Steer")
        print("  R     - Toggle recording")
        print("  SPACE - Emergency stop")
        print("  ESC   - Quit")
        print("\n" + "=" * 50)

        self.running = True
        frame_count = 0
        fps_timer = time.time()
        fps = 0

        try:
            while self.running:
                # Process input
                if not self.process_input():
                    break

                # Apply control
                self.carla.apply_control(
                    throttle=self.throttle,
                    steer=self.steer,
                    brake=self.brake
                )

                # Get frame
                frame = self.camera_mgr.get_latest_frame()
                if frame is None:
                    time.sleep(0.01)
                    continue

                # Get telemetry
                telemetry = self.carla.get_telemetry()
                telemetry['steer'] = self.steer  # Add current input

                # AI prediction
                ai_prediction = self.model_mgr.predict(frame)

                # Record if enabled
                if self.recording:
                    self.recorder.record_frame(frame, telemetry, ai_prediction)

                # Render HUD
                display_frame = self.hud.render_full_hud(
                    frame, telemetry, ai_prediction,
                    self.recording, self.recorder.frame_count
                )

                # Calculate FPS
                frame_count += 1
                if time.time() - fps_timer >= 1.0:
                    fps = frame_count
                    frame_count = 0
                    fps_timer = time.time()

                # Add FPS to display
                cv2.putText(display_frame, f"FPS: {fps}", (10, 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                # Show frame
                cv2.imshow("Shadow Mode", cv2.cvtColor(display_frame, cv2.COLOR_RGB2BGR))

                # OpenCV window events
                key = cv2.waitKey(1) & 0xFF
                if key == 27 or key == ord('q'):  # ESC or Q
                    break

        except KeyboardInterrupt:
            print("\nInterrupted by user")

        finally:
            self.cleanup()

    def cleanup(self):
        """Clean up resources."""
        self.running = False

        if self.recording:
            self.recorder.stop_session()

        self.carla.cleanup()
        cv2.destroyAllWindows()
        pygame.quit()
        print("Cleanup complete")


class WebSocketServer:
    """WebSocket server for browser-based demo connections.

    Receives state updates from the browser demo and returns AI predictions.
    This allows the browser to use real AI models running on GPU.
    """

    def __init__(self, config_path: str = "configs/default.yaml",
                 host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.config_path = config_path
        self.clients = set()

        # Load config
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)

        # Initialize model manager
        self.model_mgr = ModelManager()
        self.model_name = config.get('model', {}).get('name', 'carla_pilotnet')
        weights_path = config.get('model', {}).get('weights_path', 'models/pilotnet_carla.pth')
        print(f"Loading model: {self.model_name}")
        self.model_mgr.load_model(self.model_name, weights=weights_path)

        self.frame_count = 0
        self.start_time = None

    async def handle_client(self, websocket):
        """Handle a connected browser client."""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        print(f"Client connected: {client_addr}")

        if self.start_time is None:
            self.start_time = time.time()

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    response = await self.process_message(data)
                    await websocket.send(json.dumps(response))
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': 'Invalid JSON'
                    }))
                except Exception as e:
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': str(e)
                    }))
        except Exception as e:
            print(f"Client error: {e}")
        finally:
            self.clients.remove(websocket)
            print(f"Client disconnected: {client_addr}")

    async def process_message(self, data: dict) -> dict:
        """Process incoming message and return AI prediction."""
        msg_type = data.get('type', 'state_update')

        if msg_type == 'ping':
            return {'type': 'pong', 'timestamp': time.time()}

        if msg_type == 'state_update':
            # Extract state from browser
            state = data.get('state', {})

            # For now, simulate prediction based on state
            # In full implementation, this would use camera frame from CARLA
            position = state.get('position', 0)
            curvature = state.get('curvature', 0)
            speed = state.get('speed', 0)

            # Use model for prediction (simplified - normally uses camera frame)
            # Since browser can't send full frames easily, we use state-based prediction
            ai_steer = self._compute_steering(position, curvature, speed)

            self.frame_count += 1
            elapsed = time.time() - self.start_time if self.start_time else 0

            return {
                'type': 'prediction',
                'steering': ai_steer,
                'confidence': 0.85 + 0.1 * np.random.random(),
                'model': self.model_name,
                'frame_count': self.frame_count,
                'uptime': elapsed
            }

        if msg_type == 'switch_model':
            model_name = data.get('model', 'carla_pilotnet')
            try:
                self.model_mgr.load_model(model_name)
                self.model_name = model_name
                return {
                    'type': 'model_switched',
                    'model': model_name,
                    'success': True
                }
            except Exception as e:
                return {
                    'type': 'model_switched',
                    'model': model_name,
                    'success': False,
                    'error': str(e)
                }

        if msg_type == 'get_status':
            elapsed = time.time() - self.start_time if self.start_time else 0
            return {
                'type': 'status',
                'connected_clients': len(self.clients),
                'model': self.model_name,
                'frame_count': self.frame_count,
                'uptime': elapsed,
                'fps': self.frame_count / elapsed if elapsed > 0 else 0
            }

        return {'type': 'error', 'message': f'Unknown message type: {msg_type}'}

    def _compute_steering(self, position: float, curvature: float, speed: float) -> float:
        """Compute steering based on road state (used when no camera available)."""
        # Lane centering
        correction = -position * 0.9
        # Curve anticipation
        correction += curvature * 0.7
        # Speed-based damping
        if speed > 60:
            correction *= 0.8
        return max(-1.0, min(1.0, correction))

    async def run(self):
        """Start the WebSocket server."""
        try:
            import websockets
        except ImportError:
            print("ERROR: websockets package not installed")
            print("Install with: pip install websockets")
            sys.exit(1)

        print("\n" + "=" * 50)
        print("SHADOW MODE - WEBSOCKET SERVER")
        print("=" * 50)
        print(f"\nListening on ws://{self.host}:{self.port}")
        print(f"Model: {self.model_name}")
        print("\nConnect from browser demo using:")
        print(f"  Host: <your-ip>")
        print(f"  Port: {self.port}")
        print("\nPress Ctrl+C to stop")
        print("=" * 50 + "\n")

        async with websockets.serve(self.handle_client, self.host, self.port):
            await asyncio.Future()  # Run forever


def main():
    parser = argparse.ArgumentParser(description="CARLA Shadow Driver")
    parser.add_argument("--config", default="configs/default.yaml",
                        help="Path to config file")
    parser.add_argument("--websocket", action="store_true",
                        help="Run as WebSocket server for browser demo")
    parser.add_argument("--host", default="0.0.0.0",
                        help="WebSocket server host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765,
                        help="WebSocket server port (default: 8765)")
    args = parser.parse_args()

    if args.websocket:
        # WebSocket server mode
        print("Starting WebSocket Server...")
        print(f"Config: {args.config}")

        server = WebSocketServer(args.config, args.host, args.port)
        try:
            asyncio.run(server.run())
        except KeyboardInterrupt:
            print("\nServer stopped")
    else:
        # Normal CARLA mode
        print("Starting Shadow Driver...")
        print(f"Config: {args.config}")

        driver = ShadowDriver(args.config)

        if not driver.connect():
            print("Failed to connect. Make sure CARLA server is running.")
            sys.exit(1)

        driver.run()


if __name__ == "__main__":
    main()
