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
        self.lock = threading.Lock()
        self.frame_count = 0

    def update(self, carla_image):
        """Process CARLA image and store as RGB numpy array."""
        array = np.frombuffer(carla_image.raw_data, dtype=np.uint8)
        array = array.reshape((carla_image.height, carla_image.width, 4))
        rgb = array[:, :, :3][:, :, ::-1].copy()
        with self.lock:
            self.frame = rgb
            self.frame_count += 1

    def get(self) -> Optional[np.ndarray]:
        """Get latest frame (thread-safe copy)."""
        with self.lock:
            return self.frame.copy() if self.frame is not None else None


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

        # Frame buffers
        self.chase_buffer = CameraBuffer()
        self.ai_buffer = CameraBuffer()

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

        # Camera mode
        self._camera_mode = 'chase'
        self._camera_transforms = {
            'chase':  {'x': -6.0, 'z': 3.0, 'pitch': -15},
            'hood':   {'x': 0.5, 'z': 1.4, 'pitch': -5},
            'bumper': {'x': 2.0, 'z': 0.8, 'pitch': -3},
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

    def setup_race(self, track: str = "Town03") -> bool:
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

            # Get spawn points
            spawn_points = self.world.get_map().get_spawn_points()
            if len(spawn_points) < 2:
                print("Not enough spawn points")
                return False

            # Spawn player car
            self.player_car = self._spawn_vehicle(
                spawn_points[0],
                self.config['vehicle'].get('player_model', 'vehicle.tesla.model3')
            )
            if not self.player_car:
                return False

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
                callback=self.chase_buffer.update
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

            # Tick once to initialize cameras
            self.world.tick()
            time.sleep(0.5)

            print("Race setup complete: 2 cars + 2 cameras")
            return True

        except Exception as e:
            print(f"Race setup failed: {e}")
            return False

    def set_weather(self, weather: str):
        """Set weather conditions in the CARLA world."""
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
        print(f"Weather set to: {weather}")

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
                       callback) -> Optional[carla.Sensor]:
        """Attach RGB camera to vehicle."""
        bp_library = self.world.get_blueprint_library()
        camera_bp = bp_library.find('sensor.camera.rgb')
        camera_bp.set_attribute('image_size_x', str(width))
        camera_bp.set_attribute('image_size_y', str(height))
        camera_bp.set_attribute('fov', str(fov))

        transform = carla.Transform(
            carla.Location(x=x, y=y, z=z),
            carla.Rotation(pitch=pitch)
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
            callback=self.chase_buffer.update
        )

        self._camera_mode = mode
        print(f"Camera mode switched to: {mode}")

    def apply_player_control(self, keys: Dict[str, bool]):
        """Convert WASD keys to vehicle control with progressive steering and ramping."""
        if not self.player_car:
            return

        dt = 1.0 / 30.0  # Approximate frame delta

        # Get current speed for speed-sensitive steering
        velocity = self.player_car.get_velocity()
        speed_kmh = 3.6 * math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2)

        # --- Throttle ramping ---
        if keys.get('w', False):
            # Ramp up over ~300ms
            self._current_throttle = min(1.0, self._current_throttle + dt * 3.3)
        else:
            # Decay over ~200ms
            self._current_throttle = max(0.0, self._current_throttle - dt * 5.0)

        # --- Brake ramping ---
        if keys.get('s', False):
            # Brake ramps faster: ~100ms
            self._current_brake = min(1.0, self._current_brake + dt * 10.0)
        else:
            self._current_brake = max(0.0, self._current_brake - dt * 5.0)

        # --- Speed-sensitive steering ---
        # Instant steering response (no ramp), clamped by speed
        if speed_kmh < 30:
            steer_limit = 0.7
        elif speed_kmh < 80:
            steer_limit = 0.4
        elif speed_kmh < 150:
            steer_limit = 0.25
        else:
            steer_limit = 0.15

        if keys.get('a', False):
            self._current_steer = -steer_limit
        elif keys.get('d', False):
            self._current_steer = steer_limit
        else:
            self._current_steer = 0.0

        # --- Handbrake ---
        hand_brake = keys.get('space', False)

        # --- Reverse if braking while slow or stopped ---
        if keys.get('s', False) and speed_kmh < 5.0:
            control = carla.VehicleControl(
                throttle=1.0,
                steer=max(-1.0, min(1.0, self._current_steer)),  # Same steering direction as forward
                brake=0.0,
                hand_brake=hand_brake,
                reverse=True
            )
            self.player_car.apply_control(control)
            return

        control = carla.VehicleControl(
            throttle=self._current_throttle,
            steer=max(-1.0, min(1.0, self._current_steer)),
            brake=self._current_brake,
            hand_brake=hand_brake,
        )
        self.player_car.apply_control(control)

    def enable_ai_autopilot(self, difficulty: str = 'medium'):
        """Enable CARLA's built-in autopilot for the AI car.
        Difficulty levels adjust autopilot aggressiveness:
          - easy:   Slow and cautious, follows some traffic rules
          - medium: 20% over speed limit, ignores lights, auto lane changes
          - hard:   50% over speed limit, ignores all rules, tailgates aggressively
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
                tm.ignore_lights_percentage(self.ai_car, 50.0)
                tm.ignore_signs_percentage(self.ai_car, 0.0)
                tm.ignore_walkers_percentage(self.ai_car, 0.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, 10.0)  # 10% SLOWER than limit
                tm.distance_to_leading_vehicle(self.ai_car, 5.0)
                tm.auto_lane_change(self.ai_car, False)
            elif difficulty == 'hard':
                # Maximum aggression: 50% over speed limit, ignores everything
                tm.ignore_lights_percentage(self.ai_car, 100.0)
                tm.ignore_signs_percentage(self.ai_car, 100.0)
                tm.ignore_walkers_percentage(self.ai_car, 100.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, -50.0)  # 50% faster than limit
                tm.distance_to_leading_vehicle(self.ai_car, 0.5)
                tm.auto_lane_change(self.ai_car, True)
            else:
                # Medium (default): 20% over speed limit, ignores lights, auto lane changes
                tm.ignore_lights_percentage(self.ai_car, 100.0)
                tm.ignore_signs_percentage(self.ai_car, 100.0)
                tm.ignore_walkers_percentage(self.ai_car, 100.0)
                tm.vehicle_percentage_speed_difference(self.ai_car, -20.0)  # 20% faster than limit
                tm.distance_to_leading_vehicle(self.ai_car, 2.0)
                tm.auto_lane_change(self.ai_car, True)

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

            print("Player respawned at nearest waypoint")
        except Exception as e:
            print(f"Failed to respawn player: {e}")

    def get_telemetry(self, vehicle: carla.Vehicle) -> Dict:
        """Get telemetry for a vehicle including control state."""
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
        }

    def tick(self):
        """Advance simulation by one frame."""
        if self.world:
            self.world.tick()

    def get_chase_frame(self) -> Optional[np.ndarray]:
        """Get latest chase camera frame."""
        return self.chase_buffer.get()

    def get_ai_frame(self) -> Optional[np.ndarray]:
        """Get latest AI camera frame (for model inference)."""
        return self.ai_buffer.get()

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
        self._collision_sensor = None
        with self._collision_lock:
            self._collisions.clear()

        # Reset progressive input state
        self._current_throttle = 0.0
        self._current_brake = 0.0
        self._current_steer = 0.0

        print("Cleanup complete")

    def has_actors(self) -> bool:
        """Return True if there are any spawned actors."""
        return len(self._actors) > 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()
