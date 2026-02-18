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

        # Progressive input state (smooth ramping)
        self._current_throttle = 0.0
        self._current_brake = 0.0
        self._current_steer = 0.0

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

            # Spawn AI car at adjacent spawn point
            ai_spawn = spawn_points[1]
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

            # Tick once to initialize cameras
            self.world.tick()
            time.sleep(0.5)

            print("Race setup complete: 2 cars + 2 cameras")
            return True

        except Exception as e:
            print(f"Race setup failed: {e}")
            return False

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
        # At high speeds, reduce max steering to prevent spin-outs
        if speed_kmh < 30:
            steer_limit = 1.0
        elif speed_kmh < 100:
            steer_limit = 0.7
        elif speed_kmh < 200:
            steer_limit = 0.4
        else:
            steer_limit = 0.2

        steer_rate = 3.0  # Steering change per second
        steer_decay = 5.0  # Return-to-center rate

        if keys.get('a', False):
            self._current_steer = max(-steer_limit, self._current_steer - steer_rate * dt)
        elif keys.get('d', False):
            self._current_steer = min(steer_limit, self._current_steer + steer_rate * dt)
        else:
            # Smoothly return to center
            if self._current_steer > 0:
                self._current_steer = max(0.0, self._current_steer - steer_decay * dt)
            elif self._current_steer < 0:
                self._current_steer = min(0.0, self._current_steer + steer_decay * dt)

        # --- Handbrake ---
        hand_brake = keys.get('space', False)

        # --- Reverse if braking while stopped ---
        if keys.get('s', False) and speed_kmh < 2.0:
            control = carla.VehicleControl(
                throttle=0.3,
                steer=max(-1.0, min(1.0, self._current_steer)),
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

    def apply_ai_control(self, prediction: Dict):
        """Apply model prediction to AI car."""
        if not self.ai_car:
            return

        control = carla.VehicleControl(
            throttle=max(0.0, min(1.0, prediction.get('throttle', 0.5))),
            steer=max(-1.0, min(1.0, prediction.get('steering', 0.0))),
            brake=max(0.0, min(1.0, prediction.get('brake', 0.0))),
        )
        self.ai_car.apply_control(control)

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
        """Destroy all actors and reset."""
        print("Cleaning up CARLA actors...")
        for actor in reversed(self._actors):
            try:
                if hasattr(actor, 'stop'):
                    actor.stop()
                actor.destroy()
            except Exception:
                pass
        self._actors.clear()
        self.player_car = None
        self.ai_car = None
        self.chase_cam = None
        self.ai_cam = None

        # Reset synchronous mode
        if self.world:
            settings = self.world.get_settings()
            settings.synchronous_mode = False
            self.world.apply_settings(settings)

        print("Cleanup complete")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()
