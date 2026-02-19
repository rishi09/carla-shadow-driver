#!/usr/bin/env python3
"""
Direct WebSocket test for Shadow Driver v3 server.
Bypasses the browser entirely — connects to the race server via WebSocket,
sends control messages, and reads telemetry to verify CARLA responds to all keys.
"""
import sys
import time
import json
import asyncio
import websockets

WS_URL = sys.argv[1] if len(sys.argv) > 1 else None
if not WS_URL:
    print("Usage: python3 test_ws_direct.py <ws_tunnel_url>")
    print("Example: python3 test_ws_direct.py wss://xxx.trycloudflare.com")
    sys.exit(1)

# Normalize URL
if WS_URL.startswith('https://'):
    WS_URL = WS_URL.replace('https://', 'wss://')
elif not WS_URL.startswith('ws'):
    WS_URL = 'wss://' + WS_URL


async def run_test():
    print(f"=== Direct WebSocket Control Test ===")
    print(f"Connecting to: {WS_URL}")

    async with websockets.connect(WS_URL) as ws:
        # 1. Handshake
        await ws.send(json.dumps({'type': 'handshake', 'client': 'test'}))
        resp = json.loads(await ws.recv())
        print(f"Handshake: {resp}")

        # 2. Start race
        await ws.send(json.dumps({
            'type': 'start_race',
            'track': 'Town03',
            'laps': 3,
            'weather': 'clear',
            'model': 'carla_pilotnet',
        }))
        print("Sent start_race")

        # 3. Wait for race_state messages and read telemetry
        latest_telem = None
        race_started = False

        async def recv_loop():
            nonlocal latest_telem, race_started
            while True:
                msg = await ws.recv()
                if isinstance(msg, bytes):
                    continue  # Skip JPEG frames
                data = json.loads(msg)
                if data.get('type') == 'race_state':
                    latest_telem = data
                    if data.get('race_status') == 'racing' and not race_started:
                        race_started = True

        # Start receiving in background
        recv_task = asyncio.create_task(recv_loop())

        # Helper to send controls at 30Hz for N seconds
        async def hold_keys(keys, duration, label):
            print(f"\n--- {label} ---")
            msg = {'type': 'control', 'keys': keys}
            start = time.time()
            report_interval = 1.0
            next_report = start + report_interval
            while time.time() - start < duration:
                await ws.send(json.dumps(msg))
                await asyncio.sleep(1/30)
                if time.time() >= next_report:
                    elapsed = time.time() - start
                    if latest_telem:
                        p = latest_telem.get('player', {})
                        print(f"  [{elapsed:.0f}s] speed={p.get('speed_kmh', '?')} "
                              f"thr={p.get('throttle', '?')} steer={p.get('steer', '?')} "
                              f"brake={p.get('brake', '?')}")
                    else:
                        print(f"  [{elapsed:.0f}s] no telemetry yet")
                    next_report += report_interval

        # Wait for countdown to finish
        print("Waiting for countdown...")
        while not race_started:
            # Send empty controls during countdown
            await ws.send(json.dumps({'type': 'control', 'keys': {'w': False, 'a': False, 's': False, 'd': False, 'space': False}}))
            await asyncio.sleep(0.1)
        print("Race started!")

        # TEST 1: W only (5 seconds) — should see speed increase
        await hold_keys({'w': True, 'a': False, 's': False, 'd': False, 'space': False}, 5, "TEST 1: W only (throttle)")

        # TEST 2: W+A (4 seconds) — should see negative steer
        await hold_keys({'w': True, 'a': True, 's': False, 'd': False, 'space': False}, 4, "TEST 2: W+A (steer LEFT)")

        # TEST 3: W+D (4 seconds) — should see positive steer
        await hold_keys({'w': True, 'a': False, 's': False, 'd': True, 'space': False}, 4, "TEST 3: W+D (steer RIGHT)")

        # TEST 4: No keys (2 seconds) — should see car coasting
        await hold_keys({'w': False, 'a': False, 's': False, 'd': False, 'space': False}, 2, "TEST 4: No keys (coast)")

        # TEST 5: S only (3 seconds) — should brake then reverse
        await hold_keys({'w': False, 'a': False, 's': True, 'd': False, 'space': False}, 3, "TEST 5: S only (brake/reverse)")

        # TEST 6: Respawn + W+A (test after respawn)
        print("\n--- TEST 6: Respawn + W+A ---")
        await ws.send(json.dumps({'type': 'respawn'}))
        print("  Sent respawn")
        await asyncio.sleep(1)
        await hold_keys({'w': True, 'a': True, 's': False, 'd': False, 'space': False}, 4, "TEST 6: W+A after respawn")

        # Done
        recv_task.cancel()
        print("\n=== ALL TESTS COMPLETE ===")
        print("Check server logs: tail -60 /tmp/race.log")


asyncio.run(run_test())
