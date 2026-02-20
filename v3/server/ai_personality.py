"""
AI Personality - Emotional state machine that affects AI driving behavior
and is visible to the player via the HUD.

The AI opponent has emotional states that:
1. Affect its driving (speed, mistake frequency, aggression)
2. Are visible on the player's HUD (emoji + text + color)
3. Transition smoothly over 3-5 seconds (no jarring flips)
4. Map to autopilot parameter overrides for CARLA traffic manager
5. Feed into commentary/trash talk for context-aware narration

State machine (event-triggered transitions):
  calm       -> aggressive   (AI falls behind by >3s)
  calm       -> confident    (AI leads by >5s)
  calm       -> nervous      (player within 1s on final lap)
  aggressive -> frustrated   (AI behind for >30s cumulative)
  aggressive -> confident    (AI re-takes lead)
  nervous    -> desperate    (gap < 0.5s on final 20% of race)
  frustrated -> aggressive   (gap closes to < 2s)
  frustrated -> calm         (AI takes lead)
  confident  -> calm         (gap narrows to < 3s)
  confident  -> nervous      (player overtakes AI)
  desperate  -> nervous      (AI takes lead back on final lap)
  any        -> respectful   (player has dominant 10+ second lead)
  respectful -> calm         (gap narrows below 5s)
"""
import time
import math
from typing import Dict, Optional, Tuple


