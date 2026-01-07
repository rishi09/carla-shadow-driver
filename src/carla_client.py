"""
CARLA Client - Handles connection and vehicle control
"""
import carla
import random
import time
from typing import Optional, Tuple
import yaml


class CarlaClient:
    """Manages connection to CARLA server and vehicle spawning."""

    def __init__(self, config_path: str = "configs/default.yaml"):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)

        self.client: Optional[carla.Client] = None
        self.world: Optional[carla.World] = None
        self.vehicle: Optional[carla.Vehicle] = None
        self.camera: Optional[carla.Sensor] = None

        self._camera_callback = None

    def connect(self) -> bool:
        """Connect to CARLA server."""
        cfg = self.config['carla']
        try:
            self.client = carla.Client(cfg['host'], cfg['port'])
            self.client.set_timeout(cfg['timeout'])
            self.world = self.client.get_world()
            print(f"Connected to CARLA server at {cfg['host']}:{cfg['port']}")
            print(f"Map: {self.world.get_map().name}")
            return True
        except Exception as e:
            print(f"Failed to connect: {e}")
            return False

    def spawn_vehicle(self, model: Optional[str] = None) -> bool:
        """Spawn a vehicle in the world."""
        if not self.world:
            print("Not connected to CARLA")
            return False

        model = model or self.config['vehicle']['model']
        blueprint_library = self.world.get_blueprint_library()

        # Find vehicle blueprint
        vehicle_bp = blueprint_library.find(model)
        if vehicle_bp is None:
            print(f"Vehicle model '{model}' not found, using random vehicle")
            vehicle_bp = random.choice(blueprint_library.filter('vehicle.*'))

        # Get spawn point
        spawn_points = self.world.get_map().get_spawn_points()
        spawn_point = self.config['vehicle'].get('spawn_point')
        if spawn_point is None:
            spawn_point = random.choice(spawn_points)
        else:
            spawn_point = spawn_points[spawn_point % len(spawn_points)]

        # Spawn vehicle
        try:
            self.vehicle = self.world.spawn_actor(vehicle_bp, spawn_point)
            print(f"Spawned {vehicle_bp.id} at {spawn_point.location}")
            return True
        except Exception as e:
            print(f"Failed to spawn vehicle: {e}")
            return False

    def attach_camera(self, callback) -> bool:
        """Attach RGB camera to vehicle."""
        if not self.vehicle:
            print("No vehicle to attach camera to")
            return False

        cfg = self.config['camera']
        blueprint_library = self.world.get_blueprint_library()

        # Create camera blueprint
        camera_bp = blueprint_library.find('sensor.camera.rgb')
        camera_bp.set_attribute('image_size_x', str(cfg['width']))
        camera_bp.set_attribute('image_size_y', str(cfg['height']))
        camera_bp.set_attribute('fov', str(cfg['fov']))
        camera_bp.set_attribute('sensor_tick', str(1.0 / cfg['fps']))

        # Camera transform (relative to vehicle)
        pos = cfg['position']
        camera_transform = carla.Transform(
            carla.Location(x=pos['x'], y=pos['y'], z=pos['z']),
            carla.Rotation(pitch=-10)  # Slight downward angle
        )

        # Spawn and attach camera
        try:
            self.camera = self.world.spawn_actor(
                camera_bp,
                camera_transform,
                attach_to=self.vehicle
            )
            self._camera_callback = callback
            self.camera.listen(callback)
            print(f"Camera attached: {cfg['width']}x{cfg['height']} @ {cfg['fps']}fps")
            return True
        except Exception as e:
            print(f"Failed to attach camera: {e}")
            return False

    def apply_control(self, throttle: float = 0.0, steer: float = 0.0,
                      brake: float = 0.0, hand_brake: bool = False):
        """Apply control input to vehicle."""
        if not self.vehicle:
            return

        control = carla.VehicleControl(
            throttle=max(0.0, min(1.0, throttle)),
            steer=max(-1.0, min(1.0, steer)),
            brake=max(0.0, min(1.0, brake)),
            hand_brake=hand_brake
        )
        self.vehicle.apply_control(control)

    def get_telemetry(self) -> dict:
        """Get current vehicle telemetry."""
        if not self.vehicle:
            return {}

        transform = self.vehicle.get_transform()
        velocity = self.vehicle.get_velocity()
        control = self.vehicle.get_control()

        # Calculate speed in km/h
        speed = 3.6 * (velocity.x**2 + velocity.y**2 + velocity.z**2)**0.5

        return {
            'location': {
                'x': transform.location.x,
                'y': transform.location.y,
                'z': transform.location.z
            },
            'rotation': {
                'pitch': transform.rotation.pitch,
                'yaw': transform.rotation.yaw,
                'roll': transform.rotation.roll
            },
            'speed_kmh': speed,
            'throttle': control.throttle,
            'steer': control.steer,
            'brake': control.brake
        }

    def cleanup(self):
        """Destroy actors and disconnect."""
        if self.camera:
            self.camera.stop()
            self.camera.destroy()
            self.camera = None

        if self.vehicle:
            self.vehicle.destroy()
            self.vehicle = None

        print("Cleaned up CARLA actors")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()
