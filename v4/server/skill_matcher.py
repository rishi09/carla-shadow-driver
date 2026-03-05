"""
Skill Matcher - Adaptive AI that adjusts difficulty based on player skill.

Invisible to the player. Complements (does not replace) the explicit
Easy/Medium/Hard difficulty selector. Works on top of the existing
RaceDirector rubber-banding and AIPersonality emotion systems.

Design principles:
  1. Never feel punitive: if a player gets better, the AI gets faster
     but never so fast that the player loses immediately. The adaptation
     always makes the race MORE competitive, not less fun.
  2. Smooth transitions: exponential moving average (alpha=0.1) prevents
     jarring jumps in AI behavior.
  3. Invisible: no UI indicators. The player should feel like the AI is
     "just the right level of challenging" without knowing why.
  4. Complementary: the skill score modifies the AI parameters RELATIVE
     to the chosen difficulty, not in absolute terms. Easy mode with a
     high-skill player is still easier than Hard mode.

Metrics tracked (rolling 30-second windows):
  - Average speed (km/h)
  - Lap time consistency (variance between consecutive laps)
  - Collision rate (collisions per 30s)
  - Checkpoint efficiency (average time between checkpoints)
  - Drift score accumulation rate (points per 30s)

Output: AI parameter overrides applied via traffic manager:
  - speed_factor: 0.85 (low skill) to 1.15 (high skill)
  - mistake_chance: 0.20 (low skill) to 0.02 (high skill)
  - cornering_quality: 0.7 (low skill, wide/sloppy) to 1.0 (high skill, tight/clean)
"""
import time
import math
from collections import deque
from typing import Dict, Optional


