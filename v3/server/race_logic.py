"""
Race Logic - Checkpoints, lap times, positions, race state
"""
import time
import math
import random
from typing import List, Tuple, Dict, Optional


class DriftDetector:
    """Detects drifting by comparing vehicle heading vs velocity direction.

    A drift occurs when:
      - The angle between heading and velocity direction exceeds a threshold
      - The car is moving fast enough (>30 km/h)
      - Steering input is applied

    Scoring:
      drift_score = drift_angle_deg * speed_kmh * duration_seconds * chain_multiplier
    """

    MIN_SPEED_KMH = 30.0
    MIN_DRIFT_ANGLE_DEG = 8.0   # Minimum angle to count as drifting
    MAX_DRIFT_ANGLE_DEG = 90.0  # Cap angle contribution
    CHAIN_TIMEOUT = 2.0          # Seconds between drifts to keep chain alive

    def __init__(self):
        self.is_drifting = False
        self.drift_start_time: float = 0.0
        self.current_drift_score: float = 0.0
        self.current_drift_angle: float = 0.0
        self.chain_multiplier: int = 1
        self.last_drift_end_time: float = 0.0
        self.total_drift_score: float = 0.0
        self.best_single_drift: float = 0.0
        self.drift_count: int = 0
        self._pending_drift_end: Optional[Dict] = None

    def update(self, heading_deg: float, velocity_x: float, velocity_y: float,
               speed_kmh: float, steer: float) -> Optional[Dict]:
        """Update drift state. Returns a drift event dict if state changed.

        Args:
            heading_deg: Vehicle yaw in degrees
            velocity_x, velocity_y: World-space velocity components
            speed_kmh: Current speed
            steer: Current steering input [-1, 1]

        Returns:
            Dict with drift state info, or None if no change.
        """
        now = time.time()

        # Calculate the angle between heading and velocity direction
        if speed_kmh < self.MIN_SPEED_KMH:
            drift_angle = 0.0
        else:
            vel_angle_deg = math.degrees(math.atan2(velocity_y, velocity_x))
            # Compute smallest angle difference
            angle_diff = heading_deg - vel_angle_deg
            # Normalize to [-180, 180]
            while angle_diff > 180:
                angle_diff -= 360
            while angle_diff < -180:
                angle_diff += 360
            drift_angle = abs(angle_diff)

        # Check if currently drifting
        is_now_drifting = (
            drift_angle >= self.MIN_DRIFT_ANGLE_DEG
            and speed_kmh >= self.MIN_SPEED_KMH
            and abs(steer) > 0.05
        )

        result = None

        if is_now_drifting and not self.is_drifting:
            # Drift started
            self.is_drifting = True
            self.drift_start_time = now
            self.current_drift_score = 0.0
            self.current_drift_angle = drift_angle

            # Check chain: if last drift ended recently, increase multiplier
            if now - self.last_drift_end_time < self.CHAIN_TIMEOUT and self.last_drift_end_time > 0:
                self.chain_multiplier = min(5, self.chain_multiplier + 1)
            else:
                self.chain_multiplier = 1

            result = {
                'event': 'drift_start',
                'chain_multiplier': self.chain_multiplier,
            }

        elif is_now_drifting and self.is_drifting:
            # Drift continuing - accumulate score
            dt = 1.0 / 30.0  # Frame delta
            capped_angle = min(drift_angle, self.MAX_DRIFT_ANGLE_DEG)
            # Score per frame: angle * speed * dt * multiplier, scaled down
            frame_score = (capped_angle * speed_kmh * dt * self.chain_multiplier) / 100.0
            self.current_drift_score += frame_score
            self.current_drift_angle = drift_angle

            result = {
                'event': 'drift_update',
                'score': round(self.current_drift_score),
                'angle': round(drift_angle, 1),
                'chain_multiplier': self.chain_multiplier,
                'duration': round(now - self.drift_start_time, 1),
            }

        elif not is_now_drifting and self.is_drifting:
            # Drift ended
            self.is_drifting = False
            self.last_drift_end_time = now
            self.drift_count += 1
            final_score = round(self.current_drift_score)
            self.total_drift_score += final_score
            if final_score > self.best_single_drift:
                self.best_single_drift = final_score

            result = {
                'event': 'drift_end',
                'score': final_score,
                'chain_multiplier': self.chain_multiplier,
                'total_score': round(self.total_drift_score),
            }
            self.current_drift_score = 0.0

        return result

    def get_stats(self) -> Dict:
        """Return drift statistics for post-race results."""
        return {
            'total_drift_score': round(self.total_drift_score),
            'best_single_drift': round(self.best_single_drift),
            'drift_count': self.drift_count,
        }


