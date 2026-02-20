"""
AI Personality - Emotional states that affect AI driving behavior and are visible to the player.

The AI opponent has emotional states that:
1. Affect its driving (speed, mistake frequency, aggression)
2. Are visible on the player's HUD (emoji + text + color)
3. Transition smoothly over 3-5 seconds (no jarring flips)

State machine:
  confident  -> aggressive   (player overtakes AI)
  confident  -> nervous      (gap < 1s)
  aggressive -> confident    (AI re-takes lead)
  nervous    -> desperate    (final lap while behind)
  any        -> respectful   (player has 10+ second lead)
"""
import time
import math
from typing import Dict, Optional, Tuple


class AIPersonality:
    """AI opponent with emotional states that affect driving behavior."""

    STATES = {
        'confident': {
            'speed_factor': 1.0,
            'mistake_chance': 0.02,
            'aggression': 0.3,
            'taunt_mood': 'cocky',
            'emoji': '\U0001f60e',       # sunglasses
            'label': 'CONFIDENT',
            'color': '#4CAF50',          # green
        },
        'aggressive': {
            'speed_factor': 1.15,
            'mistake_chance': 0.08,
            'aggression': 0.9,
            'taunt_mood': 'angry',
            'emoji': '\U0001f624',       # triumph / steam from nose
            'label': 'AGGRESSIVE',
            'color': '#f44336',          # red
        },
        'nervous': {
            'speed_factor': 0.95,
            'mistake_chance': 0.12,
            'aggression': 0.4,
            'taunt_mood': 'worried',
            'emoji': '\U0001f630',       # cold sweat
            'label': 'NERVOUS',
            'color': '#FFC107',          # amber / yellow
        },
        'desperate': {
            'speed_factor': 1.2,
            'mistake_chance': 0.15,
            'aggression': 1.0,
            'taunt_mood': 'desperate',
            'emoji': '\U0001f631',       # scream
            'label': 'DESPERATE',
            'color': '#9C27B0',          # purple
        },
        'respectful': {
            'speed_factor': 1.05,
            'mistake_chance': 0.05,
            'aggression': 0.5,
            'taunt_mood': 'impressed',
            'emoji': '\U0001f44f',       # clapping hands
            'label': 'IMPRESSED',
            'color': '#2196F3',          # blue
        },
    }

    # Transition blend duration in seconds
    BLEND_DURATION = 4.0

    def __init__(self):
        self._current_state: str = 'confident'
        self._target_state: str = 'confident'
        self._blend_start: float = 0.0
        self._blend_progress: float = 1.0  # 1.0 = fully at target

        # Cached blended driving params
        self._blended_speed_factor: float = 1.0
        self._blended_mistake_chance: float = 0.02
        self._blended_aggression: float = 0.3

        # Tracking for state transition triggers
        self._prev_player_position: Optional[int] = None
        self._prev_ai_position: Optional[int] = None
        self._last_transition_time: float = 0.0

        # Minimum time between state transitions to avoid flapping
        self._transition_cooldown: float = 5.0

    def _can_transition(self, now: float) -> bool:
        """Check if enough time has passed since the last transition."""
        return now - self._last_transition_time >= self._transition_cooldown

    def _transition_to(self, new_state: str, now: float):
        """Begin a smooth transition to a new emotional state."""
        if new_state == self._target_state:
            return
        if new_state not in self.STATES:
            return

        # The current blended values become our starting point
        self._current_state = self._target_state
        self._target_state = new_state
        self._blend_start = now
        self._blend_progress = 0.0
        self._last_transition_time = now
        print(f"[ai-personality] Transitioning: {self._current_state} -> {self._target_state}")

    def update(self, race_state) -> None:
        """Evaluate race conditions and transition between emotional states.

        Called every tick from the race loop.

        Args:
            race_state: RaceState object with current race data.
        """
        now = time.time()

        # Update blend progress (smooth transition over BLEND_DURATION seconds)
        if self._blend_progress < 1.0:
            elapsed = now - self._blend_start
            self._blend_progress = min(1.0, elapsed / self.BLEND_DURATION)

        # Compute blended driving parameters
        self._update_blended_params()

        # Only consider transitions if race is active
        if race_state.status not in ('racing', 'finishing'):
            return

        if not self._can_transition(now):
            return

        gap = race_state.get_gap_seconds()
        positions = race_state.get_position()
        player_pos = positions.get('player', 1)
        ai_pos = positions.get('ai', 2)
        current = self._target_state

        # --- Priority 1: Respectful (player has dominant 10+ second lead) ---
        if gap is not None and gap > 10.0:
            if current != 'respectful':
                self._transition_to('respectful', now)
                return

        # --- Priority 2: Desperate (final lap, AI is behind) ---
        is_final_lap_for_ai = race_state.ai_lap >= race_state.total_laps - 1
        ai_is_behind = ai_pos > player_pos
        if is_final_lap_for_ai and ai_is_behind and current not in ('desperate', 'respectful'):
            self._transition_to('desperate', now)
            return

        # --- Priority 3: Aggressive (player just overtook AI) ---
        if self._prev_player_position is not None:
            player_just_took_lead = (
                self._prev_player_position > 1 and player_pos == 1
            )
            if player_just_took_lead and current not in ('desperate', 'respectful'):
                self._transition_to('aggressive', now)
                self._prev_player_position = player_pos
                self._prev_ai_position = ai_pos
                return

        # --- Priority 4: Confident (AI re-takes lead while aggressive) ---
        if current == 'aggressive' and ai_pos == 1:
            self._transition_to('confident', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # --- Priority 5: Nervous (gap < 1 second, close racing) ---
        if gap is not None and abs(gap) < 1.0 and current == 'confident':
            self._transition_to('nervous', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # --- Return to confident when gap opens up and AI leads ---
        if current == 'nervous' and gap is not None and gap < -3.0:
            self._transition_to('confident', now)

        # --- Exit respectful if player loses lead ---
        if current == 'respectful' and gap is not None and gap < 5.0:
            self._transition_to('confident', now)

        self._prev_player_position = player_pos
        self._prev_ai_position = ai_pos

    def _update_blended_params(self):
        """Interpolate driving parameters between current and target states."""
        if self._blend_progress >= 1.0:
            # Fully transitioned
            target = self.STATES[self._target_state]
            self._blended_speed_factor = target['speed_factor']
            self._blended_mistake_chance = target['mistake_chance']
            self._blended_aggression = target['aggression']
            return

        src = self.STATES[self._current_state]
        dst = self.STATES[self._target_state]

        # Smoothstep for natural feel: 3t^2 - 2t^3
        t = self._blend_progress
        t = t * t * (3.0 - 2.0 * t)

        self._blended_speed_factor = src['speed_factor'] + (dst['speed_factor'] - src['speed_factor']) * t
        self._blended_mistake_chance = src['mistake_chance'] + (dst['mistake_chance'] - src['mistake_chance']) * t
        self._blended_aggression = src['aggression'] + (dst['aggression'] - src['aggression']) * t

    def get_driving_params(self) -> Dict[str, float]:
        """Return the current (blended) driving parameters.

        Returns:
            Dict with keys:
                speed_factor: multiplier for AI target speed (1.0 = normal)
                mistake_chance: probability of mistake per check (0.0-1.0)
                aggression: general aggression level (0.0-1.0)
        """
        return {
            'speed_factor': round(self._blended_speed_factor, 3),
            'mistake_chance': round(self._blended_mistake_chance, 3),
            'aggression': round(self._blended_aggression, 3),
        }

    def get_emotion_display(self) -> Dict[str, str]:
        """Return the current emotion for display on the HUD.

        During blending, shows the target state (the state we're transitioning TO)
        so the player sees the reaction immediately.

        Returns:
            Dict with keys:
                state: internal state name (e.g. 'aggressive')
                emoji: unicode emoji character
                label: short uppercase text (e.g. 'AGGRESSIVE')
                color: hex color string (e.g. '#f44336')
        """
        # Always show the target state (the one we're transitioning toward)
        state_info = self.STATES[self._target_state]
        return {
            'state': self._target_state,
            'emoji': state_info['emoji'],
            'label': state_info['label'],
            'color': state_info['color'],
        }

    def get_current_state(self) -> str:
        """Return the current target state name."""
        return self._target_state

    def get_speed_modifier(self) -> float:
        """Return a speed adjustment value for the traffic manager.

        Converts the blended speed_factor into a percentage adjustment
        compatible with CARLA's traffic manager speed_difference API.

        Returns:
            Adjustment in percentage points:
              - Negative = faster (e.g., -10 means 10% over limit)
              - Positive = slower (e.g., +5 means 5% under limit)
            Based on: (1.0 - speed_factor) * 100
              speed_factor 1.0  -> 0.0  (no change)
              speed_factor 1.15 -> -15.0 (15% faster)
              speed_factor 0.95 -> +5.0  (5% slower)
        """
        return (1.0 - self._blended_speed_factor) * 100.0

    def get_mistake_multiplier(self) -> float:
        """Return a multiplier for the AIMistakeGenerator's interval.

        Higher mistake_chance -> shorter intervals (more frequent mistakes).
        Lower mistake_chance -> longer intervals (fewer mistakes).

        The base mistake_chance for 'medium' is 0.05, so we normalize around that.

        Returns:
            Multiplier for the mistake interval:
              < 1.0 = more frequent mistakes
              > 1.0 = less frequent mistakes
        """
        base_chance = 0.05  # medium baseline
        if self._blended_mistake_chance <= 0:
            return 2.0  # Very few mistakes
        ratio = base_chance / self._blended_mistake_chance
        # Clamp to reasonable range
        return max(0.3, min(3.0, ratio))

    def to_dict(self) -> Dict:
        """Serialize for inclusion in race_state telemetry."""
        display = self.get_emotion_display()
        return {
            'state': display['state'],
            'emoji': display['emoji'],
            'label': display['label'],
            'color': display['color'],
            'speed_factor': round(self._blended_speed_factor, 2),
            'aggression': round(self._blended_aggression, 2),
        }