class SkillMatcher:
    """Tracks player skill in real-time and maps it to AI parameter adjustments.

    Usage:
        matcher = SkillMatcher(difficulty='easy')
        # Each tick:
        matcher.record_speed(speed_kmh)
        matcher.record_collision()           # on collision event
        matcher.record_checkpoint(time_sec)  # on checkpoint hit
        matcher.record_drift_score(score)    # on drift end
        matcher.record_lap_time(lap_time)    # on lap completion
        # Every tick (but internally throttled to 30s):
        matcher.update()
        # Apply:
        adjustments = matcher.get_adjustments()
    """

    # How often to recompute the skill score (seconds)
    UPDATE_INTERVAL = 30.0

    # Rolling window size for speed samples (at 30fps, 30s = 900 samples)
    SPEED_WINDOW_SECONDS = 30.0

    # EMA smoothing factor for skill score transitions
    # 0.1 means each update blends 10% new + 90% old -- very smooth
    EMA_ALPHA = 0.1

    # Skill score output range
    SKILL_MIN = 0.0
    SKILL_MAX = 1.0

    # AI parameter ranges indexed by [low_skill, high_skill]
    SPEED_FACTOR_RANGE = (0.85, 1.15)
    MISTAKE_CHANCE_RANGE = (0.20, 0.02)
    CORNERING_QUALITY_RANGE = (0.7, 1.0)

    # Difficulty multipliers: scale how much skill matching affects AI params.
    # On Easy, skill matching has a small effect (player chose easy for a reason).
    # On Hard, skill matching has a larger effect to keep the race competitive.
    DIFFICULTY_WEIGHT = {
        'easy': 0.4,
        'medium': 0.7,
        'hard': 1.0,
    }

    # Reference values for normalizing metrics (calibrated for CARLA Town03).
    # These represent "average" player performance. Faster/better = higher skill.
    REF_SPEED_KMH = 60.0           # Average speed for a mid-skill player
    REF_SPEED_MAX_KMH = 120.0      # Speed at which the metric saturates at 1.0
    REF_COLLISION_RATE = 3.0       # Collisions per 30s for a mid-skill player
    REF_CHECKPOINT_TIME = 10.0     # Seconds per checkpoint for mid-skill
    REF_CHECKPOINT_FAST = 4.0      # Fastest reasonable checkpoint time
    REF_DRIFT_RATE = 200.0         # Drift points per 30s for mid-skill
    REF_LAP_CONSISTENCY = 5.0      # Lap time std dev (seconds) for mid-skill

    def __init__(self, difficulty: str = 'easy'):
        self._difficulty = difficulty.lower()
        self._difficulty_weight = self.DIFFICULTY_WEIGHT.get(self._difficulty, 0.7)

        # --- Raw metric accumulators ---

        # Speed: deque of (timestamp, speed_kmh)
        self._speed_samples: deque = deque()

        # Collisions: deque of timestamps
        self._collision_times: deque = deque()

        # Checkpoint times: deque of (timestamp, time_between_checkpoints)
        self._checkpoint_times: deque = deque()
        self._last_checkpoint_time: Optional[float] = None

        # Drift scores: deque of (timestamp, score)
        self._drift_scores: deque = deque()

        # Lap times: list of all completed lap times
        self._lap_times: list = []

        # --- Computed metrics (updated every UPDATE_INTERVAL) ---
        self._avg_speed: float = 0.0
        self._collision_rate: float = 0.0
        self._checkpoint_efficiency: float = 0.0
        self._drift_rate: float = 0.0
        self._lap_consistency: float = 1.0  # 1.0 = perfect consistency

        # --- Skill score (EMA-smoothed) ---
        self._raw_skill_score: float = 0.5
        self._smoothed_skill_score: float = 0.5
        self._first_update: bool = True

        # --- Timing ---
        self._last_update_time: float = 0.0
        self._race_start_time: float = time.time()

        # --- Current AI adjustments (smoothed) ---
        self._current_speed_factor: float = 1.0
        self._current_mistake_chance: float = 0.10
        self._current_cornering_quality: float = 0.85

        # --- Logging ---
        self._update_count: int = 0

    def record_speed(self, speed_kmh: float):
        """Record a speed sample. Call every tick (30fps)."""
        now = time.time()
        self._speed_samples.append((now, speed_kmh))
        # Evict old samples beyond the rolling window
        cutoff = now - self.SPEED_WINDOW_SECONDS
        while self._speed_samples and self._speed_samples[0][0] < cutoff:
            self._speed_samples.popleft()

    def record_collision(self):
        """Record a collision event."""
        now = time.time()
        self._collision_times.append(now)
        # Evict old collisions beyond the rolling window
        cutoff = now - self.SPEED_WINDOW_SECONDS
        while self._collision_times and self._collision_times[0] < cutoff:
            self._collision_times.popleft()

    def record_checkpoint(self, checkpoint_index: int):
        """Record a checkpoint hit. Computes time since last checkpoint."""
        now = time.time()
        if self._last_checkpoint_time is not None:
            dt = now - self._last_checkpoint_time
            self._checkpoint_times.append((now, dt))
            # Evict old entries
            cutoff = now - self.SPEED_WINDOW_SECONDS * 2  # Keep 60s of checkpoints
            while self._checkpoint_times and self._checkpoint_times[0][0] < cutoff:
                self._checkpoint_times.popleft()
        self._last_checkpoint_time = now

    def record_drift_score(self, score: float):
        """Record a completed drift score."""
        now = time.time()
        self._drift_scores.append((now, score))
        # Evict old entries
        cutoff = now - self.SPEED_WINDOW_SECONDS
        while self._drift_scores and self._drift_scores[0][0] < cutoff:
            self._drift_scores.popleft()

    def record_lap_time(self, lap_time: float):
        """Record a completed lap time."""
        self._lap_times.append(lap_time)

    def update(self) -> bool:
        """Recompute skill score if UPDATE_INTERVAL has elapsed.

        Returns:
            True if the skill score was updated this call.
        """
        now = time.time()

        # Don't update for the first 15 seconds of the race -- let the player
        # establish a baseline before adjusting anything.
        if now - self._race_start_time < 15.0:
            return False

        if now - self._last_update_time < self.UPDATE_INTERVAL:
            return False

        self._last_update_time = now
        self._update_count += 1

        # --- Compute individual metrics ---
        self._compute_metrics(now)

        # --- Compute composite skill score ---
        self._raw_skill_score = self._compute_skill_score()

        # --- Apply EMA smoothing ---
        if self._first_update:
            self._smoothed_skill_score = self._raw_skill_score
            self._first_update = False
        else:
            self._smoothed_skill_score = (
                self.EMA_ALPHA * self._raw_skill_score
                + (1.0 - self.EMA_ALPHA) * self._smoothed_skill_score
            )

        # Clamp to [0, 1]
        self._smoothed_skill_score = max(
            self.SKILL_MIN,
            min(self.SKILL_MAX, self._smoothed_skill_score)
        )

        # --- Map skill score to AI parameter adjustments ---
        self._update_ai_params()

        # --- Log (every update, since it's only every 30s) ---
        print(
            f"[skill-matcher] Update #{self._update_count}: "
            f"raw={self._raw_skill_score:.2f} smoothed={self._smoothed_skill_score:.2f} | "
            f"avg_speed={self._avg_speed:.1f}km/h "
            f"collisions={self._collision_rate:.1f}/30s "
            f"cp_eff={self._checkpoint_efficiency:.1f}s "
            f"drift_rate={self._drift_rate:.0f}pts/30s "
            f"lap_consist={self._lap_consistency:.2f} | "
            f"AI: speed_factor={self._current_speed_factor:.3f} "
            f"mistake={self._current_mistake_chance:.3f} "
            f"cornering={self._current_cornering_quality:.3f}"
        )

        return True

    def _compute_metrics(self, now: float):
        """Compute rolling metrics from accumulated data."""
        # 1. Average speed over the rolling window
        if self._speed_samples:
            speeds = [s for _, s in self._speed_samples]
            self._avg_speed = sum(speeds) / len(speeds)
        else:
            self._avg_speed = 0.0

        # 2. Collision rate (count in the last 30s)
        cutoff = now - self.SPEED_WINDOW_SECONDS
        self._collision_rate = sum(
            1 for t in self._collision_times if t >= cutoff
        )

        # 3. Checkpoint efficiency (average time between checkpoints)
        recent_cps = [(t, dt) for t, dt in self._checkpoint_times if t >= cutoff]
        if recent_cps:
            self._checkpoint_efficiency = sum(dt for _, dt in recent_cps) / len(recent_cps)
        else:
            self._checkpoint_efficiency = self.REF_CHECKPOINT_TIME  # Default to mid

        # 4. Drift score accumulation rate
        recent_drifts = [(t, s) for t, s in self._drift_scores if t >= cutoff]
        self._drift_rate = sum(s for _, s in recent_drifts)

        # 5. Lap time consistency (std dev of lap times, lower = more consistent)
        if len(self._lap_times) >= 2:
            mean_lap = sum(self._lap_times) / len(self._lap_times)
            variance = sum((t - mean_lap) ** 2 for t in self._lap_times) / len(self._lap_times)
            std_dev = math.sqrt(variance)
            # Convert to 0-1 score: lower std_dev = higher consistency
            # At 0s std_dev -> 1.0 consistency; at REF_LAP_CONSISTENCY -> 0.5; at 2x -> ~0.25
            self._lap_consistency = 1.0 / (1.0 + std_dev / self.REF_LAP_CONSISTENCY)
        else:
            # Not enough laps yet -- assume mid-level consistency
            self._lap_consistency = 0.5

    def _compute_skill_score(self) -> float:
        """Compute a composite skill score from individual metrics.

        Each metric is normalized to [0, 1] and then combined with weights.
        Higher score = more skilled player.

        Weights:
          - Average speed:          30%  (most direct indicator of skill)
          - Collision rate:          25%  (fewer collisions = more skilled)
          - Checkpoint efficiency:   20%  (faster between checkpoints = better)
          - Drift score rate:        10%  (optional skill expression)
          - Lap consistency:         15%  (consistent laps = practiced/skilled)
        """
        # 1. Speed score: 0 at 0 km/h, 0.5 at REF_SPEED_KMH, 1.0 at REF_SPEED_MAX_KMH
        speed_score = min(1.0, max(0.0, self._avg_speed / self.REF_SPEED_MAX_KMH))

        # 2. Collision score: 1.0 at 0 collisions, 0.5 at REF_COLLISION_RATE, 0.0 at 2x
        # Using inverse scaling: score = 1 / (1 + rate / ref)
        collision_score = 1.0 / (1.0 + self._collision_rate / self.REF_COLLISION_RATE)

        # 3. Checkpoint efficiency: 1.0 at REF_CHECKPOINT_FAST, 0.5 at REF_CHECKPOINT_TIME
        # Faster = better. Using inverse mapping.
        if self._checkpoint_efficiency <= self.REF_CHECKPOINT_FAST:
            cp_score = 1.0
        else:
            cp_score = self.REF_CHECKPOINT_FAST / self._checkpoint_efficiency
        cp_score = max(0.0, min(1.0, cp_score))

        # 4. Drift rate score: 0.0 at 0, 0.5 at REF_DRIFT_RATE, ~0.75 at 2x
        # Drift is optional -- a non-drifting player shouldn't be penalized.
        # Using tanh-like curve that saturates gently.
        drift_score = min(1.0, self._drift_rate / (self.REF_DRIFT_RATE * 2.0))

        # 5. Lap consistency score (already computed as 0-1)
        consistency_score = self._lap_consistency

        # Weighted combination
        composite = (
            0.30 * speed_score
            + 0.25 * collision_score
            + 0.20 * cp_score
            + 0.10 * drift_score
            + 0.15 * consistency_score
        )

        return max(0.0, min(1.0, composite))

    def _update_ai_params(self):
        """Map the smoothed skill score to AI parameter overrides.

        Uses the difficulty weight to scale the effect: Easy mode applies
        only 40% of the skill adjustment, Hard mode applies 100%.
        """
        t = self._smoothed_skill_score  # 0.0 = low skill, 1.0 = high skill
        w = self._difficulty_weight     # Difficulty scaling

        # Blend toward the neutral midpoint (0.5) based on difficulty weight.
        # At w=1.0 (hard), full skill effect. At w=0.4 (easy), 40% of the effect.
        # effective_t = 0.5 + (t - 0.5) * w
        effective_t = 0.5 + (t - 0.5) * w

        # Linear interpolation between low-skill and high-skill values
        lo_speed, hi_speed = self.SPEED_FACTOR_RANGE
        lo_mistake, hi_mistake = self.MISTAKE_CHANCE_RANGE
        lo_corner, hi_corner = self.CORNERING_QUALITY_RANGE

        self._current_speed_factor = lo_speed + (hi_speed - lo_speed) * effective_t
        self._current_mistake_chance = lo_mistake + (hi_mistake - lo_mistake) * effective_t
        self._current_cornering_quality = lo_corner + (hi_corner - lo_corner) * effective_t

    def get_adjustments(self) -> Dict[str, float]:
        """Return the current AI parameter overrides.

        Returns:
            Dict with keys:
                speed_factor: Multiplier for AI target speed (0.85-1.15)
                mistake_chance: Probability of AI mistakes per check (0.02-0.20)
                cornering_quality: How cleanly the AI corners (0.7-1.0)
                skill_score: The smoothed skill score for debugging (0.0-1.0)
        """
        return {
            'speed_factor': round(self._current_speed_factor, 3),
            'mistake_chance': round(self._current_mistake_chance, 3),
            'cornering_quality': round(self._current_cornering_quality, 3),
            'skill_score': round(self._smoothed_skill_score, 3),
        }

    def get_speed_adjustment(self) -> float:
        """Convert the speed_factor into a traffic manager speed adjustment.

        CARLA's traffic manager uses vehicle_percentage_speed_difference
        where negative = faster. This method converts our speed_factor
        into that format.

        Returns:
            Speed adjustment in percentage points:
              speed_factor 1.0  -> 0.0  (no change)
              speed_factor 1.15 -> -15.0 (15% faster)
              speed_factor 0.85 -> +15.0 (15% slower)
        """
        return (1.0 - self._current_speed_factor) * 100.0

    def reset(self):
        """Reset all state for a new race."""
        self._speed_samples.clear()
        self._collision_times.clear()
        self._checkpoint_times.clear()
        self._drift_scores.clear()
        self._lap_times.clear()
        self._last_checkpoint_time = None

        self._avg_speed = 0.0
        self._collision_rate = 0.0
        self._checkpoint_efficiency = 0.0
        self._drift_rate = 0.0
        self._lap_consistency = 0.5

        self._raw_skill_score = 0.5
        self._smoothed_skill_score = 0.5
        self._first_update = True

        self._last_update_time = 0.0
        self._race_start_time = time.time()
        self._update_count = 0

        self._current_speed_factor = 1.0
        self._current_mistake_chance = 0.10
        self._current_cornering_quality = 0.85