class RaceCommentary:
    """Generates contextual commentary messages during a race.

    Monitors race events and produces text commentary with appropriate
    timing to avoid spamming the player.
    """

    COOLDOWN = 4.0  # Minimum seconds between messages

    def __init__(self):
        self._last_message_time: float = 0.0
        self._pending_messages: List[Dict] = []
        self._last_gap: Optional[float] = None
        self._last_position: Optional[int] = None
        self._start_notified = False
        self._overtake_notified_at: float = 0.0
        self._last_lap_notified: bool = False
        self._collision_count_at_last_msg: int = 0
        self._best_lap_notified_for: Optional[float] = None
        self._close_finish_notified: bool = False

    def _queue(self, text: str, category: str, priority: int = 0):
        """Queue a commentary message. Higher priority = shown first."""
        self._pending_messages.append({
            'text': text,
            'category': category,
            'priority': priority,
            'time': time.time(),
        })
        # Sort by priority descending
        self._pending_messages.sort(key=lambda m: -m['priority'])

    def update(self, race_state: 'RaceState', collision_count: int,
               drift_score: float = 0, drift_event: Optional[Dict] = None) -> Optional[Dict]:
        """Check race events and return a commentary message if appropriate.

        Returns:
            Dict with 'text' and 'category', or None.
        """
        now = time.time()

        # Don't send messages during countdown
        if race_state.status != "racing":
            return None

        gap = race_state.get_gap_seconds()
        position = race_state.get_position()
        player_pos = position.get('player', 1)

        # --- Race start ---
        if not self._start_notified and race_state.race_start_time:
            elapsed = now - race_state.race_start_time
            if elapsed > 1.5 and elapsed < 5.0:
                self._start_notified = True
                if gap is not None and gap > 0.5:
                    self._queue("Great start! You're pulling ahead!", 'positive', 3)
                elif gap is not None and gap < -0.5:
                    self._queue("The AI got the better launch!", 'warning', 3)
                else:
                    self._queue("Side by side off the line!", 'info', 3)

        # --- Position change (overtake) ---
        if self._last_position is not None and player_pos != self._last_position:
            if now - self._overtake_notified_at > 8.0:
                self._overtake_notified_at = now
                if player_pos < self._last_position:
                    self._queue("Overtake! You take the lead!", 'positive', 5)
                else:
                    self._queue("The AI takes the lead!", 'warning', 5)
        self._last_position = player_pos

        # --- Gap commentary ---
        if gap is not None and self._last_gap is not None:
            # AI closing in
            if self._last_gap > 2.0 and gap < 1.5 and gap > 0:
                self._queue("The AI is closing in...", 'warning', 2)
            # Player pulling away
            elif self._last_gap < 1.5 and gap > 3.0:
                self._queue("You're building a gap! Keep pushing!", 'positive', 2)
            # Massive lead
            elif gap > 8.0 and self._last_gap < 8.0:
                self._queue("Dominant lead! The AI can't keep up!", 'positive', 1)
        self._last_gap = gap

        # --- Collision ---
        if collision_count > self._collision_count_at_last_msg:
            new_collisions = collision_count - self._collision_count_at_last_msg
            self._collision_count_at_last_msg = collision_count
            if new_collisions >= 1:
                msgs = [
                    "Impact! Keep it clean!",
                    "Ouch! That's going to cost you!",
                    "Big hit! Try to stay on track!",
                    "Contact! Watch the walls!",
                ]
                self._queue(random.choice(msgs), 'collision', 4)

        # --- Best lap ---
        if race_state.player_best_lap is not None:
            if self._best_lap_notified_for != race_state.player_best_lap:
                if self._best_lap_notified_for is not None:
                    # New personal best (not the first lap)
                    self._queue("New personal best lap!", 'positive', 6)
                self._best_lap_notified_for = race_state.player_best_lap

        # --- Final lap ---
        if (race_state.player_lap == race_state.total_laps - 1
                and not self._last_lap_notified):
            self._last_lap_notified = True
            self._queue("Final lap! Give it everything!", 'critical', 7)

        # --- Drift commentary ---
        if drift_event and drift_event.get('event') == 'drift_end':
            score = drift_event.get('score', 0)
            chain = drift_event.get('chain_multiplier', 1)
            if score > 500:
                self._queue(f"INCREDIBLE drift! {score} points!", 'drift', 5)
            elif score > 200:
                if chain > 1:
                    self._queue(f"Drift chain x{chain}! {score} points!", 'drift', 4)
                else:
                    self._queue(f"Nice drift! {score} points!", 'drift', 3)

        # --- Close finish ---
        if (race_state.player_lap >= race_state.total_laps - 1
                and gap is not None and abs(gap) < 2.0
                and not self._close_finish_notified):
            self._close_finish_notified = True
            self._queue("Photo finish! It's going to be close!", 'critical', 8)

        # --- Emit one message if cooldown has passed ---
        if self._pending_messages and now - self._last_message_time >= self.COOLDOWN:
            msg = self._pending_messages.pop(0)
            self._last_message_time = now
            return {'text': msg['text'], 'category': msg['category']}

        return None


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

        # Statistics tracking
        self.player_max_speed: float = 0.0
        self.ai_max_speed: float = 0.0
        self.player_total_distance: float = 0.0
        self.ai_total_distance: float = 0.0
        self.player_collisions_count: int = 0
        self._player_prev_x: Optional[float] = None
        self._player_prev_y: Optional[float] = None
        self._ai_prev_x: Optional[float] = None
        self._ai_prev_y: Optional[float] = None

        # Ghost replay recording
        self._player_recording: List[Dict] = []  # all recorded positions across laps
        self._current_lap_recording: List[Dict] = []
        self._best_lap_recording: List[Dict] = []

        # Path recording (every 5th frame to keep data manageable)
        self._player_path: List[Tuple[float, float]] = []
        self._ai_path: List[Tuple[float, float]] = []
        self._path_frame_counter: int = 0

        # Race timing
        self.race_start_time: Optional[float] = None
        self.countdown_start: Optional[float] = None
        self.winner: Optional[str] = None

        # Drift detection
        self.drift_detector = DriftDetector()

        # Commentary system
        self.commentary = RaceCommentary()

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

    def record_player_position(self, x: float, y: float, yaw: float, lap_time: float):
        """Record the player's position for ghost replay during the current lap."""
        frame = {
            'x': x,
            'y': y,
            'yaw': yaw,
            'time_in_lap': lap_time,
        }
        self._current_lap_recording.append(frame)
        self._player_recording.append(frame)

    def get_ghost_position(self, time_in_current_lap: float) -> Optional[Dict]:
        """Look up the ghost car position at the given lap time.

        Uses linear interpolation between the two nearest recorded frames
        in the best lap recording.

        Returns:
            Dict with 'x', 'y', 'yaw' or None if no recording exists.
        """
        if not self._best_lap_recording:
            return None

        recording = self._best_lap_recording

        # If before the first recorded frame, return the first position
        if time_in_current_lap <= recording[0]['time_in_lap']:
            f = recording[0]
            return {'x': f['x'], 'y': f['y'], 'yaw': f['yaw']}

        # If past the last recorded frame, return the last position
        if time_in_current_lap >= recording[-1]['time_in_lap']:
            f = recording[-1]
            return {'x': f['x'], 'y': f['y'], 'yaw': f['yaw']}

        # Binary search for the interval containing time_in_current_lap
        lo, hi = 0, len(recording) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if recording[mid]['time_in_lap'] <= time_in_current_lap:
                lo = mid
            else:
                hi = mid

        # Linear interpolation between recording[lo] and recording[hi]
        f0 = recording[lo]
        f1 = recording[hi]
        dt = f1['time_in_lap'] - f0['time_in_lap']
        if dt <= 0:
            return {'x': f0['x'], 'y': f0['y'], 'yaw': f0['yaw']}

        t = (time_in_current_lap - f0['time_in_lap']) / dt
        return {
            'x': f0['x'] + (f1['x'] - f0['x']) * t,
            'y': f0['y'] + (f1['y'] - f0['y']) * t,
            'yaw': f0['yaw'] + (f1['yaw'] - f0['yaw']) * t,
        }

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

    def report_player_collision(self):
        """Increment the player collision counter."""
        self.player_collisions_count += 1

    def update_drift(self, heading_deg: float, velocity_x: float, velocity_y: float,
                      speed_kmh: float, steer: float) -> Optional[Dict]:
        """Update drift detection with current vehicle state.

        Returns a drift event dict if the drift state changed, or None.
        """
        return self.drift_detector.update(heading_deg, velocity_x, velocity_y,
                                          speed_kmh, steer)

    def get_commentary(self, drift_event: Optional[Dict] = None) -> Optional[Dict]:
        """Get the next commentary message based on race events.

        Returns:
            Dict with 'text' and 'category', or None.
        """
        return self.commentary.update(
            self,
            self.player_collisions_count,
            drift_score=self.drift_detector.total_drift_score,
            drift_event=drift_event,
        )

    def get_stats(self) -> Dict:
        """Return accumulated race statistics."""
        drift_stats = self.drift_detector.get_stats()
        return {
            'player_max_speed': round(self.player_max_speed, 1),
            'ai_max_speed': round(self.ai_max_speed, 1),
            'player_distance': round(self.player_total_distance, 1),
            'ai_distance': round(self.ai_total_distance, 1),
            'player_collisions': self.player_collisions_count,
            'total_drift_score': drift_stats['total_drift_score'],
            'best_single_drift': drift_stats['best_single_drift'],
            'drift_count': drift_stats['drift_count'],
        }

    def update_player(self, x: float, y: float, speed_kmh: float):
        """Update player position and check checkpoints."""
        self.player_x = x
        self.player_y = y
        if self.status != "racing" or self.player_finished:
            return

        # Track max speed
        if speed_kmh > self.player_max_speed:
            self.player_max_speed = speed_kmh

        # Track distance traveled
        if self._player_prev_x is not None and self._player_prev_y is not None:
            dx = x - self._player_prev_x
            dy = y - self._player_prev_y
            self.player_total_distance += math.sqrt(dx * dx + dy * dy)
        self._player_prev_x = x
        self._player_prev_y = y

        # Record path every 5th frame
        self._path_frame_counter += 1
        if self._path_frame_counter % 5 == 0:
            self._player_path.append((round(x, 1), round(y, 1)))
            self._ai_path.append((round(self.ai_x, 1), round(self.ai_y, 1)))

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
                    # Save this lap's recording as the best ghost replay
                    self._best_lap_recording = list(self._current_lap_recording)

                # Start a new recording for the next lap
                self._current_lap_recording = []

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

        # Track max speed
        if speed_kmh > self.ai_max_speed:
            self.ai_max_speed = speed_kmh

        # Track distance traveled
        if self._ai_prev_x is not None and self._ai_prev_y is not None:
            dx = x - self._ai_prev_x
            dy = y - self._ai_prev_y
            self.ai_total_distance += math.sqrt(dx * dx + dy * dy)
        self._ai_prev_x = x
        self._ai_prev_y = y

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

    def get_paths(self) -> Dict:
        """Return recorded paths for both cars."""
        return {
            'player': [[x, y] for x, y in self._player_path],
            'ai': [[x, y] for x, y in self._ai_path],
        }

    def to_dict(self) -> Dict:
        """Serialize race state for WebSocket transmission."""
        positions = self.get_position()
        current_lap_time = self.get_current_lap_time("player")
        ghost_pos = self.get_ghost_position(current_lap_time)

        result = {
            "player": {
                "speed_kmh": 0,  # Filled in by caller
                "lap": self.player_lap + 1,  # 1-indexed for display
                "total_laps": self.total_laps,
                "checkpoint": self.player_checkpoint % len(self.checkpoints),
                "total_checkpoints": len(self.checkpoints),
                "lap_time": round(self.get_current_lap_time("player"), 1),
                "best_lap": round(self.player_best_lap, 1) if self.player_best_lap else None,
                "position": positions["player"],
                "finished": self.player_finished,
                "x": round(self.player_x, 1),
                "y": round(self.player_y, 1),
                "next_checkpoint_x": round(self.checkpoints[self.player_checkpoint % len(self.checkpoints)][0], 1),
                "next_checkpoint_y": round(self.checkpoints[self.player_checkpoint % len(self.checkpoints)][1], 1),
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

        if ghost_pos is not None:
            result["ghost"] = {
                "x": round(ghost_pos['x'], 1),
                "y": round(ghost_pos['y'], 1),
                "yaw": round(ghost_pos['yaw'], 1),
            }

        return result


class RaceDirector:
    """Monitors race gap and dynamically adjusts AI speed to keep races close.

    Uses both distance-based rubber banding (primary, based on 50m threshold)
    and time-based gap tightening in the final stretch for drama.
    """

    # Distance threshold in meters for rubber banding
    RUBBER_BAND_DISTANCE = 50.0

    def __init__(self, difficulty: str = 'medium'):
        self.difficulty = difficulty

        # How strongly rubber banding affects AI speed per difficulty.
        # Higher = stronger pull back toward the player.
        # The value is the max speed_difference adjustment in percentage points.
        self._rubber_band_strength = {
            'easy':   25.0,   # Strong: AI slows a lot when ahead, speeds up a lot when behind
            'medium': 12.0,   # Moderate
            'hard':    5.0,   # Minimal: AI barely adjusts
        }

        # How quickly the adjustment ramps per meter beyond the threshold.
        # Units: percentage points of speed_difference per meter of excess distance.
        self._ramp_per_meter = {
            'easy':   0.5,    # Reaches max adjustment at ~50m beyond threshold
            'medium': 0.3,
            'hard':   0.15,
        }

        self._smoothed_modifier = 0.0  # Smoothed speed modifier (0 = no change)
        self._update_interval = 2.5    # Update every 2.5 seconds (TM calls are expensive)
        self._last_update = 0.0

    def _compute_distance(self, race_state: 'RaceState') -> float:
        """Compute Euclidean distance between player and AI cars."""
        dx = race_state.player_x - race_state.ai_x
        dy = race_state.player_y - race_state.ai_y
        return math.sqrt(dx * dx + dy * dy)

    def _who_is_ahead(self, race_state: 'RaceState') -> str:
        """Return 'player' or 'ai' based on checkpoint/lap progress."""
        player_progress = (race_state.player_lap * len(race_state.checkpoints)
                           + (race_state.player_checkpoint % len(race_state.checkpoints)))
        ai_progress = (race_state.ai_lap * len(race_state.checkpoints)
                       + (race_state.ai_checkpoint % len(race_state.checkpoints)))
        return 'player' if player_progress >= ai_progress else 'ai'

    def get_speed_adjustment(self, gap_seconds: float, race_progress: float,
                             current_time: float,
                             race_state: 'RaceState' = None) -> float:
        """Returns speed difference adjustment for the AI car.

        Uses distance-based rubber banding when race_state is provided.
        Falls back to time-based gap when race_state is None.

        Args:
            gap_seconds: positive = player ahead, negative = AI ahead (used as fallback)
            race_progress: 0.0 to 1.0
            current_time: current time.time()
            race_state: RaceState for distance-based rubber banding

        Returns:
            Adjustment to add to the base speed_difference
            (positive = AI slower, negative = AI faster)
        """
        # Only update every _update_interval seconds for smooth changes
        if current_time - self._last_update < self._update_interval:
            return self._smoothed_modifier
        self._last_update = current_time

        max_adj = self._rubber_band_strength.get(self.difficulty, 12.0)
        ramp = self._ramp_per_meter.get(self.difficulty, 0.3)

        # --- Distance-based rubber banding (primary) ---
        if race_state is not None:
            distance = self._compute_distance(race_state)
            leader = self._who_is_ahead(race_state)

            if distance > self.RUBBER_BAND_DISTANCE:
                excess = distance - self.RUBBER_BAND_DISTANCE
                raw_adj = min(excess * ramp, max_adj)

                if leader == 'ai':
                    # AI is ahead and far away: slow it down
                    target_modifier = raw_adj
                else:
                    # Player is ahead and far away: speed up AI
                    target_modifier = -raw_adj
            else:
                # Within 50m: use base difficulty setting (no adjustment)
                target_modifier = 0.0
        else:
            # Fallback: time-based gap (legacy behavior)
            if gap_seconds is None:
                target_modifier = 0.0
            elif gap_seconds > 3.0:
                # Player far ahead: speed up AI
                excess = gap_seconds - 3.0
                raw = min(excess * 3.0, max_adj)
                target_modifier = -raw
            elif gap_seconds < -3.0:
                # AI far ahead: slow it down
                excess = abs(gap_seconds) - 3.0
                raw = min(excess * 3.0, max_adj)
                target_modifier = raw
            else:
                target_modifier = 0.0

        # Tighten rubber banding in final 25% of race for drama
        if race_progress > 0.75:
            intensity = (race_progress - 0.75) / 0.25  # 0..1
            # Amplify the existing adjustment by up to 40%
            target_modifier *= (1.0 + intensity * 0.4)
            # Clamp back to max
            target_modifier = max(-max_adj, min(max_adj, target_modifier))

        # Smooth the adjustment (exponential moving average)
        # ~30% blend per update means it takes ~3 updates (~7.5s) to converge
        self._smoothed_modifier += (target_modifier - self._smoothed_modifier) * 0.3

        return self._smoothed_modifier

    def get_race_progress(self, race_state: 'RaceState') -> float:
        """Calculate overall race progress (0.0 to 1.0)."""
        total_cps = race_state.total_laps * len(race_state.checkpoints)
        if total_cps == 0:
            return 0.0
        leader_progress = max(
            race_state.player_lap * len(race_state.checkpoints) + (race_state.player_checkpoint % len(race_state.checkpoints)),
            race_state.ai_lap * len(race_state.checkpoints) + (race_state.ai_checkpoint % len(race_state.checkpoints)),
        )
        return min(1.0, leader_progress / total_cps)


class AIMistakeGenerator:
    """Periodically introduces controlled mistakes into AI driving.

    On Easy difficulty, the AI makes frequent, noticeable mistakes:
    - Every 10-15 seconds, temporarily increases speed_difference by 20-30%
      for 2-3 seconds, simulating late braking or hesitation.
    - Intervals are randomized so mistakes feel natural.

    On Medium, mistakes are less frequent and smaller.
    On Hard, mistakes are rare and barely noticeable.
    """

    def __init__(self, difficulty: str = 'medium'):
        self.difficulty = difficulty

        # Base interval between mistakes (seconds)
        self._base_intervals = {
            'easy': 12.0,    # Every 10-15s (with jitter)
            'medium': 25.0,  # Every ~20-30s
            'hard': 60.0,    # Rarely
        }

        # Mistake definitions per difficulty
        self._mistake_pools = {
            'easy': [
                # Late braking: significant slowdown, simulates braking too early before turns
                {'speed_penalty': 25.0, 'duration': 2.5, 'type': 'late_brake'},
                {'speed_penalty': 30.0, 'duration': 2.0, 'type': 'late_brake'},
                # Hesitation: moderate slowdown, simulates indecision
                {'speed_penalty': 20.0, 'duration': 3.0, 'type': 'hesitation'},
                # Wide exit: slight slowdown for longer duration
                {'speed_penalty': 22.0, 'duration': 2.8, 'type': 'wide_exit'},
            ],
            'medium': [
                {'speed_penalty': 12.0, 'duration': 1.5, 'type': 'late_brake'},
                {'speed_penalty': 15.0, 'duration': 1.2, 'type': 'hesitation'},
                {'speed_penalty': 10.0, 'duration': 2.0, 'type': 'wide_exit'},
            ],
            'hard': [
                {'speed_penalty': 5.0, 'duration': 1.0, 'type': 'minor_wobble'},
                {'speed_penalty': 8.0, 'duration': 0.8, 'type': 'late_brake'},
            ],
        }

        self._last_mistake_time = 0.0
        self._active_mistake = None
        self._mistake_end_time = 0.0

    def update(self, current_time: float, gap_seconds: float) -> dict | None:
        """Check if AI should make a mistake. Returns mistake dict or None.

        Returns dict with keys:
            'speed_penalty': percentage points to add to speed_difference (positive = slower)
            'duration': seconds the mistake lasts
            'type': string describing the mistake
        """
        import random

        # If a mistake is currently active, return it until it expires
        if self._active_mistake and current_time < self._mistake_end_time:
            return self._active_mistake
        elif self._active_mistake and current_time >= self._mistake_end_time:
            self._active_mistake = None
            return None  # Signal that mistake just ended (caller resets speed)

        # Check if it's time for a new mistake
        interval = self._base_intervals.get(self.difficulty, 25.0)

        # More mistakes when AI is ahead (gives player catch-up chances)
        if gap_seconds is not None:
            if gap_seconds < -2.0:
                interval *= 0.6   # More frequent when AI is leading
            elif gap_seconds > 3.0:
                interval *= 1.8   # Less frequent when player is leading

        # Add randomness: +/- 25% for Easy (10-15s range), +/- 30% for others
        if self.difficulty == 'easy':
            jittered_interval = interval * (0.83 + random.random() * 0.42)  # ~10-15s
        else:
            jittered_interval = interval * (0.7 + random.random() * 0.6)

        if current_time - self._last_mistake_time < jittered_interval:
            return None

        # Generate a mistake from the difficulty-specific pool
        self._last_mistake_time = current_time

        pool = self._mistake_pools.get(self.difficulty, self._mistake_pools['medium'])
        mistake = dict(random.choice(pool))  # Copy so we don't mutate the template

        self._active_mistake = mistake
        self._mistake_end_time = current_time + mistake['duration']

        return mistake


def generate_checkpoints_from_waypoints(world, num_checkpoints: int = 10,
                                         radius: float = 15.0,
                                         start_location=None) -> List[Tuple[float, float, float]]:
    """Generate checkpoints that form a circuit starting from the player's spawn point.

    Follows the road forward from the start location, collecting waypoints
    until the route loops back near the start or we've gone far enough.
    """
    carla_map = world.get_map()

    # Get starting waypoint
    if start_location is not None:
        start_wp = carla_map.get_waypoint(start_location)
    else:
        spawn_points = carla_map.get_spawn_points()
        if not spawn_points:
            return []
        start_wp = carla_map.get_waypoint(spawn_points[0].location)

    if start_wp is None:
        return []

    # Follow the road forward, collecting waypoints every ~80 meters
    route_waypoints = []
    current_wp = start_wp
    visited_roads = set()
    max_waypoints = num_checkpoints * 8  # Collect more than needed, then sample

    for _ in range(max_waypoints * 10):  # Safety limit
        next_wps = current_wp.next(20.0)  # Step 20m forward
        if not next_wps:
            break

        # Prefer going straight / following the main road
        best_wp = next_wps[0]
        for wp in next_wps:
            # Prefer same road_id to stay on the main road
            if wp.road_id == current_wp.road_id:
                best_wp = wp
                break

        current_wp = best_wp
        road_key = (current_wp.road_id, current_wp.lane_id, current_wp.section_id)

        if road_key not in visited_roads:
            route_waypoints.append(current_wp)
            visited_roads.add(road_key)

        # Check if we've looped back near the start
        if len(route_waypoints) > num_checkpoints:
            dist_to_start = math.sqrt(
                (current_wp.transform.location.x - start_wp.transform.location.x) ** 2 +
                (current_wp.transform.location.y - start_wp.transform.location.y) ** 2
            )
            if dist_to_start < 50.0:
                break

        if len(route_waypoints) >= max_waypoints:
            break

    if len(route_waypoints) < num_checkpoints:
        # Fallback: use what we have
        selected = route_waypoints
    else:
        # Sample evenly from the route
        step = max(1, len(route_waypoints) // num_checkpoints)
        selected = route_waypoints[::step][:num_checkpoints]

    checkpoints = []
    for wp in selected:
        loc = wp.transform.location
        checkpoints.append((loc.x, loc.y, radius))

    print(f"Generated {len(checkpoints)} checkpoints along {len(route_waypoints)} road waypoints")
    return checkpoints
