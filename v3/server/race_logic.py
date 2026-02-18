"""
Race Logic - Checkpoints, lap times, positions, race state
"""
import time
import math
from typing import List, Tuple, Dict, Optional


class RaceState:
    """Tracks race progress for both player and AI."""

    def __init__(self, checkpoints: List[Tuple[float, float, float]], total_laps: int = 3):
        """
        Args:
            checkpoints: List of (x, y, radius) tuples defining checkpoint positions
            total_laps: Number of laps to complete the race
        """
        self.checkpoints = checkpoints
        self.total_laps = total_laps
        self.status = "countdown"  # countdown, racing, finished

        # Player state
        self.player_checkpoint = 0
        self.player_lap = 0
        self.player_lap_times: List[float] = []
        self.player_lap_start: Optional[float] = None
        self.player_best_lap: Optional[float] = None
        self.player_finished = False
        self.player_finish_time: Optional[float] = None

        # AI state
        self.ai_checkpoint = 0
        self.ai_lap = 0
        self.ai_lap_times: List[float] = []
        self.ai_lap_start: Optional[float] = None
        self.ai_best_lap: Optional[float] = None
        self.ai_finished = False
        self.ai_finish_time: Optional[float] = None

        # Current positions (for minimap)
        self.player_x: float = 0.0
        self.player_y: float = 0.0
        self.ai_x: float = 0.0
        self.ai_y: float = 0.0

        # Race timing
        self.race_start_time: Optional[float] = None
        self.countdown_start: Optional[float] = None
        self.winner: Optional[str] = None

    def start_countdown(self):
        """Begin 3-second countdown."""
        self.countdown_start = time.time()
        self.status = "countdown"

    def start_race(self):
        """Start the race (after countdown)."""
        now = time.time()
        self.race_start_time = now
        self.player_lap_start = now
        self.ai_lap_start = now
        self.status = "racing"

    def get_countdown(self) -> Optional[int]:
        """Get countdown number (3, 2, 1, 0=GO). None if not in countdown."""
        if self.status != "countdown" or self.countdown_start is None:
            return None
        elapsed = time.time() - self.countdown_start
        if elapsed >= 3.0:
            return 0  # GO!
        return 3 - int(elapsed)

    def _check_checkpoint(self, pos_x: float, pos_y: float,
                          current_checkpoint: int) -> bool:
        """Check if position is within the next checkpoint's radius."""
        if current_checkpoint >= len(self.checkpoints):
            return False

        cx, cy, radius = self.checkpoints[current_checkpoint]
        dist = math.sqrt((pos_x - cx) ** 2 + (pos_y - cy) ** 2)
        return dist <= radius

    def update_player(self, x: float, y: float, speed_kmh: float):
        """Update player position and check checkpoints."""
        self.player_x = x
        self.player_y = y
        if self.status != "racing" or self.player_finished:
            return

        next_cp = self.player_checkpoint % len(self.checkpoints)
        if self._check_checkpoint(x, y, next_cp):
            self.player_checkpoint += 1

            # Check if completed a lap
            if self.player_checkpoint % len(self.checkpoints) == 0 and self.player_checkpoint > 0:
                now = time.time()
                lap_time = now - self.player_lap_start
                self.player_lap_times.append(lap_time)
                self.player_lap += 1
                self.player_lap_start = now

                if self.player_best_lap is None or lap_time < self.player_best_lap:
                    self.player_best_lap = lap_time

                # Check if race finished
                if self.player_lap >= self.total_laps:
                    self.player_finished = True
                    self.player_finish_time = now - self.race_start_time
                    if not self.ai_finished:
                        self.winner = "player"
                        self.status = "finished"

    def update_ai(self, x: float, y: float, speed_kmh: float):
        """Update AI position and check checkpoints."""
        self.ai_x = x
        self.ai_y = y
        if self.status != "racing" or self.ai_finished:
            return

        next_cp = self.ai_checkpoint % len(self.checkpoints)
        if self._check_checkpoint(x, y, next_cp):
            self.ai_checkpoint += 1

            # Check if completed a lap
            if self.ai_checkpoint % len(self.checkpoints) == 0 and self.ai_checkpoint > 0:
                now = time.time()
                lap_time = now - self.ai_lap_start
                self.ai_lap_times.append(lap_time)
                self.ai_lap += 1
                self.ai_lap_start = now

                if self.ai_best_lap is None or lap_time < self.ai_best_lap:
                    self.ai_best_lap = lap_time

                # Check if race finished
                if self.ai_lap >= self.total_laps:
                    self.ai_finished = True
                    self.ai_finish_time = now - self.race_start_time
                    if not self.player_finished:
                        self.winner = "ai"
                        self.status = "finished"

    def get_current_lap_time(self, who: str) -> float:
        """Get current (in-progress) lap time."""
        if self.status != "racing":
            return 0.0
        start = self.player_lap_start if who == "player" else self.ai_lap_start
        if start is None:
            return 0.0
        return time.time() - start

    def get_position(self) -> Dict[str, int]:
        """Determine who's in 1st and 2nd place."""
        player_progress = self.player_lap * len(self.checkpoints) + (self.player_checkpoint % len(self.checkpoints))
        ai_progress = self.ai_lap * len(self.checkpoints) + (self.ai_checkpoint % len(self.checkpoints))

        if player_progress >= ai_progress:
            return {"player": 1, "ai": 2}
        else:
            return {"player": 2, "ai": 1}

    def get_gap_seconds(self) -> Optional[float]:
        """Get time gap between player and AI. Positive = player ahead."""
        if self.status != "racing":
            return None
        # Compare current lap times at similar progress points
        player_time = self.get_current_lap_time("player")
        ai_time = self.get_current_lap_time("ai")
        player_cp = self.player_checkpoint % len(self.checkpoints)
        ai_cp = self.ai_checkpoint % len(self.checkpoints)

        # If on different laps, the gap is large
        if self.player_lap != self.ai_lap:
            lap_diff = self.player_lap - self.ai_lap
            avg_lap = 45.0  # Estimate average lap time
            if self.player_lap_times:
                avg_lap = sum(self.player_lap_times) / len(self.player_lap_times)
            return lap_diff * avg_lap

        # Same lap: estimate gap from checkpoint difference
        if player_cp != ai_cp:
            cp_diff = player_cp - ai_cp
            avg_cp_time = player_time / max(player_cp, 1) if player_cp > 0 else 3.0
            return cp_diff * avg_cp_time

        # Same checkpoint: compare current lap times
        return ai_time - player_time

    def to_dict(self) -> Dict:
        """Serialize race state for WebSocket transmission."""
        positions = self.get_position()
        return {
            "player": {
                "speed_kmh": 0,  # Filled in by caller
                "lap": self.player_lap + 1,  # 1-indexed for display
                "total_laps": self.total_laps,
                "checkpoint": self.player_checkpoint % len(self.checkpoints),
                "lap_time": round(self.get_current_lap_time("player"), 1),
                "best_lap": round(self.player_best_lap, 1) if self.player_best_lap else None,
                "position": positions["player"],
                "finished": self.player_finished,
                "x": round(self.player_x, 1),
                "y": round(self.player_y, 1),
            },
            "ai": {
                "speed_kmh": 0,  # Filled in by caller
                "lap": self.ai_lap + 1,
                "total_laps": self.total_laps,
                "checkpoint": self.ai_checkpoint % len(self.checkpoints),
                "lap_time": round(self.get_current_lap_time("ai"), 1),
                "best_lap": round(self.ai_best_lap, 1) if self.ai_best_lap else None,
                "position": positions["ai"],
                "finished": self.ai_finished,
                "x": round(self.ai_x, 1),
                "y": round(self.ai_y, 1),
            },
            "race_status": self.status,
            "winner": self.winner,
            "countdown": self.get_countdown(),
            "checkpoints": [{"x": round(cx, 1), "y": round(cy, 1)} for cx, cy, _ in self.checkpoints],
        }


def generate_checkpoints_from_waypoints(world, num_checkpoints: int = 10,
                                         radius: float = 15.0) -> List[Tuple[float, float, float]]:
    """Generate checkpoints from CARLA map waypoints."""
    carla_map = world.get_map()
    waypoints = carla_map.generate_waypoints(50.0)  # Every 50 meters

    if not waypoints:
        return []

    # Sample evenly spaced waypoints
    step = max(1, len(waypoints) // num_checkpoints)
    selected = waypoints[::step][:num_checkpoints]

    checkpoints = []
    for wp in selected:
        loc = wp.transform.location
        checkpoints.append((loc.x, loc.y, radius))

    return checkpoints
