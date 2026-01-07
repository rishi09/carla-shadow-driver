"""
Demo Mode - Test the shadow mode UI without CARLA

This creates a synthetic driving environment so you can:
1. Test the visualization works
2. Test the PilotNet model
3. See how shadow mode will look

Run this first before setting up Vast.ai!
"""
import sys
import time
import numpy as np
import cv2
import pygame
from pathlib import Path

# Add src to path if running from project root
sys.path.insert(0, str(Path(__file__).parent))

from model import SteeringPredictor
from visualizer import ShadowModeHUD


class SyntheticRoad:
    """Generate synthetic road images for testing."""

    def __init__(self, width: int = 640, height: int = 480):
        self.width = width
        self.height = height
        self.position = 0.0  # Lateral position [-1, 1]
        self.speed = 30.0    # km/h

    def render(self, steering: float) -> np.ndarray:
        """Render a synthetic road view."""
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)

        # Sky gradient
        for y in range(self.height // 2):
            intensity = 180 + int(40 * y / (self.height // 2))
            frame[y, :] = [intensity, intensity - 40, intensity - 80]

        # Ground
        frame[self.height // 2:, :] = [80, 100, 80]

        # Road (trapezoid)
        cx = self.width // 2 + int(self.position * 100)
        road_top = self.height // 2
        road_bottom = self.height

        # Perspective points
        top_left = cx - 80
        top_right = cx + 80
        bottom_left = cx - 300
        bottom_right = cx + 300

        road_pts = np.array([
            [top_left, road_top],
            [top_right, road_top],
            [bottom_right, road_bottom],
            [bottom_left, road_bottom]
        ], np.int32)

        cv2.fillPoly(frame, [road_pts], (60, 60, 60))

        # Center line (dashed)
        for y in range(road_top, road_bottom, 40):
            progress = (y - road_top) / (road_bottom - road_top)
            line_x = cx + int(self.position * 100 * (1 - progress))
            cv2.line(frame, (line_x, y), (line_x, min(y + 20, road_bottom)),
                     (200, 200, 200), 2)

        # Edge lines
        for y in range(road_top, road_bottom, 5):
            progress = (y - road_top) / (road_bottom - road_top)
            left_x = int(top_left + (bottom_left - top_left) * progress)
            right_x = int(top_right + (bottom_right - top_right) * progress)
            cv2.circle(frame, (left_x, y), 1, (255, 255, 255), -1)
            cv2.circle(frame, (right_x, y), 1, (255, 255, 255), -1)

        # Update position based on steering (simple simulation)
        self.position += steering * 0.02
        self.position = np.clip(self.position, -0.8, 0.8)

        # Slight drift back to center (road curvature)
        self.position *= 0.99

        return frame


def main():
    print("=" * 50)
    print("SHADOW MODE DEMO")
    print("=" * 50)
    print("\nThis demo runs WITHOUT CARLA")
    print("It tests the UI and model locally")
    print("\nControls:")
    print("  W/S or UP/DOWN   - Throttle/Brake")
    print("  A/D or LEFT/RIGHT - Steer")
    print("  ESC or Q         - Quit")
    print("=" * 50)

    # Initialize
    pygame.init()
    pygame.display.set_mode((1, 1))

    road = SyntheticRoad()
    hud = ShadowModeHUD()

    # Try to load model (will use random weights if not found)
    try:
        model = SteeringPredictor()
        use_model = True
        print("\nPilotNet model loaded (using random weights)")
    except Exception as e:
        print(f"\nCouldn't load model: {e}")
        print("Running without AI predictions")
        use_model = False

    # State
    throttle = 0.0
    steer = 0.0
    brake = 0.0
    speed = 30.0
    running = True

    fps_timer = time.time()
    frame_count = 0
    fps = 0

    print("\nStarting demo...")

    while running:
        # Process pygame events
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        # Key state
        keys = pygame.key.get_pressed()

        if keys[pygame.K_ESCAPE] or keys[pygame.K_q]:
            running = False

        # Throttle/brake
        if keys[pygame.K_w] or keys[pygame.K_UP]:
            throttle = min(1.0, throttle + 0.05)
            brake = 0.0
        elif keys[pygame.K_s] or keys[pygame.K_DOWN]:
            throttle = 0.0
            brake = min(1.0, brake + 0.1)
        else:
            throttle = max(0.0, throttle - 0.02)
            brake = max(0.0, brake - 0.05)

        # Steering
        if keys[pygame.K_a] or keys[pygame.K_LEFT]:
            steer = max(-1.0, steer - 0.06)
        elif keys[pygame.K_d] or keys[pygame.K_RIGHT]:
            steer = min(1.0, steer + 0.06)
        else:
            steer *= 0.85

        # Update speed
        speed += (throttle - brake) * 2
        speed = np.clip(speed, 0, 120)
        road.speed = speed

        # Render road
        frame = road.render(steer)

        # AI prediction
        ai_pred = None
        if use_model:
            try:
                ai_pred = model.predict(frame)
            except:
                pass

        # Telemetry
        telemetry = {
            'steer': steer,
            'throttle': throttle,
            'brake': brake,
            'speed_kmh': speed
        }

        # Render HUD
        display = hud.render_full_hud(frame, telemetry, ai_pred, False, 0)

        # FPS
        frame_count += 1
        if time.time() - fps_timer >= 1.0:
            fps = frame_count
            frame_count = 0
            fps_timer = time.time()

        cv2.putText(display, f"FPS: {fps} | DEMO MODE", (10, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)

        # Show
        cv2.imshow("Shadow Mode Demo", cv2.cvtColor(display, cv2.COLOR_RGB2BGR))

        key = cv2.waitKey(16) & 0xFF  # ~60fps
        if key == 27 or key == ord('q'):
            running = False

    cv2.destroyAllWindows()
    pygame.quit()
    print("\nDemo ended")


if __name__ == "__main__":
    main()
