"""
CARLA Manager - Manages dual vehicles, cameras, and race setup
Extended from v2's carla_client.py to support head-to-head racing
"""
import carla
import random
import time
import math
import threading
import numpy as np
from typing import Optional, Tuple, List, Dict
import yaml


class CameraBuffer:
    """Thread-safe buffer for the latest camera frame."""

    def __init__(self):
        self.frame: Optional[np.ndarray] = None
        self.raw_frame: Optional[bytes] = None
        self.lock = threading.Lock()
        self.frame_count = 0

    def update(self, carla_image):
        """Process CARLA image and store as RGB numpy array + raw BGRA bytes."""
        # Store raw BGRA bytes for NVENC encoding (zero-copy from CARLA)
        raw = bytes(carla_image.raw_data)
        array = np.frombuffer(carla_image.raw_data, dtype=np.uint8)
        array = array.reshape((carla_image.height, carla_image.width, 4))
        rgb = array[:, :, :3][:, :, ::-1].copy()
        with self.lock:
            self.frame = rgb
            self.raw_frame = raw
            self.frame_count += 1

    def get(self) -> Optional[np.ndarray]:
        """Get latest frame (thread-safe copy)."""
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def get_raw(self) -> Optional[bytes]:
        """Get latest raw BGRA frame bytes (immutable, no copy needed)."""
        with self.lock:
            return self.raw_frame


