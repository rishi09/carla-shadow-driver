"""
Weather Transitions - Dynamic time-of-day and weather changes during a race.

Creates visually stunning lighting shifts as the race progresses:
  - Dawn -> Sunrise -> Morning (first third)
  - Morning -> Noon -> Afternoon (middle third)
  - Afternoon -> Sunset -> Dusk (final third)

Optional weather events (storm, fog) triggered at specific race progress points.
"""
import math
from typing import Dict, Optional


class WeatherTransitionManager:
    """Manages gradual weather/lighting transitions during a race.

    The sun moves across the sky as the race progresses, creating dramatic
    lighting changes. The starting weather preset determines the initial
    conditions, and transitions layer on top.
    """

    # Update weather every N race loop iterations to avoid excessive CARLA calls
    UPDATE_EVERY_N_FRAMES = 15  # ~every 0.5 seconds at 30fps

    def __init__(self, base_weather: str = 'clear', total_laps: int = 3):
        self.base_weather = base_weather
        self.total_laps = total_laps
        self._frame_counter = 0
        self._last_progress = -1.0
        self._storm_triggered = False

        # Sun path keyframes: (progress, altitude, azimuth)
        # Creates a dramatic arc across the sky
        self._sun_path = self._build_sun_path(base_weather)

        # Base cloud/rain from weather preset
        self._base_cloudiness = 0.0
        self._base_precipitation = 0.0
        self._base_fog = 0.0
        self._base_wind = 0.0

        if base_weather == 'cloudy':
            self._base_cloudiness = 40.0
        elif base_weather == 'rain':
            self._base_cloudiness = 70.0
            self._base_precipitation = 50.0
        elif base_weather == 'storm':
            self._base_cloudiness = 90.0
            self._base_precipitation = 80.0
            self._base_wind = 80.0

    def _build_sun_path(self, weather: str) -> list:
        """Build sun altitude/azimuth keyframes based on starting weather.

        Returns list of (progress, altitude, azimuth) tuples.
        """
        if weather == 'night':
            # Night race: moon moves across the sky
            return [
                (0.0, -20.0, 0.0),
                (0.25, -15.0, 45.0),
                (0.5, -10.0, 90.0),
                (0.75, -5.0, 135.0),
                (1.0, 5.0, 180.0),  # Hint of dawn at finish
            ]
        elif weather == 'sunset':
            # Start at sunset, end at night
            return [
                (0.0, 15.0, 260.0),
                (0.25, 8.0, 275.0),
                (0.5, 2.0, 285.0),
                (0.75, -5.0, 295.0),
                (1.0, -15.0, 310.0),
            ]
        else:
            # Default: sunrise to sunset arc (most dramatic)
            return [
                (0.0, -5.0, 60.0),     # Just before sunrise (east)
                (0.15, 15.0, 80.0),    # Sunrise - golden hour
                (0.35, 45.0, 120.0),   # Mid-morning
                (0.5, 70.0, 180.0),    # High noon
                (0.65, 50.0, 220.0),   # Afternoon
                (0.85, 15.0, 280.0),   # Golden hour sunset
                (1.0, 2.0, 300.0),     # Sunset finish
            ]

    def _interpolate_sun(self, progress: float) -> tuple:
        """Interpolate sun position from keyframes at given progress [0, 1]."""
        path = self._sun_path
        progress = max(0.0, min(1.0, progress))

        # Find bracketing keyframes
        for i in range(len(path) - 1):
            p0, alt0, az0 = path[i]
            p1, alt1, az1 = path[i + 1]
            if progress <= p1:
                if p1 == p0:
                    t = 0.0
                else:
                    t = (progress - p0) / (p1 - p0)
                # Smooth interpolation using smoothstep
                t = t * t * (3.0 - 2.0 * t)
                altitude = alt0 + (alt1 - alt0) * t
                azimuth = az0 + (az1 - az0) * t
                return altitude, azimuth

        # Past the end: return last keyframe
        return path[-1][1], path[-1][2]

    def update(self, race_progress: float) -> Optional[Dict]:
        """Update weather based on race progress.

        Called every frame, but only returns new weather params every
        UPDATE_EVERY_N_FRAMES frames.

        Args:
            race_progress: 0.0 to 1.0

        Returns:
            Dict of weather params to pass to carla_manager.set_weather_params(),
            or None if no update needed.
        """
        self._frame_counter += 1

        if self._frame_counter % self.UPDATE_EVERY_N_FRAMES != 0:
            return None

        # Don't update if progress hasn't changed meaningfully
        if abs(race_progress - self._last_progress) < 0.005:
            return None
        self._last_progress = race_progress

        altitude, azimuth = self._interpolate_sun(race_progress)

        # Dynamic cloudiness: slight build-up in the middle of the race
        cloudiness = self._base_cloudiness
        # Add a gentle cloud wave peaking at 60% progress
        cloud_wave = math.sin(race_progress * math.pi) * 20.0
        cloudiness = min(100.0, cloudiness + cloud_wave)

        # Optional: brief storm event at ~70% progress for dramatic effect
        precipitation = self._base_precipitation
        fog = self._base_fog
        wind = self._base_wind

        if (self.base_weather not in ('night', 'storm')
                and 0.65 < race_progress < 0.80
                and not self._storm_triggered
                and self.total_laps >= 3):
            # Brief dramatic rain burst in the final stretch
            self._storm_triggered = True
            # The rain will naturally fade as we pass 0.80

        if self._storm_triggered and 0.65 < race_progress < 0.80:
            storm_intensity = 1.0 - abs(race_progress - 0.725) / 0.075
            storm_intensity = max(0.0, min(1.0, storm_intensity))
            precipitation = max(precipitation, storm_intensity * 60.0)
            cloudiness = max(cloudiness, storm_intensity * 80.0)
            wind = max(wind, storm_intensity * 50.0)

        return {
            'sun_altitude': altitude,
            'sun_azimuth': azimuth,
            'cloudiness': cloudiness,
            'precipitation': precipitation,
            'fog_density': fog,
            'wind_intensity': wind,
        }
