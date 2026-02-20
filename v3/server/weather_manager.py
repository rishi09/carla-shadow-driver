"""
Weather Manager - Dynamic weather mood transitions driven by race events.

Defines weather mood presets with specific CARLA weather parameter values,
maps race events to weather transitions, and smoothly interpolates (lerps)
weather parameters over configurable durations.

Mood presets:
  CALM      - Clear sky, mild sun, no rain. Used at race start.
  TENSE     - Overcast, lower sun, hint of clouds. Triggered by close gap (<2s).
  DRAMATIC  - Storm clouds, rain starting, high wind. Triggered on final lap.
  FINALE    - Golden hour clearing skies. Last 20% of final lap.
  NIGHT_TENSE - Nighttime with slight fog. Night tracks when gap < 2s.

The WeatherManager is called each frame with the current dt to smoothly
interpolate all parameters toward the active target mood.
"""
import time
from typing import Dict, Optional


# ---------------------------------------------------------------------------
# Weather mood presets
# ---------------------------------------------------------------------------
# Each preset is a dict of CARLA WeatherParameters fields.
# Values are in CARLA units: percentages (0-100) for most, degrees for sun.

WEATHER_MOODS: Dict[str, Dict[str, float]] = {
    'CALM': {
        'cloudiness': 10.0,
        'precipitation': 0.0,
        'precipitation_deposits': 0.0,
        'wind_intensity': 5.0,
        'sun_altitude_angle': 60.0,
        'fog_density': 0.0,
        'fog_distance': 0.0,
        'wetness': 0.0,
    },
    'TENSE': {
        'cloudiness': 55.0,
        'precipitation': 0.0,
        'precipitation_deposits': 5.0,
        'wind_intensity': 25.0,
        'sun_altitude_angle': 35.0,
        'fog_density': 8.0,
        'fog_distance': 50.0,
        'wetness': 10.0,
    },
    'DRAMATIC': {
        'cloudiness': 85.0,
        'precipitation': 45.0,
        'precipitation_deposits': 40.0,
        'wind_intensity': 60.0,
        'sun_altitude_angle': 20.0,
        'fog_density': 15.0,
        'fog_distance': 40.0,
        'wetness': 70.0,
    },
    'FINALE': {
        'cloudiness': 30.0,
        'precipitation': 0.0,
        'precipitation_deposits': 10.0,
        'wind_intensity': 10.0,
        'sun_altitude_angle': 8.0,       # Golden hour: low sun
        'fog_density': 3.0,
        'fog_distance': 80.0,
        'wetness': 5.0,
    },
    'NIGHT_TENSE': {
        'cloudiness': 70.0,
        'precipitation': 0.0,
        'precipitation_deposits': 5.0,
        'wind_intensity': 15.0,
        'sun_altitude_angle': -25.0,      # Night
        'fog_density': 20.0,
        'fog_distance': 30.0,
        'wetness': 15.0,
    },
}


