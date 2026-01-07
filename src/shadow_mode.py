"""
Shadow Mode - Main application

This is the main entry point for the shadow driving experience.
The AI watches and suggests, but YOU are always in control.

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


def main():
    parser = argparse.ArgumentParser(description="CARLA Shadow Driver")
    parser.add_argument("--config", default="configs/default.yaml",
                        help="Path to config file")
    args = parser.parse_args()

    print("Starting Shadow Driver...")
    print(f"Config: {args.config}")

    driver = ShadowDriver(args.config)

    if not driver.connect():
        print("Failed to connect. Make sure CARLA server is running.")
        sys.exit(1)

    driver.run()


if __name__ == "__main__":
    main()
