"""
Test connection to CARLA server
Run this after setting up SSH tunnel to verify everything works
"""
import sys
import time

# Check if carla module is available
try:
    import carla
except ImportError:
    print("ERROR: CARLA Python module not found")
    print("")
    print("To install, you need to download the CARLA Python package:")
    print("  pip install carla==0.9.16")
    print("")
    print("If that fails, download from:")
    print("  https://github.com/carla-simulator/carla/releases")
    print("  and install the .whl file from PythonAPI/carla/dist/")
    sys.exit(1)


def test_connection(host: str = "localhost", port: int = 2000):
    """Test connection to CARLA server."""
    print("=" * 50)
    print("CARLA Connection Test")
    print("=" * 50)
    print(f"\nConnecting to {host}:{port}...")

    try:
        client = carla.Client(host, port)
        client.set_timeout(10.0)

        # Get server info
        server_version = client.get_server_version()
        client_version = client.get_client_version()

        print(f"\n  Server version: {server_version}")
        print(f"  Client version: {client_version}")

        if server_version != client_version:
            print("\n  WARNING: Version mismatch! This may cause issues.")

        # Get world info
        world = client.get_world()
        map_name = world.get_map().name

        print(f"\n  Current map: {map_name}")

        # Count available assets
        bp_library = world.get_blueprint_library()
        vehicles = len(list(bp_library.filter('vehicle.*')))
        sensors = len(list(bp_library.filter('sensor.*')))

        print(f"  Available vehicles: {vehicles}")
        print(f"  Available sensors: {sensors}")

        # Test spawning capability
        spawn_points = world.get_map().get_spawn_points()
        print(f"  Spawn points: {len(spawn_points)}")

        print("\n" + "=" * 50)
        print("CONNECTION SUCCESSFUL!")
        print("=" * 50)
        print("\nYou can now run: python src/shadow_mode.py")

        return True

    except Exception as e:
        print(f"\nCONNECTION FAILED: {e}")
        print("\nTroubleshooting:")
        print("  1. Is CARLA server running on Vast.ai?")
        print("     Check with: docker logs carla-server")
        print("")
        print("  2. Is SSH tunnel active?")
        print("     ssh -L 2000:localhost:2000 -L 2001:localhost:2001 ...")
        print("")
        print("  3. Wait 30-60 seconds after starting CARLA server")
        return False


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 2000
    test_connection(host, port)