class WeatherManager:
    """Manages smooth weather transitions driven by race events.

    Usage in the race loop:
        wm = WeatherManager(world)
        wm.set_target_mood('CALM')

        # Each frame:
        wm.update(dt)

        # In telemetry:
        state['weather'] = wm.get_weather_state()
    """

    # Only push weather to CARLA every N seconds to avoid overhead
    _CARLA_UPDATE_INTERVAL = 1.0

    def __init__(self, world, is_night: bool = False):
        """
        Args:
            world: CARLA world reference (used to call world.set_weather / get_weather).
            is_night: True if the track starts at night (changes TENSE -> NIGHT_TENSE).
        """
        self._world = world
        self._is_night = is_night

        # Current smoothly-interpolated parameter values
        self._current: Dict[str, float] = dict(WEATHER_MOODS['CALM'])

        # Target parameter values we are lerping toward
        self._target: Dict[str, float] = dict(WEATHER_MOODS['CALM'])

        # Active mood name
        self._mood: str = 'CALM'

        # Transition timing
        self._transition_time: float = 15.0   # seconds for full transition
        self._transition_elapsed: float = 0.0  # how long we've been transitioning

        # CARLA update throttle
        self._last_carla_update: float = 0.0

        # --- Event tracking for automatic mood selection ---
        self._close_gap_start: float = 0.0     # When gap first dropped below 2s
        self._close_gap_active: bool = False    # True if gap has been <2s for >10s

        # --- Ambient Light override ---
        self._ambient_override: bool = False
        self._ambient_params: Dict[str, float] = {}

    def set_target_mood(self, mood: str, transition_time: float = 15.0):
        """Set the target weather preset to transition toward.

        Args:
            mood: One of the keys in WEATHER_MOODS.
            transition_time: Seconds for the lerp to complete (10-30 typical).
        """
        # When ambient override is active, ignore automatic mood changes
        if self._ambient_override:
            return

        if mood not in WEATHER_MOODS:
            print(f"[weather] Unknown mood '{mood}', ignoring")
            return

        if mood == self._mood:
            return  # Already targeting this mood

        self._mood = mood
        self._target = dict(WEATHER_MOODS[mood])
        self._transition_time = max(1.0, transition_time)
        self._transition_elapsed = 0.0
        print(f"[weather] Transitioning to {mood} over {transition_time:.0f}s")

    def set_ambient_override(self, sun_altitude: float, cloudiness: float, precipitation: float):
        """Override the automatic mood system with ambient light values.

        When active, the mood-based weather transitions are suppressed and the
        weather is driven entirely by the client's room brightness. The override
        is sticky until explicitly cleared via clear_ambient_override().

        Args:
            sun_altitude: Sun altitude angle in degrees (-90 to 90).
            cloudiness: Cloudiness percentage (0-100).
            precipitation: Precipitation percentage (0-100).
        """
        self._ambient_override = True
        self._ambient_params = {
            'sun_altitude_angle': sun_altitude,
            'cloudiness': cloudiness,
            'precipitation': precipitation,
            'precipitation_deposits': precipitation * 0.5,
            'wind_intensity': min(50.0, precipitation * 0.8),
            'fog_density': max(0, 15.0 - sun_altitude * 0.3) if sun_altitude < 20 else 0.0,
            'fog_distance': 40.0 if sun_altitude < 10 else 0.0,
            'wetness': precipitation * 0.7,
        }
        # Set these as the new target for smooth lerp
        self._target = dict(self._ambient_params)
        self._mood = 'AMBIENT'
        self._transition_time = 8.0  # 8 seconds for ambient transitions (smooth but responsive)
        self._transition_elapsed = 0.0
        print(f"[weather] Ambient override: sun={sun_altitude}, clouds={cloudiness}, precip={precipitation}")

    def clear_ambient_override(self):
        """Clear the ambient light override and return to mood-based weather."""
        if not self._ambient_override:
            return
        self._ambient_override = False
        self._ambient_params = {}
        print("[weather] Ambient override cleared, returning to mood-based weather")
        # Return to CALM as a safe default
        self._mood = ''  # Force transition by clearing current mood
        self.set_target_mood('CALM', transition_time=10.0)

    def evaluate_race_events(self, race_state, is_final_lap: bool,
                             final_lap_progress: float, gap_seconds: Optional[float]):
        """Evaluate race conditions and automatically set the appropriate mood.

        Called each frame from the race loop. Checks conditions in priority order
        (highest priority first) and sets the mood accordingly.

        Args:
            race_state: The RaceState object.
            is_final_lap: True if the leader is on the final lap.
            final_lap_progress: 0.0-1.0 progress through the final lap (0 if not final).
            gap_seconds: Time gap (positive = player ahead). None if unavailable.
        """
        # When ambient override is active, skip automatic mood transitions
        if self._ambient_override:
            return

        # Priority 1: Last 20% of final lap -> FINALE (golden hour)
        if is_final_lap and final_lap_progress >= 0.80:
            self.set_target_mood('FINALE', transition_time=10.0)
            return

        # Priority 2: Final lap -> DRAMATIC
        if is_final_lap:
            self.set_target_mood('DRAMATIC', transition_time=20.0)
            return

        # Priority 3: Close gap (<2s) sustained for >10 seconds -> TENSE / NIGHT_TENSE
        if gap_seconds is not None and abs(gap_seconds) < 2.0:
            now = time.time()
            if not self._close_gap_active:
                if self._close_gap_start == 0.0:
                    self._close_gap_start = now
                elif now - self._close_gap_start > 10.0:
                    self._close_gap_active = True
                    mood = 'NIGHT_TENSE' if self._is_night else 'TENSE'
                    self.set_target_mood(mood, transition_time=15.0)
                    return
            # Already active, keep it
            if self._close_gap_active:
                return
        else:
            # Gap opened up: reset close-gap tracking
            self._close_gap_start = 0.0
            self._close_gap_active = False

        # Priority 4: Default -> CALM (only if we aren't already in a more dramatic mood
        # and the current transition isn't toward something more intense)
        if self._mood in ('TENSE', 'NIGHT_TENSE') and not self._close_gap_active:
            # Gap opened: return to calm
            self.set_target_mood('CALM', transition_time=20.0)

    def update(self, dt: float):
        """Advance the lerp by dt seconds and optionally push to CARLA.

        The interpolation formula is:
            current = current + (target - current) * min(1.0, dt / remaining_time)

        This produces an exponential ease-out that converges smoothly.

        Args:
            dt: Time delta in seconds since last call (typically 1/30).
        """
        if self._transition_time <= 0:
            return

        self._transition_elapsed += dt

        # Compute lerp factor: fraction of remaining distance to cover this frame
        remaining = max(0.001, self._transition_time - self._transition_elapsed)
        # Use exponential approach: cover a fraction proportional to dt / transition_time
        # This ensures smooth convergence regardless of frame rate
        alpha = min(1.0, dt / remaining)

        changed = False
        for key in self._current:
            if key in self._target:
                old = self._current[key]
                target = self._target[key]
                new = old + (target - old) * alpha
                if abs(new - old) > 0.01:
                    changed = True
                self._current[key] = new

        # Push to CARLA periodically (not every frame)
        now = time.time()
        if changed and now - self._last_carla_update >= self._CARLA_UPDATE_INTERVAL:
            self._last_carla_update = now
            self._apply_to_carla()

    def _apply_to_carla(self):
        """Apply current interpolated weather parameters to the CARLA world."""
        if not self._world:
            return
        try:
            weather = self._world.get_weather()
            weather.cloudiness = self._current.get('cloudiness', 0)
            weather.precipitation = self._current.get('precipitation', 0)
            weather.precipitation_deposits = self._current.get('precipitation_deposits', 0)
            weather.wind_intensity = self._current.get('wind_intensity', 0)
            weather.sun_altitude_angle = self._current.get('sun_altitude_angle', 60)
            weather.fog_density = self._current.get('fog_density', 0)
            weather.fog_distance = self._current.get('fog_distance', 0)
            weather.wetness = self._current.get('wetness', 0)
            self._world.set_weather(weather)
        except Exception as e:
            print(f"[weather] Failed to apply weather to CARLA: {e}")

    def get_weather_state(self) -> Dict:
        """Return the current weather state for inclusion in telemetry.

        Returns a dict suitable for sending to the frontend:
            {
                'mood': 'CALM' | 'TENSE' | 'DRAMATIC' | 'FINALE' | 'NIGHT_TENSE',
                'intensity': 0.0-1.0,
                'precipitation': 0-100,
                'fog_density': 0-100,
                'wind_intensity': 0-100,
                'cloudiness': 0-100,
                'wetness': 0-100,
            }
        """
        # Compute an approximate intensity score (0-1) from current params
        # This is used by the frontend to decide overlay strength
        precip = self._current.get('precipitation', 0)
        fog = self._current.get('fog_density', 0)
        wind = self._current.get('wind_intensity', 0)
        cloud = self._current.get('cloudiness', 0)
        intensity = min(1.0, (precip / 100 * 0.4 + fog / 100 * 0.2 + wind / 100 * 0.2 + cloud / 100 * 0.2))

        return {
            'mood': self._mood,
            'intensity': round(intensity, 2),
            'precipitation': round(self._current.get('precipitation', 0), 1),
            'fog_density': round(self._current.get('fog_density', 0), 1),
            'wind_intensity': round(self._current.get('wind_intensity', 0), 1),
            'cloudiness': round(self._current.get('cloudiness', 0), 1),
            'wetness': round(self._current.get('wetness', 0), 1),
        }