class RaceManager:
    """Manages a head-to-head race with two cars in CARLA."""

    def __init__(self, config_path: str = "configs/race.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)

        self.client: Optional[carla.Client] = None
        self.world: Optional[carla.World] = None

        # Vehicles
        self.player_car: Optional[carla.Vehicle] = None
        self.ai_car: Optional[carla.Vehicle] = None

        # Cameras
        self.chase_cam: Optional[carla.Sensor] = None
        self.ai_cam: Optional[carla.Sensor] = None
        self.rear_cam: Optional[carla.Sensor] = None

        # Frame buffers
        self.chase_buffer = CameraBuffer()
        self.ai_buffer = CameraBuffer()
        self.rear_buffer = CameraBuffer()

        # Actors to clean up
        self._actors: list = []

        # Whether AI uses CARLA autopilot vs model inference
        self._ai_autopilot = False

        # Collision sensor
        self._collision_sensor: Optional[carla.Sensor] = None
        self._collisions: List[Dict] = []
        self._collision_lock = threading.Lock()

        # Progressive input state (smooth ramping)
        self._current_throttle = 0.0
        self._current_brake = 0.0
        self._current_steer = 0.0

        # --- Driving assists state ---
        # Countersteer assist: tracks drift angle for logging
        self._drift_angle = 0.0
        self._countersteer_active = False

        # Traction control: tracks previous speed to detect wheel spin
        self._prev_speed_kmh = 0.0
        self._traction_control_active = False
        self._tc_throttle_cap = 1.0  # 1.0 = no cap
        self._tc_stuck_time = 0.0  # Time spent stuck with TC active
        self._tc_recovery_time = 0.0  # Recovery period: TC fully disabled

        # Handbrake drift: tracks state to only apply physics changes on transitions
        self._handbrake_was_active = False
        self._original_rear_friction: Optional[List[float]] = None

        # Drift boost: temporary 5% throttle multiplier after a drift with score > 200
        self._drift_boost_multiplier = 1.0
        self._drift_boost_end_time = 0.0

        # --- AI blocking behavior state (Hard difficulty) ---
        self._ai_blocking_active = False
        self._ai_blocking_log_counter = 0

        # Camera mode
        self._camera_mode = 'chase'
        self._camera_transforms = {
            'chase':  {'x': -6.0, 'z': 3.0, 'pitch': -15},
            'hood':   {'x': 0.5, 'z': 1.4, 'pitch': -5},
            'bumper': {'x': 2.0, 'z': 0.8, 'pitch': -3},
        }

        # Post-processing preset: "cinematic", "balanced", or "raw"
        # Presets configure motion blur, bloom, lens flare, and depth of field.
        # Depth of field blurs the background, which also dramatically improves
        # H.264 compression efficiency (80%+ fewer bits for out-of-focus areas).
        self._postprocess_preset = 'balanced'

        # Per-preset camera attribute configurations
        self._postprocess_presets = {
            'cinematic': {
                # Motion blur: subtle but visible at speed
                'motion_blur_intensity': '0.25',
                'motion_blur_max_distortion': '0.25',
                'motion_blur_min_object_screen_size': '0.1',
                # Bloom: warm cinematic glow
                'bloom_intensity': '0.5',
                # Lens flare: subtle
                'lens_flare_intensity': '0.05',
                # Depth of field: focus 10m ahead, shallow aperture
                'focal_distance': '1000.0',   # cm (10 meters)
                'fstop': '2.8',               # shallow DoF
                'blade_count': '5',           # bokeh shape
                # Tone mapping: S-curve for cinematic contrast
                'slope': '0.88',              # S-curve steepness
                'toe': '0.55',                # Dark crush
                'shoulder': '0.26',           # Bright rolloff
                'temp': '5800.0',             # Slightly warm color temperature
                # Exposure
                'enable_postprocess_effects': 'true',
            },
            'balanced': {
                # Motion blur: light
                'motion_blur_intensity': '0.2',
                'motion_blur_max_distortion': '0.2',
                'motion_blur_min_object_screen_size': '0.1',
                # Bloom: subtle
                'bloom_intensity': '0.4',
                # Lens flare: minimal
                'lens_flare_intensity': '0.05',
                # No depth of field (no focal_distance/fstop/blade_count)
                # Exposure
                'enable_postprocess_effects': 'true',
            },
            'raw': {
                # No post-processing at all - maximum clarity
            },
        }

    def connect(self) -> bool:
        """Connect to CARLA server."""
        cfg = self.config['carla']
        try:
            self.client = carla.Client(cfg['host'], cfg['port'])
            self.client.set_timeout(cfg['timeout'])
            self.world = self.client.get_world()
            print(f"Connected to CARLA at {cfg['host']}:{cfg['port']}")
            print(f"Map: {self.world.get_map().name}")
            return True
        except Exception as e:
            print(f"Failed to connect to CARLA: {e}")
            return False

    def setup_race(self, track: str = "Town03", player_car: str = None) -> bool:
        """Set up the race: load map, spawn cars, attach cameras."""
        if not self.world:
            print("Not connected to CARLA")
            return False

        try:
            # Load the requested map
            current_map = self.world.get_map().name
            if track not in current_map:
                print(f"Loading map: {track}")
                self.world = self.client.load_world(track)
                time.sleep(2)  # Wait for map to load

            # Set synchronous mode for deterministic simulation
            settings = self.world.get_settings()
            settings.synchronous_mode = True
            settings.fixed_delta_seconds = 1.0 / 30.0  # 30 FPS
            self.world.apply_settings(settings)

            # Destroy any orphaned actors from previous runs
            for actor in self.world.get_actors().filter('vehicle.*'):
                try:
                    actor.destroy()
                except Exception:
                    pass
            for actor in self.world.get_actors().filter('sensor.*'):
                try:
                    actor.destroy()
                except Exception:
                    pass
            time.sleep(0.5)

            # Get spawn points
            spawn_points = self.world.get_map().get_spawn_points()
            if len(spawn_points) < 2:
                print("Not enough spawn points")
                return False

            # Determine player vehicle model: use client-provided car or config default
            player_model = player_car or self.config['vehicle'].get('player_model', 'vehicle.tesla.model3')

            # Spawn player car
            self.player_car = self._spawn_vehicle(
                spawn_points[0],
                player_model
            )
            if not self.player_car:
                return False

            # Tune player car physics for snappier, more arcade-like feel
            try:
                physics = self.player_car.get_physics_control()
                # Reduce mass for quicker acceleration (default ~1800kg)
                physics.mass = max(1200.0, physics.mass * 0.7)
                # Increase torque curve for more power
                if physics.torque_curve:
                    boosted = []
                    for point in physics.torque_curve:
                        boosted.append(carla.Vector2D(point.x, point.y * 1.4))
                    physics.torque_curve = boosted

                # --- Improved tire friction model ---
                # Front tires: higher friction for responsive steering grip
                # Rear tires: matched friction for stability at high latency
                # Lateral stiffness tuned for keyboard input stability
                wheels = physics.wheels
                for i, wheel in enumerate(wheels):
                    is_front = (i < 2)  # wheels[0,1] = front, wheels[2,3] = rear
                    if is_front:
                        wheel.tire_friction = max(wheel.tire_friction, 4.0)
                        # Higher lateral stiffness on front = more grip in turns
                        wheel.lat_stiff_max_load = 3.5
                        wheel.lat_stiff_value = 22.0
                    else:
                        # Rear friction close to front = stable, less drift-prone
                        wheel.tire_friction = max(wheel.tire_friction, 3.8)
                        # Higher lateral stiffness on rear = less slide
                        wheel.lat_stiff_max_load = 3.0
                        wheel.lat_stiff_value = 20.0
                    # Stiffer damping for less bouncy feel over bumps
                    wheel.damping_rate = wheel.damping_rate * 1.3

                # Lower center of mass for stability (reduces roll in corners)
                physics.center_of_mass = carla.Vector3D(0.0, 0.0, -0.4)

                self.player_car.apply_physics_control(physics)

                # Store original rear friction for handbrake drift restore
                self._original_rear_friction = [
                    wheels[i].tire_friction for i in range(len(wheels)) if i >= 2
                ]

                print(f"Physics tuned: mass={physics.mass:.0f}kg, "
                      f"front_friction={wheels[0].tire_friction:.1f}, "
                      f"rear_friction={wheels[2].tire_friction:.1f}, "
                      f"front_lat_stiff={wheels[0].lat_stiff_value:.0f}, "
                      f"rear_lat_stiff={wheels[2].lat_stiff_value:.0f}")
            except Exception as e:
                print(f"Physics tuning failed (non-critical): {e}")

            # Spawn AI car next to player (offset sideways for side-by-side start)
            ai_spawn = carla.Transform(
                carla.Location(
                    x=spawn_points[0].location.x + spawn_points[0].get_right_vector().x * 4.0,
                    y=spawn_points[0].location.y + spawn_points[0].get_right_vector().y * 4.0,
                    z=spawn_points[0].location.z,
                ),
                spawn_points[0].rotation,
            )
            self.ai_car = self._spawn_vehicle(
                ai_spawn,
                self.config['vehicle'].get('ai_model', 'vehicle.audi.etron')
            )
            if not self.ai_car:
                return False

            # Attach chase camera to player car (streams to browser)
            chase_cfg = self.config['camera']['chase']
            self.chase_cam = self._attach_camera(
                self.player_car,
                width=chase_cfg['width'],
                height=chase_cfg['height'],
                fov=chase_cfg['fov'],
                x=chase_cfg['x'], y=0.0, z=chase_cfg['z'],
                pitch=chase_cfg['pitch'],
                callback=self.chase_buffer.update,
                cinematic=True
            )

            # Attach rear-view camera to player car (small mirror inset)
            rear_cfg = self.config['camera'].get('rear', {})
            self.rear_cam = self._attach_camera(
                self.player_car,
                width=rear_cfg.get('width', 320),
                height=rear_cfg.get('height', 120),
                fov=rear_cfg.get('fov', 110),
                x=rear_cfg.get('x', -2.0), y=0.0, z=rear_cfg.get('z', 2.0),
                pitch=rear_cfg.get('pitch', 0),
                callback=self.rear_buffer.update,
                yaw=180.0,  # Face backward
            )

            # Attach front camera to AI car (for model inference)
            ai_cfg = self.config['camera']['ai']
            self.ai_cam = self._attach_camera(
                self.ai_car,
                width=ai_cfg['width'],
                height=ai_cfg['height'],
                fov=ai_cfg['fov'],
                x=ai_cfg['x'], y=0.0, z=ai_cfg['z'],
                pitch=ai_cfg['pitch'],
                callback=self.ai_buffer.update
            )

            # Attach collision sensor to player car
            self._collision_sensor = self._attach_collision_sensor(self.player_car)

            # Tick several times to initialize cameras and let physics settle
            # CARLA needs multiple ticks after spawning for vehicle physics to activate
            for _ in range(10):
                self.world.tick()
            time.sleep(0.3)

            # Verify physics: apply brief throttle and check velocity
            test_control = carla.VehicleControl(throttle=0.5, steer=0.0, brake=0.0)
            self.player_car.apply_control(test_control)
            self.world.tick()
            vel = self.player_car.get_velocity()
            speed = 3.6 * math.sqrt(vel.x**2 + vel.y**2 + vel.z**2)
            print(f"Physics check: speed={speed:.1f} km/h after test throttle")

            # Reset: stop the car and clear controls
            self.player_car.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0))
            self.world.tick()
            self.player_car.apply_control(carla.VehicleControl(throttle=0.0, brake=0.0))
            self.player_car.set_target_velocity(carla.Vector3D(0, 0, 0))
            self.world.tick()

            print("Race setup complete: 2 cars + 3 cameras (chase + rear + AI)")
            return True

        except Exception as e:
            print(f"Race setup failed: {e}")
            return False

    def set_weather(self, weather: str):
        """Set weather conditions in the CARLA world.

        After applying the base weather preset, applies cinematic atmospheric
        effects (scattering, godrays, wet road reflections) to ALL presets
        for improved visual quality.
        """
        if not self.world:
            return
        presets = {
            'clear': carla.WeatherParameters.ClearNoon,
            'cloudy': carla.WeatherParameters.CloudyNoon,
            'rain': carla.WeatherParameters.MidRainyNoon,
            'storm': carla.WeatherParameters.HardRainNoon,
            'sunset': carla.WeatherParameters.ClearSunset,
            'night': carla.WeatherParameters.ClearNight,
        }
        weather_params = presets.get(weather, carla.WeatherParameters.ClearNoon)
        self.world.set_weather(weather_params)
        # Apply cinematic atmospheric effects on top of every preset
        self._apply_atmospheric_effects()
        print(f"Weather set to: {weather} (with atmospheric effects)")

    def _apply_atmospheric_effects(self):
        """Apply cinematic atmospheric effects to the current weather.

        Adds subtle depth haze, sun glare/godrays, and wet road reflections
        to improve visual quality in every weather condition. These effects
        are additive -- they enhance the existing weather preset without
        overriding its core parameters (sun position, cloudiness, rain, etc.).
        """
        if not self.world:
            return
        try:
            weather = self.world.get_weather()
            # Atmospheric haze: adds depth/distance effect
            weather.scattering_intensity = 0.5
            # Sun glare / godrays through atmosphere
            weather.mie_scattering_scale = 0.03
            # Wet road reflections (even in clear weather for realism)
            # Only boost if the preset hasn't already set a higher value
            weather.precipitation_deposits = max(weather.precipitation_deposits, 30.0)
            # Subtle road sheen
            weather.wetness = max(weather.wetness, 20.0)
            self.world.set_weather(weather)
        except Exception as e:
            print(f"Failed to apply atmospheric effects: {e}")

    def set_postprocess_preset(self, preset: str):
        """Set the post-processing preset for cameras.

        Supported presets:
            - "cinematic": depth of field + motion blur + bloom (best compression, most cinematic)
            - "balanced": light motion blur + bloom, no DoF (good compression, neutral look)
            - "raw": no post-processing (maximum clarity)

        Changes take effect on next camera attach (mode switch or race restart).

        Args:
            preset: One of "cinematic", "balanced", "raw".
        """
        if preset not in self._postprocess_presets:
            print(f"Unknown postprocess preset '{preset}', defaulting to 'balanced'")
            preset = 'balanced'

        old = self._postprocess_preset
        self._postprocess_preset = preset
        if old != preset:
            print(f"Post-processing preset changed: {old} -> {preset} "
                  "(takes effect on next camera attach)")

    def set_post_processing(self, enabled: bool):
        """Legacy toggle: sets preset to 'balanced' (enabled) or 'raw' (disabled).

        Args:
            enabled: True to enable post-processing, False to disable.
        """
        if enabled:
            if self._postprocess_preset == 'raw':
                self.set_postprocess_preset('balanced')
        else:
            self.set_postprocess_preset('raw')

    def configure_post_processing(self, settings: Dict[str, str]):
        """Update post-processing parameters for the current preset.

        Accepts a dict of camera blueprint attribute names to string values.
        Changes take effect on next camera attach (mode switch or race restart).

        Args:
            settings: Dict mapping attribute names to string values.
        """
        preset = self._postprocess_preset
        if preset == 'raw':
            print("Cannot configure post-processing while preset is 'raw'")
            return
        current = self._postprocess_presets.get(preset, {})
        for key, value in settings.items():
            current[key] = str(value)
        self._postprocess_presets[preset] = current
        print(f"Post-processing ({preset}) configured: {current}")

    def set_time_of_day(self, preset: str):
        """Set time-of-day lighting preset in CARLA.

        Configures sun position, cloudiness, and atmospheric effects for
        each time of day. Rain/wet road presets automatically enable
        CARLA's wet surface reflections via precipitation_deposits and wetness.

        Args:
            preset: One of 'morning', 'noon', 'sunset', 'night', 'storm'.
        """
        if not self.world:
            return

        presets = {
            'morning': {
                'sun_altitude_angle': 25.0,
                'sun_azimuth_angle': 90.0,
                'cloudiness': 20.0,
                'precipitation': 0.0,
                'precipitation_deposits': 0.0,
                'fog_density': 0.0,
                'wind_intensity': 0.0,
                'wetness': 0.0,
            },
            'noon': {
                'sun_altitude_angle': 75.0,
                'sun_azimuth_angle': 180.0,
                'cloudiness': 10.0,
                'precipitation': 0.0,
                'precipitation_deposits': 0.0,
                'fog_density': 0.0,
                'wind_intensity': 0.0,
                'wetness': 0.0,
            },
            'sunset': {
                'sun_altitude_angle': 5.0,
                'sun_azimuth_angle': 270.0,
                'cloudiness': 40.0,
                'precipitation': 0.0,
                'precipitation_deposits': 0.0,
                'fog_density': 5.0,
                'wind_intensity': 0.0,
                'wetness': 0.0,
            },
            'night': {
                'sun_altitude_angle': -30.0,
                'sun_azimuth_angle': 0.0,
                'cloudiness': 80.0,
                'precipitation': 0.0,
                'precipitation_deposits': 0.0,
                'fog_density': 0.0,
                'wind_intensity': 0.0,
                'wetness': 0.0,
            },
            'storm': {
                'sun_altitude_angle': 30.0,
                'sun_azimuth_angle': 180.0,
                'cloudiness': 90.0,
                'precipitation': 80.0,
                'precipitation_deposits': 50.0,
                'fog_density': 0.0,
                'wind_intensity': 80.0,
                'wetness': 100.0,
            },
            'rain': {
                'sun_altitude_angle': 40.0,
                'sun_azimuth_angle': 160.0,
                'cloudiness': 75.0,
                'precipitation': 60.0,
                'precipitation_deposits': 70.0,
                'fog_density': 5.0,
                'wind_intensity': 30.0,
                'wetness': 80.0,
            },
        }

        params = presets.get(preset)
        if not params:
            print(f"Unknown time_of_day preset: {preset}, ignoring")
            return

        try:
            weather = self.world.get_weather()
            weather.sun_altitude_angle = params['sun_altitude_angle']
            weather.sun_azimuth_angle = params['sun_azimuth_angle']
            weather.cloudiness = params['cloudiness']
            weather.precipitation = params['precipitation']
            weather.precipitation_deposits = params['precipitation_deposits']
            weather.fog_density = params['fog_density']
            weather.wind_intensity = params['wind_intensity']
            weather.wetness = params['wetness']
            self.world.set_weather(weather)
            # Apply cinematic atmospheric effects on top of time-of-day preset
            self._apply_atmospheric_effects()
            print(f"Time of day set to: {preset} "
                  f"(sun_alt={params['sun_altitude_angle']}, "
                  f"sun_az={params['sun_azimuth_angle']}, "
                  f"cloud={params['cloudiness']}, "
                  f"rain={params['precipitation']}, "
                  f"wet={params['wetness']})")
        except Exception as e:
            print(f"Failed to set time_of_day: {e}")

    def _spawn_vehicle(self, spawn_point, model: str) -> Optional[carla.Vehicle]:
        """Spawn a vehicle at the given transform."""
        bp_library = self.world.get_blueprint_library()
        vehicle_bp = bp_library.find(model)
        if vehicle_bp is None:
            vehicle_bp = random.choice(bp_library.filter('vehicle.*'))

        try:
            vehicle = self.world.spawn_actor(vehicle_bp, spawn_point)
            self._actors.append(vehicle)
            print(f"Spawned {vehicle_bp.id} at {spawn_point.location}")
            return vehicle
        except Exception as e:
            print(f"Failed to spawn vehicle: {e}")
            return None

    def _attach_camera(self, vehicle, width: int, height: int, fov: int,
                       x: float, y: float, z: float, pitch: float,
                       callback, cinematic: bool = False, yaw: float = 0.0) -> Optional[carla.Sensor]:
        """Attach RGB camera to vehicle.

        Args:
            cinematic: If True, apply post-processing attributes based on
                       self._postprocess_preset (motion blur, bloom, lens flare,
                       depth of field, histogram exposure).
            yaw: Rotation yaw in degrees (0 = forward, 180 = backward).
        """
        bp_library = self.world.get_blueprint_library()
        camera_bp = bp_library.find('sensor.camera.rgb')
        camera_bp.set_attribute('image_size_x', str(width))
        camera_bp.set_attribute('image_size_y', str(height))
        camera_bp.set_attribute('fov', str(fov))

        # Apply post-processing attributes based on the current preset
        preset = self._postprocess_preset
        if cinematic and preset != 'raw':
            pp = self._postprocess_presets.get(preset, {})
            applied = []
            skipped = []

            for attr_name, attr_value in pp.items():
                try:
                    # Verify the attribute exists on this blueprint before setting
                    camera_bp.get_attribute(attr_name)
                    camera_bp.set_attribute(attr_name, str(attr_value))
                    applied.append(f"{attr_name}={attr_value}")
                except Exception:
                    skipped.append(attr_name)

            # Histogram exposure for consistent brightness
            try:
                camera_bp.set_attribute('exposure_mode', 'histogram')
                camera_bp.set_attribute('shutter_speed', '60.0')
                camera_bp.set_attribute('iso', '100.0')
                applied.append('exposure=histogram')
            except Exception:
                skipped.append('exposure_mode')

            print(f"Post-processing [{preset}]: applied=[{', '.join(applied)}]"
                  + (f", skipped=[{', '.join(skipped)}]" if skipped else ""))
        elif cinematic:
            print(f"Post-processing [raw]: no effects applied")

        transform = carla.Transform(
            carla.Location(x=x, y=y, z=z),
            carla.Rotation(pitch=pitch, yaw=yaw)
        )

        try:
            camera = self.world.spawn_actor(camera_bp, transform, attach_to=vehicle)
            self._actors.append(camera)
            camera.listen(callback)
            print(f"Camera attached: {width}x{height}")
            return camera
        except Exception as e:
            print(f"Failed to attach camera: {e}")
            return None

    def _attach_collision_sensor(self, vehicle) -> Optional[carla.Sensor]:
        """Attach a collision sensor to a vehicle."""
        bp_library = self.world.get_blueprint_library()
        collision_bp = bp_library.find('sensor.other.collision')

        transform = carla.Transform(carla.Location(x=0, y=0, z=0))

        try:
            sensor = self.world.spawn_actor(collision_bp, transform, attach_to=vehicle)
            self._actors.append(sensor)
            sensor.listen(self._on_collision)
            print("Collision sensor attached to player car")
            return sensor
        except Exception as e:
            print(f"Failed to attach collision sensor: {e}")
            return None

    def _on_collision(self, event):
        """Callback for collision events. Stores significant collisions thread-safely."""
        impulse = event.normal_impulse
        intensity = math.sqrt(impulse.x**2 + impulse.y**2 + impulse.z**2)
        if intensity > 100:
            with self._collision_lock:
                self._collisions.append({
                    'intensity': intensity,
                    'timestamp': time.time(),
                })

    def get_recent_collisions(self) -> List[Dict]:
        """Return and clear stored collisions."""
        with self._collision_lock:
            collisions = self._collisions.copy()
            self._collisions.clear()
        return collisions

    def set_camera_mode(self, mode: str):
        """Switch the chase camera between chase/hood/bumper views.

        Destroys the current chase_cam sensor and re-attaches a new camera
        with the transform corresponding to the requested mode.
        """
        if mode not in self._camera_transforms:
            print(f"Unknown camera mode: {mode}")
            return

        if not self.player_car or not self.world:
            print("Cannot switch camera: no player car or world")
            return

        cam_params = self._camera_transforms[mode]
        chase_cfg = self.config['camera']['chase']

        # Destroy current chase cam
        if self.chase_cam is not None:
            try:
                if self.chase_cam in self._actors:
                    self._actors.remove(self.chase_cam)
                self.chase_cam.stop()
                self.chase_cam.destroy()
            except Exception as e:
                print(f"Error destroying old chase cam: {e}")
            self.chase_cam = None

        # Attach new camera with the mode's transform
        self.chase_cam = self._attach_camera(
            self.player_car,
            width=chase_cfg['width'],
            height=chase_cfg['height'],
            fov=chase_cfg['fov'],
            x=cam_params['x'], y=0.0, z=cam_params['z'],
            pitch=cam_params['pitch'],
            callback=self.chase_buffer.update,
            cinematic=True
        )

        self._camera_mode = mode
        print(f"Camera mode switched to: {mode}")

    def apply_player_control(self, keys: Dict[str, bool],
                             difficulty: str = 'medium',
                             next_checkpoint: Optional[Tuple[float, float]] = None,
                             latency_ms: Optional[float] = None):
        """Convert WASD keys to vehicle control with driving assists.

        Integrates:
        1. Progressive steering with smooth speed-dependent limits (exponential curve)
        2. Countersteer assist (auto-corrects when car is sliding)
        3. Traction control (reduces throttle on wheel spin)
        4. Handbrake drift mechanics (reduces rear tire friction)
        5. Speed-dependent steering ramp time (snappy at low speed, weighty at high speed)
        6. Auto-brake assist for Easy mode (brakes into sharp turns)
        7. Latency-adaptive steering (reduces steer_limit at high RTT to prevent wall-riding)

        Args:
            keys: Dict of WASD + space key states.
            difficulty: Current difficulty level ('easy', 'medium', 'hard').
            next_checkpoint: Optional (x, y) of the next checkpoint for auto-brake assist.
            latency_ms: Client-measured round-trip latency in milliseconds.
                        Used to reduce steering limit at high latency to prevent
                        overcorrection (wall-riding). None or 0 defaults to no reduction.
        """
        if not self.player_car:
            print("[CTRL] WARNING: player_car is None!")
            return

        self._ctrl_frame = getattr(self, '_ctrl_frame', 0) + 1

        dt = 1.0 / 30.0  # Approximate frame delta

        # Get current speed for speed-sensitive steering
        velocity = self.player_car.get_velocity()
        speed_kmh = 3.6 * math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2)

        # --- Throttle ramping ---
        if keys.get('w', False):
            # Near-instant throttle (~80ms to full) for arcade-like acceleration
            self._current_throttle = min(1.0, self._current_throttle + dt * 12.0)
        else:
            # Decay quickly (~70ms) so car responds to lift-off
            self._current_throttle = max(0.0, self._current_throttle - dt * 14.0)

        # --- Brake ramping ---
        if keys.get('s', False):
            # Near-instant brake (~60ms)
            self._current_brake = min(1.0, self._current_brake + dt * 16.0)
        else:
            self._current_brake = max(0.0, self._current_brake - dt * 10.0)

        # --- Feature 4: Smooth speed-dependent steering limits (exponential curve) ---
        # Replaces step-function thresholds with a continuous curve.
        # Exponential decay feels more natural than linear: rapid falloff in
        # the 0-80 km/h range where most turning happens, gentle tail at high speed.
        # steer_limit = 0.08 + (0.50 - 0.08) * exp(-speed / 70)
        # At 0 km/h:  0.08 + 0.42 * 1.0    = 0.50
        # At 30 km/h: 0.08 + 0.42 * 0.65   = 0.35
        # At 70 km/h: 0.08 + 0.42 * 0.37   = 0.23
        # At 120 km/h: 0.08 + 0.42 * 0.18  = 0.16
        # At 200 km/h: 0.08 + 0.42 * 0.057 = 0.10
        steer_limit = 0.08 + 0.42 * math.exp(-speed_kmh / 70.0)

        # --- Feature 7: Latency-adaptive steering ---
        # At high RTT (>80ms), reduce effective steering limit proportionally to
        # prevent overcorrection from delayed input. At 280ms, the player sees
        # frames from 280ms ago, so their steering decisions are always "late",
        # causing wall-riding. Reducing steer_limit compensates by making each
        # input smaller, giving more time to react.
        # Factor: 1.0 at 80ms, linearly decays to 0.3 at 380ms+
        latency_factor = 1.0
        if latency_ms is not None and latency_ms > 80:
            latency_factor = max(0.3, 1.0 - (latency_ms - 80) / 300)
        steer_limit *= latency_factor

        # --- Feature 5: Speed-dependent steering ramp time ---
        # Scale steering ramp duration with speed for GT7 "weight" feel.
        # ramp_ms = 40 + speed_kmh * 0.3
        #   At   0 km/h: 40ms  (very snappy for parking/reversing)
        #   At 100 km/h: 70ms  (moderate, responsive but not twitchy)
        #   At 200 km/h: 100ms (weighty, deliberate high-speed steering)
        # Convert ms to per-frame rate: to reach steer_limit in ramp_ms,
        # rate = steer_limit / (ramp_ms / 1000 * 30)  [at 30fps]
        ramp_ms = 40.0 + speed_kmh * 0.3
        ramp_frames = (ramp_ms / 1000.0) * 30.0  # Number of frames for the ramp
        # Attack rate: how much steer changes per frame toward the target
        steer_attack = steer_limit / max(ramp_frames, 1.0)
        # Release is slightly slower than attack (feels more natural)
        release_ms = ramp_ms * 1.3  # 30% slower release
        release_frames = (release_ms / 1000.0) * 30.0
        steer_release = steer_limit / max(release_frames, 1.0)

        if keys.get('a', False):
            target_steer = -steer_limit
            self._current_steer = max(target_steer, self._current_steer - steer_attack)
        elif keys.get('d', False):
            target_steer = steer_limit
            self._current_steer = min(target_steer, self._current_steer + steer_attack)
        else:
            # Return to center
            if self._current_steer > 0:
                self._current_steer = max(0.0, self._current_steer - steer_release)
            elif self._current_steer < 0:
                self._current_steer = min(0.0, self._current_steer + steer_release)

        # --- Handbrake ---
        hand_brake = keys.get('space', False)

        # --- Feature 5: Handbrake drift mechanics ---
        # Reduce rear tire friction when handbrake active, restore on release.
        # Only apply physics_control on state transitions to avoid per-frame cost.
        self._apply_handbrake_friction(hand_brake)

        # --- Feature 1: Countersteer assist ---
        # Compare heading (yaw) vs velocity direction to detect slides.
        # Only active when player is NOT pressing handbrake (handbrake = intentional drift).
        countersteer_correction = 0.0
        if not hand_brake and speed_kmh > 10.0:
            countersteer_correction = self._compute_countersteer(speed_kmh)

        # --- Feature 2: Traction control ---
        # Reduce throttle when wheels are spinning (low speed + high throttle + no acceleration)
        effective_throttle = self._current_throttle
        if self._current_throttle > 0.0:
            effective_throttle = self._apply_traction_control(
                self._current_throttle, speed_kmh, dt
            )

        # Update previous speed for next frame's traction control
        self._prev_speed_kmh = speed_kmh

        # --- Drift boost: apply temporary throttle multiplier after a good drift ---
        drift_boost = self._get_drift_boost_multiplier()
        if drift_boost > 1.0:
            effective_throttle = min(1.0, effective_throttle * drift_boost)

        # --- Combine steer with countersteer assist ---
        final_steer = self._current_steer + countersteer_correction
        final_steer = max(-1.0, min(1.0, final_steer))

        # --- Reverse if braking while slow or stopped ---
        # Only reverse when S is pressed WITHOUT W (W takes priority for forward).
        # Use the ramped brake value as reverse throttle for smooth transition
        # (the brake key has been ramping _current_brake, which we repurpose here).
        if keys.get('s', False) and not keys.get('w', False) and speed_kmh < 15.0:
            # Use brake ramp as reverse throttle (already 0.5-1.0 by the time we're slow)
            reverse_throttle = max(0.5, self._current_brake)
            control = carla.VehicleControl(
                throttle=reverse_throttle,
                steer=final_steer,
                brake=0.0,
                hand_brake=hand_brake,
                reverse=True
            )
            self.player_car.apply_control(control)
            # Log every 30th frame
            if self._ctrl_frame % 30 == 0:
                active = [k for k, v in keys.items() if v]
                print(f"[CTRL#{self._ctrl_frame}] REVERSE keys={active} spd={speed_kmh:.1f} "
                      f"thr={reverse_throttle:.2f} steer={control.steer:.2f} brk=0.0")
            return

        # --- Feature 6: Auto-brake assist — DISABLED for high-latency playability ---
        # At 280ms latency, auto-brake fights the player's inputs (applied 280ms
        # after the steering decision, when the turn situation has already changed).
        auto_brake = 0.0

        effective_brake = max(self._current_brake, auto_brake)

        control = carla.VehicleControl(
            throttle=effective_throttle,
            steer=final_steer,
            brake=effective_brake,
            hand_brake=hand_brake,
        )
        self.player_car.apply_control(control)

        # Diagnostic: log every 30th frame with full control + assist details
        if self._ctrl_frame % 30 == 0:
            active = [k for k, v in keys.items() if v]
            rb = self.player_car.get_control()
            assists = []
            if self._countersteer_active:
                assists.append(f"CS={countersteer_correction:+.3f}(drift={self._drift_angle:.1f}°)")
            if self._traction_control_active:
                assists.append(f"TC={self._tc_throttle_cap:.2f}")
            if self._handbrake_was_active:
                assists.append("HB_DRIFT")
            if auto_brake > 0.0:
                assists.append(f"AUTO_BRK={auto_brake:.2f}")
            if latency_factor < 1.0:
                assists.append(f"LAT_STEER={latency_factor:.2f}(rtt={latency_ms:.0f}ms)")
            assist_str = " | assists: " + ", ".join(assists) if assists else ""
            print(f"[CTRL#{self._ctrl_frame}] keys={active} spd={speed_kmh:.1f} "
                  f"steerLim={steer_limit:.2f} rampMs={ramp_ms:.0f} "
                  f"thr={control.throttle:.2f} steer={control.steer:.2f} brk={control.brake:.2f} | "
                  f"readback: thr={rb.throttle:.2f} steer={rb.steer:.2f} brk={rb.brake:.2f}"
                  f"{assist_str}")

    def _compute_countersteer(self, speed_kmh: float) -> float:
        """Compute countersteer correction based on drift angle.

        Compares the vehicle's heading (yaw) with its velocity direction.
        When these diverge (the car is sliding), returns a steering correction
        that pushes toward the velocity direction.

        Returns:
            Steering correction value in [-0.25, 0.25]. Positive = steer right.
        """
        transform = self.player_car.get_transform()
        velocity = self.player_car.get_velocity()

        # Velocity direction in degrees (CARLA uses left-handed coords: yaw 0 = +X)
        vel_mag = math.sqrt(velocity.x**2 + velocity.y**2)
        if vel_mag < 0.5:  # Nearly stopped, no meaningful velocity direction
            self._drift_angle = 0.0
            self._countersteer_active = False
            return 0.0

        vel_yaw = math.degrees(math.atan2(velocity.y, velocity.x))
        heading_yaw = transform.rotation.yaw

        # Compute signed angle difference (heading - velocity), wrapped to [-180, 180]
        drift_angle = heading_yaw - vel_yaw
        # Normalize to [-180, 180]
        while drift_angle > 180.0:
            drift_angle -= 360.0
        while drift_angle < -180.0:
            drift_angle += 360.0

        self._drift_angle = drift_angle
        abs_drift = abs(drift_angle)

        # Only activate above threshold (10 degrees — lower for high-latency stability)
        if abs_drift < 10.0:
            self._countersteer_active = False
            return 0.0

        self._countersteer_active = True

        # Scale correction strength with drift angle:
        # 10° -> 0.0 (just activated), 35°+ -> max correction (0.35)
        # Lower threshold + stronger correction for high-latency stability
        t = min(1.0, (abs_drift - 10.0) / 25.0)  # 0 at 10°, 1 at 35°
        # Smoothstep: 3t^2 - 2t^3 for natural feel
        t = t * t * (3.0 - 2.0 * t)

        max_correction = 0.35
        correction_magnitude = max_correction * t

        # Also scale down at very high speed so the assist doesn't overcorrect
        if speed_kmh > 100:
            speed_factor = max(0.3, 1.0 - (speed_kmh - 100) / 200.0)
            correction_magnitude *= speed_factor

        # Direction: if heading is to the RIGHT of velocity (positive drift_angle),
        # we need to steer LEFT (negative correction) to bring heading back toward velocity
        if drift_angle > 0:
            return -correction_magnitude
        else:
            return correction_magnitude

    def _compute_auto_brake(self, next_checkpoint: Tuple[float, float],
                            speed_kmh: float) -> float:
        """Compute auto-brake assist for Easy mode.

        When approaching a sharp turn (next checkpoint bearing > 60 degrees from
        current heading) at speed > 100 km/h, returns a brake value of 0.3.
        This makes Easy mode genuinely playable for beginners by preventing them
        from flying off the road at high speed into sharp corners.

        The assist is subtle: it never overrides harder player braking, only
        supplements it with a gentle 30% brake.

        Args:
            next_checkpoint: (x, y) position of the next checkpoint.
            speed_kmh: Current vehicle speed.

        Returns:
            Brake value: 0.3 if auto-brake conditions are met, 0.0 otherwise.
        """
        if not self.player_car:
            return 0.0

        transform = self.player_car.get_transform()
        car_x = transform.location.x
        car_y = transform.location.y
        heading_yaw = transform.rotation.yaw  # Degrees, CARLA convention

        cp_x, cp_y = next_checkpoint

        # Compute bearing to checkpoint
        dx = cp_x - car_x
        dy = cp_y - car_y
        bearing_to_cp = math.degrees(math.atan2(dy, dx))

        # Compute angle difference between heading and bearing, normalized to [-180, 180]
        angle_diff = bearing_to_cp - heading_yaw
        while angle_diff > 180.0:
            angle_diff -= 360.0
        while angle_diff < -180.0:
            angle_diff += 360.0

        abs_angle = abs(angle_diff)

        # Only auto-brake if the turn is sharp (> 60 degrees)
        if abs_angle > 60.0:
            return 0.3

        return 0.0

    def _apply_traction_control(self, throttle: float, speed_kmh: float, dt: float) -> float:
        """Traction control — DISABLED for high-latency playability.

        At 280ms latency, TC reduces throttle 280ms after wheel spin started,
        by which time the car may have already recovered. This makes the car
        feel sluggish ("driving through molasses") without preventing the spin.
        Re-enable when latency drops below ~100ms.
        """
        self._traction_control_active = False
        self._tc_throttle_cap = 1.0
        return throttle

    def activate_drift_boost(self, score: float):
        """Activate a temporary 5% throttle boost after a successful drift.

        Called by the race server when a drift ends with score > 200.
        The boost lasts 1.5 seconds and multiplies effective throttle by 1.05.

        Args:
            score: The drift score that triggered the boost.
        """
        self._drift_boost_multiplier = 1.05
        self._drift_boost_end_time = time.time() + 1.5
        print(f"[DRIFT BOOST] Activated! score={score:.0f}, 5% boost for 1.5s")

    def _get_drift_boost_multiplier(self) -> float:
        """Return the current drift boost throttle multiplier.

        Returns 1.05 if boost is active, otherwise 1.0.
        Automatically deactivates the boost when it expires.
        """
        if self._drift_boost_multiplier > 1.0:
            if time.time() >= self._drift_boost_end_time:
                self._drift_boost_multiplier = 1.0
                print("[DRIFT BOOST] Expired")
        return self._drift_boost_multiplier

    def _apply_handbrake_friction(self, handbrake_active: bool):
        """Manage rear tire friction for handbrake drifting.

        On handbrake press: reduce rear tire friction to 30% for slide-out.
        On handbrake release: restore original rear tire friction.
        Only applies physics_control on state transitions to avoid per-frame cost.
        """
        if not self.player_car:
            return

        # Detect state transition
        if handbrake_active and not self._handbrake_was_active:
            # Handbrake just pressed: reduce rear tire friction
            try:
                physics = self.player_car.get_physics_control()
                wheels = physics.wheels
                # Store original friction if we don't have it yet
                if self._original_rear_friction is None:
                    self._original_rear_friction = [
                        wheels[i].tire_friction for i in range(len(wheels)) if i >= 2
                    ]
                # Reduce rear wheel friction to 30% of original
                rear_idx = 0
                for i in range(len(wheels)):
                    if i >= 2:  # Rear wheels
                        if rear_idx < len(self._original_rear_friction):
                            wheels[i].tire_friction = self._original_rear_friction[rear_idx] * 0.3
                        rear_idx += 1
                physics.wheels = wheels
                self.player_car.apply_physics_control(physics)
                if self._ctrl_frame % 30 == 0:
                    print(f"[DRIFT] Handbrake ON: rear friction reduced to "
                          f"{wheels[2].tire_friction:.1f}")
            except Exception as e:
                print(f"[DRIFT] Failed to reduce rear friction: {e}")
            self._handbrake_was_active = True

        elif not handbrake_active and self._handbrake_was_active:
            # Handbrake just released: restore rear tire friction
            try:
                physics = self.player_car.get_physics_control()
                wheels = physics.wheels
                if self._original_rear_friction:
                    rear_idx = 0
                    for i in range(len(wheels)):
                        if i >= 2:  # Rear wheels
                            if rear_idx < len(self._original_rear_friction):
                                wheels[i].tire_friction = self._original_rear_friction[rear_idx]
                            rear_idx += 1
                    physics.wheels = wheels
                    self.player_car.apply_physics_control(physics)
                    if self._ctrl_frame % 30 == 0:
                        print(f"[DRIFT] Handbrake OFF: rear friction restored to "
                              f"{wheels[2].tire_friction:.1f}")
            except Exception as e:
                print(f"[DRIFT] Failed to restore rear friction: {e}")
            self._handbrake_was_active = False

    def enable_ai_autopilot(self, difficulty: str = 'medium'):
        """Enable CARLA's built-in autopilot for the AI car.
        Difficulty levels adjust autopilot aggressiveness:
          - easy:   Slow and cautious, follows some traffic rules
          - medium: 20% over speed limit, ignores lights, auto lane changes
          - hard:   55% over speed limit, ignores all rules, aggressive lane changes
        """
        if not self.ai_car or not self.client:
            return
        try:
            tm = self.client.get_trafficmanager()
            tm.set_synchronous_mode(True)
            self.ai_car.set_autopilot(True, tm.get_port())

            difficulty = difficulty.lower()

            if difficulty == 'easy':
                # Cautious driving: 10% slower than limit, sometimes follows rules
                speed_diff = 10.0  # 10% SLOWER than limit
                tm.ignore_lights_percentage(self.ai_car, 50.0)
                tm.ignore_signs_percentage(self.ai_car, 0.0)
                tm.ignore_walkers_percentage(self.ai_car, 0.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, speed_diff)
                tm.distance_to_leading_vehicle(self.ai_car, 5.0)
                tm.auto_lane_change(self.ai_car, False)
            elif difficulty == 'hard':
                # Maximum aggression: 55% over speed limit, ignores everything
                speed_diff = -55.0  # 55% faster than limit
                tm.ignore_lights_percentage(self.ai_car, 100.0)
                tm.ignore_signs_percentage(self.ai_car, 100.0)
                tm.ignore_walkers_percentage(self.ai_car, 100.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, speed_diff)
                tm.distance_to_leading_vehicle(self.ai_car, 1.0)
                tm.auto_lane_change(self.ai_car, True)
                # Force lane changes more aggressively by setting
                # a very short keep-right time (percentage-based)
                try:
                    tm.random_left_lanechange_percentage(self.ai_car, 50.0)
                    tm.random_right_lanechange_percentage(self.ai_car, 50.0)
                except Exception:
                    pass  # Older CARLA versions may not have these methods
            else:
                # Medium (default): 20% over speed limit, ignores lights, auto lane changes
                speed_diff = -20.0  # 20% faster than limit
                tm.ignore_lights_percentage(self.ai_car, 100.0)
                tm.ignore_signs_percentage(self.ai_car, 100.0)
                tm.ignore_walkers_percentage(self.ai_car, 100.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, speed_diff)
                tm.distance_to_leading_vehicle(self.ai_car, 2.0)
                tm.auto_lane_change(self.ai_car, True)

            # Store the base speed for dynamic adjustment
            self._base_speed_difference = speed_diff
            self._ai_autopilot = True
            print(f"AI car: using CARLA autopilot (difficulty={difficulty})")
        except Exception as e:
            print(f"Failed to enable autopilot: {e}")
            import traceback
            traceback.print_exc()

    def disable_ai_autopilot(self):
        """Disable CARLA's built-in autopilot for the AI car.
        Used when switching to neural network control (Medium difficulty).
        """
        if not self.ai_car:
            return
        try:
            self.ai_car.set_autopilot(False)
            self._ai_autopilot = False
            print("AI car: autopilot disabled (switching to neural network control)")
        except Exception as e:
            print(f"Failed to disable autopilot: {e}")

    def apply_neural_ai_control(self, steering: float, speed_kmh: float):
        """Apply neural network steering + rule-based throttle/brake to AI car.

        Used for Medium difficulty: the neural net provides steering predictions,
        and simple heuristics handle throttle and braking.

        Args:
            steering: Neural net steering prediction in [-1, 1]
            speed_kmh: Current AI car speed in km/h
        """
        if not self.ai_car or self._ai_autopilot:
            return

        abs_steer = abs(steering)
        throttle = 0.8
        brake = 0.0

        # Rule-based throttle/brake based on steering angle
        if abs_steer > 0.3:
            # Sharp turn: brake slightly, reduce throttle
            throttle = 0.3
            brake = 0.2
        elif abs_steer > 0.15:
            # Moderate turn: reduce throttle, no brake
            throttle = 0.5
            brake = 0.0
        # else: straight road, full throttle (0.8)

        # Speed limiting: brake if going too fast
        if speed_kmh > 120:
            throttle = max(0.1, throttle - 0.3)
            brake = max(brake, 0.3)
        elif speed_kmh > 100:
            throttle = max(0.2, throttle - 0.1)

        # Unstuck: if nearly stopped and not turning much, floor it
        if speed_kmh < 5.0 and abs_steer < 0.1:
            throttle = 1.0
            brake = 0.0

        control = carla.VehicleControl(
            throttle=max(0.0, min(1.0, throttle)),
            steer=max(-1.0, min(1.0, steering)),
            brake=max(0.0, min(1.0, brake)),
        )
        self.ai_car.apply_control(control)

    def adjust_ai_speed(self, speed_adjustment: float):
        """Dynamically adjust AI car speed via traffic manager.

        Args:
            speed_adjustment: Added to base speed_difference.
                             Positive = slower, negative = faster.
        """
        if not self.ai_car or not self.client or not self._ai_autopilot:
            return
        try:
            tm = self.client.get_trafficmanager()
            # Base speed comes from difficulty setting, adjustment modifies it
            base = getattr(self, '_base_speed_difference', -20)
            new_speed = base + speed_adjustment
            # Clamp to reasonable range: -60 (60% faster) to 20 (20% slower)
            new_speed = max(-60, min(20, new_speed))
            tm.vehicle_percentage_speed_difference(self.ai_car, new_speed)
        except Exception as e:
            pass  # Don't crash on TM errors

    def update_ai_blocking(self, difficulty: str, race_state) -> bool:
        """AI blocking behavior: on Hard difficulty, when the player is close
        behind the AI, slightly slow the AI to create a defensive 'blocking'
        feel and force the player to outbrake or find an alternative line.

        The mechanic works by:
        1. Computing the Euclidean distance between player and AI.
        2. Determining if the player is *behind* the AI (AI is ahead by
           checkpoint progress).
        3. When the player is within 5m behind the AI, reducing the AI
           speed by 2-3% via the traffic manager. This makes the AI
           appear to 'hold its line' defensively and creates exciting
           'I need to outbrake them!' moments.
        4. Disabling auto lane changes so the AI doesn't dodge out of
           the way.

        Only active on Hard difficulty. On other difficulties, ensures
        blocking state is cleared.

        Args:
            difficulty: Current difficulty level ('easy', 'medium', 'hard').
            race_state: RaceState object with current positions and progress.

        Returns:
            True if blocking is currently active.
        """
        if difficulty != 'hard' or not self.ai_car or not self.client or not self._ai_autopilot:
            if self._ai_blocking_active:
                self._ai_blocking_active = False
                # Restore normal lane change behavior
                try:
                    tm = self.client.get_trafficmanager()
                    tm.auto_lane_change(self.ai_car, True)
                except Exception:
                    pass
            return False

        if not race_state or not hasattr(race_state, 'player_x'):
            return False

        # Compute distance between player and AI
        dx = race_state.player_x - race_state.ai_x
        dy = race_state.player_y - race_state.ai_y
        distance = math.sqrt(dx * dx + dy * dy)

        # Determine who is ahead based on checkpoint/lap progress
        player_progress = (race_state.player_lap * len(race_state.checkpoints)
                           + (race_state.player_checkpoint % len(race_state.checkpoints)))
        ai_progress = (race_state.ai_lap * len(race_state.checkpoints)
                       + (race_state.ai_checkpoint % len(race_state.checkpoints)))
        ai_is_ahead = ai_progress > player_progress

        # Blocking condition: player within 5m AND AI is ahead
        should_block = distance < 5.0 and ai_is_ahead

        if should_block and not self._ai_blocking_active:
            # Activate blocking: slow AI by 3%, disable lane changes
            self._ai_blocking_active = True
            try:
                tm = self.client.get_trafficmanager()
                base = getattr(self, '_base_speed_difference', -55)
                # Add 3 percentage points (makes AI ~3% slower)
                tm.vehicle_percentage_speed_difference(self.ai_car, base + 3.0)
                # Lock lane so AI doesn't dodge out of the way
                tm.auto_lane_change(self.ai_car, False)
            except Exception as e:
                print(f"[AI-BLOCK] Failed to activate blocking: {e}")

            self._ai_blocking_log_counter += 1
            if self._ai_blocking_log_counter % 10 == 1:
                print(f"[AI-BLOCK] Blocking activated: distance={distance:.1f}m, "
                      f"player_progress={player_progress}, ai_progress={ai_progress}")

        elif not should_block and self._ai_blocking_active:
            # Deactivate blocking: restore normal speed and lane changes
            self._ai_blocking_active = False
            try:
                tm = self.client.get_trafficmanager()
                base = getattr(self, '_base_speed_difference', -55)
                tm.vehicle_percentage_speed_difference(self.ai_car, base)
                tm.auto_lane_change(self.ai_car, True)
            except Exception as e:
                print(f"[AI-BLOCK] Failed to deactivate blocking: {e}")

            if self._ai_blocking_log_counter % 10 == 0:
                print(f"[AI-BLOCK] Blocking deactivated: distance={distance:.1f}m")

        return self._ai_blocking_active

    def apply_ai_mistake(self, mistake: dict):
        """Apply a temporary mistake to the AI car by reducing its speed.

        For autopilot-driven AI, we temporarily increase the speed_difference
        to simulate the AI slowing down (braking late, hesitating, etc.)

        The mistake dict uses 'speed_penalty' (percentage points added to
        speed_difference, making the AI slower) rather than a multiplier.
        """
        if not self.ai_car or not self.client or not self._ai_autopilot:
            return
        try:
            tm = self.client.get_trafficmanager()
            base = getattr(self, '_base_speed_difference', -20)
            # speed_penalty is in percentage points: e.g., 25 means +25% to speed_difference
            # For base=-40 (40% over limit), adding 25 -> -15 (only 15% over limit)
            penalty = mistake.get('speed_penalty', 0.0)
            # Also support legacy 'speed_reduction' format for backwards compatibility
            if penalty == 0.0 and 'speed_reduction' in mistake:
                speed_factor = mistake['speed_reduction']
                if base < 0:
                    penalty = abs(base) * (1 - speed_factor)
                else:
                    penalty = (1 - speed_factor) * 20
            adjusted = base + penalty
            # Clamp: don't let AI go slower than 20% under the speed limit
            adjusted = min(adjusted, 20.0)
            tm.vehicle_percentage_speed_difference(self.ai_car, adjusted)
        except Exception:
            pass

    def apply_ai_control(self, prediction: Dict):
        """Apply model prediction to AI car. No-op if autopilot is active."""
        if not self.ai_car or self._ai_autopilot:
            return

        control = carla.VehicleControl(
            throttle=max(0.0, min(1.0, prediction.get('throttle', 0.5))),
            steer=max(-1.0, min(1.0, prediction.get('steering', 0.0))),
            brake=max(0.0, min(1.0, prediction.get('brake', 0.0))),
        )
        self.ai_car.apply_control(control)

    def respawn_player(self):
        """Respawn the player car at the nearest waypoint on the road."""
        if not self.player_car or not self.world:
            return

        try:
            # Get current location
            location = self.player_car.get_location()

            # Find nearest waypoint on the road
            carla_map = self.world.get_map()
            waypoint = carla_map.get_waypoint(location)

            if waypoint is None:
                print("No nearby waypoint found for respawn")
                return

            # Teleport player car to the waypoint's transform
            self.player_car.set_transform(waypoint.transform)

            # Reset velocity to zero
            self.player_car.set_target_velocity(carla.Vector3D(0, 0, 0))

            # Reset progressive input state
            self._current_throttle = 0.0
            self._current_brake = 0.0
            self._current_steer = 0.0

            # Reset driving assists state
            self._drift_angle = 0.0
            self._countersteer_active = False
            self._prev_speed_kmh = 0.0
            self._traction_control_active = False
            self._tc_throttle_cap = 1.0
            self._tc_stuck_time = 0.0
            self._tc_recovery_time = 0.0
            self._handbrake_was_active = False
            self._drift_boost_multiplier = 1.0
            self._drift_boost_end_time = 0.0

            print("Player respawned at nearest waypoint")
        except Exception as e:
            print(f"Failed to respawn player: {e}")

    def reset_to_start(self):
        """Teleport both cars back to the starting positions and zero their velocities.
        Used for instant race restart without full cleanup/respawn."""
        if not self.world or not self.player_car or not self.ai_car:
            print("Cannot reset to start: missing world or vehicles")
            return

        try:
            spawn_points = self.world.get_map().get_spawn_points()
            if len(spawn_points) < 1:
                print("No spawn points available for reset")
                return

            # Teleport player to first spawn point
            self.player_car.set_transform(spawn_points[0])
            self.player_car.set_target_velocity(carla.Vector3D(0, 0, 0))
            self.player_car.set_target_angular_velocity(carla.Vector3D(0, 0, 0))

            # Teleport AI car to offset position (same as initial setup)
            ai_transform = carla.Transform(
                carla.Location(
                    x=spawn_points[0].location.x + spawn_points[0].get_right_vector().x * 4.0,
                    y=spawn_points[0].location.y + spawn_points[0].get_right_vector().y * 4.0,
                    z=spawn_points[0].location.z,
                ),
                spawn_points[0].rotation,
            )
            self.ai_car.set_transform(ai_transform)
            self.ai_car.set_target_velocity(carla.Vector3D(0, 0, 0))
            self.ai_car.set_target_angular_velocity(carla.Vector3D(0, 0, 0))

            # Reset progressive input state
            self._current_throttle = 0.0
            self._current_brake = 0.0
            self._current_steer = 0.0

            # Reset driving assists state
            self._drift_angle = 0.0
            self._countersteer_active = False
            self._prev_speed_kmh = 0.0
            self._traction_control_active = False
            self._tc_throttle_cap = 1.0
            self._tc_stuck_time = 0.0
            self._tc_recovery_time = 0.0
            self._handbrake_was_active = False
            self._drift_boost_multiplier = 1.0
            self._drift_boost_end_time = 0.0

            # Reset AI blocking state
            self._ai_blocking_active = False
            self._ai_blocking_log_counter = 0

            # Clear collision buffer
            with self._collision_lock:
                self._collisions.clear()

            print("Both cars reset to starting positions")
        except Exception as e:
            print(f"Failed to reset to start: {e}")

    def get_telemetry(self, vehicle: carla.Vehicle) -> Dict:
        """Get telemetry for a vehicle including control state and velocity components."""
        transform = vehicle.get_transform()
        velocity = vehicle.get_velocity()
        control = vehicle.get_control()
        speed = 3.6 * math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2)

        return {
            'x': transform.location.x,
            'y': transform.location.y,
            'z': transform.location.z,
            'yaw': transform.rotation.yaw,
            'speed_kmh': speed,
            'gear': control.gear,
            'throttle': control.throttle,
            'brake': control.brake,
            'steer': control.steer,
            'rpm': speed * 40,  # Approximate RPM from speed
            'velocity_x': velocity.x,
            'velocity_y': velocity.y,
        }

    def set_weather_params(self, sun_altitude: float, sun_azimuth: float,
                           cloudiness: float = 0.0, precipitation: float = 0.0,
                           fog_density: float = 0.0, wind_intensity: float = 0.0):
        """Set granular weather parameters for dynamic weather transitions.

        Args:
            sun_altitude: Sun elevation angle (-90 to 90 degrees)
            sun_azimuth: Sun compass direction (0-360 degrees)
            cloudiness: Cloud coverage percentage (0-100)
            precipitation: Rain intensity (0-100)
            fog_density: Fog density percentage (0-100)
            wind_intensity: Wind strength (0-100)
        """
        if not self.world:
            return
        try:
            weather = self.world.get_weather()
            weather.sun_altitude_angle = sun_altitude
            weather.sun_azimuth_angle = sun_azimuth
            weather.cloudiness = cloudiness
            weather.precipitation = precipitation
            weather.precipitation_deposits = precipitation * 0.5  # Wet roads
            weather.fog_density = fog_density
            weather.wind_intensity = wind_intensity
            weather.wetness = min(100, precipitation * 0.8)
            self.world.set_weather(weather)
        except Exception as e:
            print(f"Failed to set weather params: {e}")

    def tick(self):
        """Advance simulation by one frame."""
        if self.world:
            self.world.tick()

    def get_chase_frame(self) -> Optional[np.ndarray]:
        """Get latest chase camera frame."""
        return self.chase_buffer.get()

    def get_chase_frame_raw(self) -> Optional[bytes]:
        """Get latest chase camera frame as raw BGRA bytes (for NVENC encoding)."""
        return self.chase_buffer.get_raw()

    def get_ai_frame(self) -> Optional[np.ndarray]:
        """Get latest AI camera frame (for model inference)."""
        return self.ai_buffer.get()

    def get_rear_frame(self) -> Optional[np.ndarray]:
        """Get latest rear-view camera frame."""
        return self.rear_buffer.get()

    def cleanup(self):
        """Destroy all actors and reset. Order matters to avoid SIGABRT:
        1. Disable autopilot (detach from traffic manager)
        2. Disable synchronous mode (so CARLA isn't waiting for ticks)
        3. Stop and destroy sensors first (they hold callbacks)
        4. Destroy vehicles last
        5. Small sleep between destructions to let CARLA process
        """
        print("Cleaning up CARLA actors...")

        # 1. Disable autopilot on AI car before touching traffic manager
        if self.ai_car is not None and self._ai_autopilot:
            try:
                self.ai_car.set_autopilot(False)
                print("  AI autopilot disabled")
            except Exception as e:
                print(f"  Warning: failed to disable autopilot: {e}")
            self._ai_autopilot = False

        # 2. Disable traffic manager synchronous mode
        if self.client is not None:
            try:
                tm = self.client.get_trafficmanager()
                tm.set_synchronous_mode(False)
                print("  Traffic manager sync mode disabled")
            except Exception as e:
                print(f"  Warning: failed to disable TM sync mode: {e}")

        # 3. Disable world synchronous mode BEFORE destroying actors
        if self.world:
            try:
                settings = self.world.get_settings()
                settings.synchronous_mode = False
                self.world.apply_settings(settings)
                print("  World sync mode disabled")
            except Exception as e:
                print(f"  Warning: failed to disable world sync mode: {e}")

        # 4. Separate sensors and vehicles for ordered destruction
        sensors = []
        vehicles = []
        for actor in self._actors:
            if hasattr(actor, 'stop') and hasattr(actor, 'listen'):
                sensors.append(actor)
            else:
                vehicles.append(actor)

        # 5. Stop and destroy sensors first
        for sensor in sensors:
            try:
                sensor.stop()
            except Exception as e:
                print(f"  Warning: failed to stop sensor: {e}")
            try:
                sensor.destroy()
                print(f"  Destroyed sensor {sensor.id}")
            except Exception as e:
                print(f"  Warning: failed to destroy sensor {sensor.id}: {e}")
            time.sleep(0.05)  # Small sleep between destructions

        # 6. Destroy vehicles
        for vehicle in reversed(vehicles):
            try:
                vehicle.destroy()
                print(f"  Destroyed vehicle {vehicle.id}")
            except Exception as e:
                print(f"  Warning: failed to destroy vehicle {vehicle.id}: {e}")
            time.sleep(0.05)

        self._actors.clear()
        self.player_car = None
        self.ai_car = None
        self.chase_cam = None
        self.ai_cam = None
        self.rear_cam = None
        self._collision_sensor = None
        with self._collision_lock:
            self._collisions.clear()

        # Reset progressive input state
        self._current_throttle = 0.0
        self._current_brake = 0.0
        self._current_steer = 0.0

        # Reset driving assists state
        self._drift_angle = 0.0
        self._countersteer_active = False
        self._prev_speed_kmh = 0.0
        self._traction_control_active = False
        self._tc_throttle_cap = 1.0
        self._tc_stuck_time = 0.0
        self._tc_recovery_time = 0.0
        self._handbrake_was_active = False
        self._drift_boost_multiplier = 1.0
        self._drift_boost_end_time = 0.0
        self._original_rear_friction = None

        # Reset AI blocking state
        self._ai_blocking_active = False
        self._ai_blocking_log_counter = 0

        print("Cleanup complete")

    def has_actors(self) -> bool:
        """Return True if there are any spawned actors."""
        return len(self._actors) > 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()
