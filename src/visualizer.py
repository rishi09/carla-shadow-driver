"""
Visualizer - HUD overlay for shadow mode
"""
import cv2
import numpy as np
from typing import Optional, Tuple


class ShadowModeHUD:
    """Heads-up display for shadow mode visualization."""

    def __init__(self, width: int = 640, height: int = 480):
        self.width = width
        self.height = height

        # Colors (BGR for OpenCV)
        self.HUMAN_COLOR = (0, 255, 0)      # Green
        self.AI_COLOR = (255, 100, 0)        # Blue
        self.WARNING_COLOR = (0, 165, 255)   # Orange
        self.TEXT_COLOR = (255, 255, 255)    # White
        self.BG_COLOR = (30, 30, 30)         # Dark gray

    def draw_steering_wheel(self, frame: np.ndarray, human_steer: float,
                            ai_steer: Optional[float] = None,
                            position: Tuple[int, int] = None) -> np.ndarray:
        """
        Draw steering wheel indicator.

        Args:
            frame: Input frame
            human_steer: Human steering input [-1, 1]
            ai_steer: AI steering suggestion [-1, 1]
            position: (x, y) center position, defaults to bottom center
        """
        h, w = frame.shape[:2]
        if position is None:
            position = (w // 2, h - 70)

        cx, cy = position
        radius = 50

        # Background circle
        cv2.circle(frame, (cx, cy), radius + 5, self.BG_COLOR, -1)
        cv2.circle(frame, (cx, cy), radius, (60, 60, 60), 2)

        # Center marker
        cv2.circle(frame, (cx, cy), 3, (100, 100, 100), -1)

        # Draw AI suggestion first (behind human)
        if ai_steer is not None:
            ai_rad = np.radians(ai_steer * 45)
            ai_x = int(cx + radius * 0.85 * np.sin(ai_rad))
            ai_y = int(cy - radius * 0.85 * np.cos(ai_rad))
            cv2.line(frame, (cx, cy), (ai_x, ai_y), self.AI_COLOR, 6)
            cv2.circle(frame, (ai_x, ai_y), 8, self.AI_COLOR, -1)

        # Draw human steering on top
        human_rad = np.radians(human_steer * 45)
        human_x = int(cx + radius * 0.85 * np.sin(human_rad))
        human_y = int(cy - radius * 0.85 * np.cos(human_rad))
        cv2.line(frame, (cx, cy), (human_x, human_y), self.HUMAN_COLOR, 4)
        cv2.circle(frame, (human_x, human_y), 6, self.HUMAN_COLOR, -1)

        return frame

    def draw_speedometer(self, frame: np.ndarray, speed_kmh: float,
                         position: Tuple[int, int] = None) -> np.ndarray:
        """Draw speed indicator."""
        h, w = frame.shape[:2]
        if position is None:
            position = (w - 80, h - 50)

        cx, cy = position

        # Background
        cv2.rectangle(frame, (cx - 40, cy - 30), (cx + 40, cy + 15), self.BG_COLOR, -1)

        # Speed text
        speed_text = f"{speed_kmh:.0f}"
        cv2.putText(frame, speed_text, (cx - 25, cy + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, self.TEXT_COLOR, 2)
        cv2.putText(frame, "km/h", (cx - 20, cy + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (150, 150, 150), 1)

        return frame

    def draw_throttle_brake(self, frame: np.ndarray, throttle: float, brake: float,
                            position: Tuple[int, int] = None) -> np.ndarray:
        """Draw throttle/brake indicators."""
        h, w = frame.shape[:2]
        if position is None:
            position = (80, h - 50)

        cx, cy = position
        bar_width = 15
        bar_height = 60

        # Background
        cv2.rectangle(frame, (cx - 25, cy - bar_height - 10),
                      (cx + 25, cy + 10), self.BG_COLOR, -1)

        # Throttle bar (green, left)
        throttle_h = int(bar_height * throttle)
        cv2.rectangle(frame, (cx - 20, cy - throttle_h),
                      (cx - 5, cy), (0, 200, 0), -1)
        cv2.rectangle(frame, (cx - 20, cy - bar_height),
                      (cx - 5, cy), (60, 60, 60), 1)

        # Brake bar (red, right)
        brake_h = int(bar_height * brake)
        cv2.rectangle(frame, (cx + 5, cy - brake_h),
                      (cx + 20, cy), (0, 0, 200), -1)
        cv2.rectangle(frame, (cx + 5, cy - bar_height),
                      (cx + 20, cy), (60, 60, 60), 1)

        # Labels
        cv2.putText(frame, "T", (cx - 17, cy + 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (150, 150, 150), 1)
        cv2.putText(frame, "B", (cx + 8, cy + 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.3, (150, 150, 150), 1)

        return frame

    def draw_divergence_indicator(self, frame: np.ndarray, human_steer: float,
                                  ai_steer: float, threshold: float = 0.3) -> np.ndarray:
        """Draw warning when human and AI disagree significantly."""
        h, w = frame.shape[:2]

        diff = abs(human_steer - ai_steer)

        if diff > threshold:
            # Warning banner at top
            intensity = min(1.0, diff / 0.8)
            alpha = 0.3 + 0.4 * intensity

            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (w, 40), self.WARNING_COLOR, -1)
            cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

            warning_text = f"AI suggests different steering ({ai_steer:+.2f})"
            cv2.putText(frame, warning_text, (w // 2 - 150, 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)

        return frame

    def draw_recording_indicator(self, frame: np.ndarray, is_recording: bool,
                                 frame_count: int = 0) -> np.ndarray:
        """Draw recording indicator."""
        if is_recording:
            # Red circle in top-left
            cv2.circle(frame, (25, 25), 10, (0, 0, 255), -1)
            cv2.putText(frame, f"REC {frame_count}", (40, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        return frame

    def draw_legend(self, frame: np.ndarray) -> np.ndarray:
        """Draw legend explaining colors."""
        h, w = frame.shape[:2]

        # Background
        cv2.rectangle(frame, (w - 120, 10), (w - 10, 55), self.BG_COLOR, -1)

        # Human indicator
        cv2.circle(frame, (w - 105, 25), 5, self.HUMAN_COLOR, -1)
        cv2.putText(frame, "Human", (w - 95, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, self.TEXT_COLOR, 1)

        # AI indicator
        cv2.circle(frame, (w - 105, 42), 5, self.AI_COLOR, -1)
        cv2.putText(frame, "AI", (w - 95, 45),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, self.TEXT_COLOR, 1)

        return frame

    def render_full_hud(self, frame: np.ndarray, telemetry: dict,
                        ai_prediction: Optional[dict] = None,
                        is_recording: bool = False,
                        frame_count: int = 0) -> np.ndarray:
        """Render complete HUD overlay."""
        output = frame.copy()

        human_steer = telemetry.get('steer', 0.0)
        ai_steer = ai_prediction.get('steering') if ai_prediction else None

        # Draw all HUD elements
        output = self.draw_steering_wheel(output, human_steer, ai_steer)
        output = self.draw_speedometer(output, telemetry.get('speed_kmh', 0))
        output = self.draw_throttle_brake(output, telemetry.get('throttle', 0),
                                          telemetry.get('brake', 0))
        output = self.draw_legend(output)
        output = self.draw_recording_indicator(output, is_recording, frame_count)

        if ai_steer is not None:
            output = self.draw_divergence_indicator(output, human_steer, ai_steer)

        return output