class AIPersonality:
    """AI opponent with emotional states that affect driving behavior."""

    STATES = {
        'calm': {
            'speed_factor': 1.0,       # Normal speed
            'mistake_chance': 0.03,
            'aggression': 0.2,
            'taunt_mood': 'relaxed',
            'emoji': '\U0001f60e',     # sunglasses
            'label': 'CALM',
            'color': '#78909C',        # blue-grey
        },
        'aggressive': {
            'speed_factor': 1.05,      # +5% speed
            'mistake_chance': 0.08,    # More mistakes from pushing hard
            'aggression': 0.9,
            'taunt_mood': 'angry',
            'emoji': '\U0001f624',     # triumph / steam from nose
            'label': 'AGGRESSIVE',
            'color': '#f44336',        # red
        },
        'nervous': {
            'speed_factor': 0.97,      # -3% speed (makes mistakes)
            'mistake_chance': 0.12,
            'aggression': 0.4,
            'taunt_mood': 'worried',
            'emoji': '\U0001f630',     # cold sweat
            'label': 'NERVOUS',
            'color': '#FFC107',        # amber / yellow
        },
        'frustrated': {
            'speed_factor': 1.0,       # Normal speed but erratic
            'mistake_chance': 0.18,    # Very high mistake rate (random braking)
            'aggression': 0.7,
            'taunt_mood': 'frustrated',
            'emoji': '\U0001f92c',     # face with symbols on mouth
            'label': 'FRUSTRATED',
            'color': '#FF5722',        # deep orange
        },
        'confident': {
            'speed_factor': 1.0,       # Normal, smooth driving
            'mistake_chance': 0.02,    # Very few mistakes
            'aggression': 0.3,
            'taunt_mood': 'cocky',
            'emoji': '\U0001f60f',     # smirk
            'label': 'CONFIDENT',
            'color': '#4CAF50',        # green
        },
        'desperate': {
            'speed_factor': 1.08,      # +8% speed, all-out push
            'mistake_chance': 0.15,    # High mistake rate from over-driving
            'aggression': 1.0,
            'taunt_mood': 'desperate',
            'emoji': '\U0001f631',     # scream
            'label': 'DESPERATE',
            'color': '#9C27B0',        # purple
        },
        'respectful': {
            'speed_factor': 1.05,
            'mistake_chance': 0.05,
            'aggression': 0.5,
            'taunt_mood': 'impressed',
            'emoji': '\U0001f44f',     # clapping hands
            'label': 'IMPRESSED',
            'color': '#2196F3',        # blue
        },
    }

    # Transition blend duration in seconds
    BLEND_DURATION = 4.0

    def __init__(self):
        self._current_state: str = 'calm'
        self._target_state: str = 'calm'
        self._blend_start: float = 0.0
        self._blend_progress: float = 1.0  # 1.0 = fully at target

        # Cached blended driving params
        self._blended_speed_factor: float = 1.0
        self._blended_mistake_chance: float = 0.03
        self._blended_aggression: float = 0.2

        # Tracking for state transition triggers
        self._prev_player_position: Optional[int] = None
        self._prev_ai_position: Optional[int] = None
        self._last_transition_time: float = 0.0

        # Minimum time between state transitions to avoid flapping
        self._transition_cooldown: float = 5.0

        # Track how long the AI has been behind (for frustrated transition)
        self._behind_start_time: Optional[float] = None
        self._cumulative_behind_time: float = 0.0

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

    def update(self, race_state, race_progress: float = 0.0) -> None:
        """Evaluate race conditions and transition between emotional states.

        Called every tick from the race loop.

        Args:
            race_state: RaceState object with current race data.
            race_progress: Overall race progress (0.0 to 1.0), used for
                          desperate transition on final 20%.
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

        ai_is_behind = ai_pos > player_pos
        ai_is_ahead = ai_pos < player_pos or (ai_pos == player_pos and gap is not None and gap < 0)

        # --- Track how long AI has been behind (for frustrated) ---
        if ai_is_behind:
            if self._behind_start_time is None:
                self._behind_start_time = now
            self._cumulative_behind_time = now - self._behind_start_time
        else:
            self._behind_start_time = None
            self._cumulative_behind_time = 0.0

        # --- Priority 1: Respectful (player has dominant 10+ second lead) ---
        if gap is not None and gap > 10.0:
            if current != 'respectful':
                self._transition_to('respectful', now)
                return

        # --- Priority 2: Desperate (gap < 0.5s on final 20% of race, AI behind) ---
        is_final_lap_for_ai = race_state.ai_lap >= race_state.total_laps - 1
        if (race_progress > 0.80 and gap is not None and abs(gap) < 0.5
                and ai_is_behind and current not in ('desperate', 'respectful')):
            self._transition_to('desperate', now)
            return

        # Alternate desperate trigger: final lap, AI is behind by any amount
        if is_final_lap_for_ai and ai_is_behind and current not in ('desperate', 'respectful'):
            self._transition_to('desperate', now)
            return

        # --- Priority 3: Frustrated (AI behind for >30s cumulative while aggressive) ---
        if (current == 'aggressive' and self._cumulative_behind_time > 30.0):
            self._transition_to('frustrated', now)
            return

        # --- Priority 4: Aggressive (AI falls behind by >3s) ---
        if gap is not None and gap > 3.0 and current in ('calm', 'confident', 'nervous'):
            self._transition_to('aggressive', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # Also trigger aggressive on player overtake
        if self._prev_player_position is not None:
            player_just_took_lead = (
                self._prev_player_position > 1 and player_pos == 1
            )
            if player_just_took_lead and current in ('confident', 'calm'):
                self._transition_to('aggressive', now)
                self._prev_player_position = player_pos
                self._prev_ai_position = ai_pos
                return

        # --- Priority 5: Confident (AI leads by >5s) ---
        if gap is not None and gap < -5.0 and current in ('calm', 'nervous'):
            self._transition_to('confident', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # --- Priority 6: Nervous (player within 1s on final lap) ---
        is_final_lap_for_player = race_state.player_lap >= race_state.total_laps - 1
        if (gap is not None and abs(gap) < 1.0
                and (is_final_lap_for_ai or is_final_lap_for_player)
                and current in ('calm', 'confident')):
            self._transition_to('nervous', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # Also nervous when confident AI gets overtaken
        if current == 'confident' and player_pos == 1 and ai_pos > 1:
            self._transition_to('nervous', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # --- State-specific recovery transitions ---

        # Aggressive -> confident: AI re-takes lead
        if current == 'aggressive' and ai_is_ahead:
            self._transition_to('confident', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # Frustrated -> aggressive: gap closes to < 2s
        if current == 'frustrated' and gap is not None and abs(gap) < 2.0:
            self._transition_to('aggressive', now)
            self._prev_player_position = player_pos
            self._prev_ai_position = ai_pos
            return

        # Frustrated -> calm: AI takes lead
        if current == 'frustrated' and ai_is_ahead:
            self._transition_to('calm', now)

        # Confident -> calm: gap narrows to < 3s
        if current == 'confident' and gap is not None and abs(gap) < 3.0:
            self._transition_to('calm', now)

        # Nervous -> calm: gap opens up and AI leads
        if current == 'nervous' and gap is not None and gap < -3.0:
            self._transition_to('calm', now)

        # Desperate -> nervous: AI takes lead back on final lap
        if current == 'desperate' and ai_is_ahead:
            self._transition_to('nervous', now)

        # Respectful -> calm: gap narrows below 5s
        if current == 'respectful' and gap is not None and gap < 5.0:
            self._transition_to('calm', now)

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
              speed_factor 1.05 -> -5.0 (5% faster)
              speed_factor 0.97 -> +3.0 (3% slower)
        """
        return (1.0 - self._blended_speed_factor) * 100.0

    def get_mistake_multiplier(self) -> float:
        """Return a multiplier for the AIMistakeGenerator's interval.

        Higher mistake_chance -> shorter intervals (more frequent mistakes).
        Lower mistake_chance -> longer intervals (fewer mistakes).

        The base mistake_chance for 'calm' is 0.03, so we normalize around that.

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
