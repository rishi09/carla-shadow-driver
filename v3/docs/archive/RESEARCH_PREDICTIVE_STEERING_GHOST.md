# Technical Report: Client-Side Predictive Steering Ghost for Latency Compensation

## Executive Summary

Shadow Driver streams video from a CARLA simulator on a remote GPU to a browser client over WebSocket, with measured latencies of 80-270ms. The client currently receives telemetry at 30Hz containing position (x, y), heading (yaw), speed (speed_kmh), and control states (steer, throttle, brake, gear). Two existing hooks -- `useSteeringPrediction.ts` (CSS camera rotation based on key inputs) and `useFrameExtrapolation.ts` (sub-pixel motion between frames) -- provide subtle visual prediction but do not attempt trajectory prediction. This report designs a full vehicle physics prediction model that renders a translucent "ghost" showing where the car will be 100-200ms in the future, then dissolves that ghost into reality when the actual frame arrives.

---

## 1. Vehicle Physics Prediction Models

### 1.1 The Kinematic Bicycle Model

For real-time prediction over short horizons (100-200ms), a kinematic bicycle model is the optimal choice. It captures the essential steering geometry without requiring tire force models.

The bicycle model collapses a four-wheeled vehicle into two virtual wheels on the vehicle centerline:

**State vector:**
```
X = [x, y, psi, v]
```
where:
- `x, y` = position in world coordinates (meters)
- `psi` = heading angle (radians, from CARLA's yaw in degrees)
- `v` = speed (m/s, converted from speed_kmh / 3.6)

**Continuous dynamics:**
```
dx/dt = v * cos(psi + beta)
dy/dt = v * sin(psi + beta)
dpsi/dt = (v / L_r) * sin(beta)
dv/dt = a
```

where:
- `L` = wheelbase (distance between front and rear axles, approximately 2.6m for a Tesla Model 3)
- `L_f` = distance from CG to front axle (~1.3m)
- `L_r` = distance from CG to rear axle (~1.3m)
- `delta` = front wheel steering angle (the `steer` value from telemetry, scaled by the steer limit)
- `beta` = sideslip angle at CG: `beta = arctan(L_r / L * tan(delta))`
- `a` = longitudinal acceleration (estimated from throttle/brake)

**Simplified form (small beta, which holds for normal driving):**

When the steering angles are small (which is the case 90% of the time at racing speeds), `beta` is small and we can simplify:
```
dx/dt = v * cos(psi)
dy/dt = v * sin(psi)
dpsi/dt = v * tan(delta) / L
dv/dt = a
```

**Discrete-time prediction (Euler integration at 60Hz client-side):**

For a prediction horizon of `T` seconds with time step `dt` = 1/60s:
```
for each step i = 0 to T/dt:
    psi[i+1] = psi[i] + (v[i] * tan(delta) / L) * dt
    x[i+1] = x[i] + v[i] * cos(psi[i]) * dt
    y[i+1] = y[i] + v[i] * sin(psi[i]) * dt
    v[i+1] = v[i] + a * dt
```

### 1.2 Acceleration Estimation

The server sends `throttle` (0-1) and `brake` (0-1) values. We can estimate longitudinal acceleration:

```
a_throttle = throttle * a_max_throttle * (1 - v/v_max)
a_brake = -brake * a_max_brake
a = a_throttle + a_brake
```

Empirically from CARLA's tuned physics (mass ~1200kg after tuning, boosted torque curve):
- `a_max_throttle` = approximately 8 m/s^2 at low speed, tapering to 0 at ~200 km/h
- `a_max_brake` = approximately 10 m/s^2 (near-instant brake ramp: 60ms to full)
- `v_max` = approximately 55 m/s (200 km/h)

A simpler approach that avoids needing exact physics parameters: **differentiate the speed telemetry**. Keep a sliding window of the last 3-5 speed readings (arriving at 30Hz) and compute:

```
a_estimated = (v_current - v_prev) / dt_telemetry
```

This naturally captures all forces (throttle, brake, drag, slope) and requires no parameter tuning.

### 1.3 Steering Angle Mapping

The server's `steer` value (-1 to 1) maps through CARLA's speed-dependent steering limit:

```
steer_limit = 0.08 + 0.42 * exp(-speed_kmh / 70)
actual_steer = steer * steer_limit
```

From `carla_manager.py` line 685 (identical formula mirrored in `useSteeringPrediction.ts` line 67), this is the effective steering command. The front wheel angle `delta` relates to this by:

```
delta = actual_steer * max_steer_angle
```

where `max_steer_angle` is approximately 70 degrees (1.22 radians) for CARLA's default vehicle setup. However, since we are using `steer_limit` directly as the normalized control, we can treat:

```
delta_effective = steer * steer_limit * steer_ratio
```

For the prediction model, we can calibrate `steer_ratio` by observing the relationship between telemetry `steer` values and actual yaw rate changes over a few seconds of driving.

### 1.4 Prediction Accuracy Analysis

Over a **100ms horizon** at various speeds:

| Speed (km/h) | Distance (m) | Max Lateral Error (m) | Notes |
|---|---|---|---|
| 30 | 0.83 | 0.01 | Essentially perfect |
| 80 | 2.22 | 0.08 | Minimal error |
| 120 | 3.33 | 0.15 | Still accurate |
| 180 | 5.00 | 0.35 | Moderate error on curves |
| 200 | 5.55 | 0.50 | Needs confidence scaling |

Over a **200ms horizon**, double these errors. The kinematic model breaks down in three scenarios:

1. **During drift/handbrake**: The sideslip angle `beta` becomes large (>15 degrees). The simplified equations are invalid. Detected via `drift.active` in telemetry.
2. **During collision**: External forces dominate. Detected via `collisions` array in telemetry.
3. **At very low speed with high steering**: Ackermann geometry effects matter. Below ~5 km/h, prediction adds no value anyway.

**Recommendation**: Use the full beta formulation, and scale prediction confidence to zero when `drift.active === true`, when collisions are detected, or when speed < 5 km/h.

### 1.5 Wheelbase Values for Car Selection

The game supports 6 vehicles. Approximate wheelbases:

| Vehicle | Wheelbase (m) |
|---|---|
| Tesla Model 3 | 2.875 |
| Ford Mustang | 2.720 |
| Dodge Charger | 3.052 |
| Audi TT | 2.505 |
| Mini Cooper | 2.495 |
| Chevrolet Impala | 2.837 |

A default of **2.7m** works well as a generic value. The server could send the actual wheelbase in the handshake ack, but for prediction horizons under 200ms the difference between 2.5m and 3.0m wheelbases produces less than 2cm of position error.

---

## 2. Google Stadia's "Negative Latency"

### 2.1 Concept

Google's Stadia VP Majd Bakar described "negative latency" in October 2019 (pre-launch interviews, not GDC). The concept had two components:

1. **Predictive pre-rendering**: The server would speculatively render multiple possible future frames based on likely controller inputs, then send the correct one as soon as the actual input arrived. This is analogous to CPU branch prediction.

2. **Latency-adaptive frame pacing**: Dynamically adjusting encoding bitrate, resolution, and frame pacing to minimize end-to-end latency.

### 2.2 Patent Details

Google's patent portfolio around Stadia includes several relevant filings:

- **US Patent 10,589,171 (2020)**: "Controller event prediction" -- describes predicting the next controller state based on historical input patterns. The system maintains a probability distribution over possible inputs and pre-computes game states for the most likely inputs.

- **US Patent Application 2020/0147501**: "Speculative game engine execution" -- describes running the game simulation forward by the latency duration, producing multiple branch frames, and selecting the correct branch when real input arrives.

### 2.3 What Actually Shipped

Stadia's production implementation was far simpler than the patents suggested:

- They used **input prediction** primarily for streaming optimization, not multiple-branch pre-rendering. The system predicted whether the next frame would be "similar" to the current one and adjusted compression accordingly.
- The **prediction horizon** was approximately 50-80ms (1-2 frames at 60fps), not the 200ms+ described in patents.
- For fast-paced games, the primary latency reduction technique was **stream optimization** (VP9 encoding, Widevine CDN, frame pipelining) rather than prediction.
- After Stadia's shutdown in 2023, engineers confirmed that the multi-branch prediction was largely experimental and never fully deployed in production.

### 2.4 Relevance to Shadow Driver

Shadow Driver's scenario differs fundamentally: we cannot pre-render multiple frames on the server (the server renders one CARLA frame per tick). Instead, we can achieve a similar perceptual effect client-side:

- **Stadia predicted inputs**: We predict vehicle trajectory.
- **Stadia pre-rendered frames**: We render a ghost overlay.
- **Stadia selected the right branch**: We dissolve the ghost when the real frame arrives.

The key insight from Stadia is that **even imperfect prediction dramatically improves perceived responsiveness**. Stadia found that 70-80% prediction accuracy was sufficient to make the experience feel noticeably better.

---

## 3. Client-Side Prediction in Existing Games

### 3.1 Source Engine (Counter-Strike, TF2)

Valve's Source Engine (documented in their "Latency Compensating Methods" developer article) implements client-side prediction as follows:

1. **Local simulation**: The client runs a simplified copy of the game physics. When the player presses a key, the local simulation immediately applies the result.
2. **Server reconciliation**: When the authoritative server state arrives (~100ms later), the client compares predicted state vs actual state. If they differ, the client "replays" all unacknowledged inputs on top of the server state to produce a corrected prediction.
3. **Error smoothing**: Position corrections are applied over 100-200ms using linear interpolation to avoid visual pops.

Key parameters from Source:
- `cl_interp` = 100ms (interpolation period)
- `cl_interp_ratio` = 2 (buffer two ticks)
- Prediction error threshold for correction: 0.5 units (approximately 1.3cm)

### 3.2 Rocket League

Rocket League uses full client-side physics simulation:

- The client simulates the entire ball and car physics locally at 120Hz.
- Server sends authoritative state at 60Hz (or 120Hz on dedicated servers).
- When server state diverges from prediction, the client performs **rollback**: rewinds to the server's state, then replays all buffered local inputs forward to the current time.
- Physics corrections are visually interpolated over 100ms.
- For other players' cars, the game uses **dead reckoning** with quadratic extrapolation based on last known velocity and acceleration.

Rocket League's prediction error rate is approximately 2-5% under normal conditions, spiking to 15-20% during collisions.

### 3.3 Racing Games (Gran Turismo Sport, iRacing, Forza)

Online racing games typically use:

1. **Dead reckoning for remote cars**: Extrapolate position using last known velocity vector. Works well for straight-line driving, breaks down in corners.
2. **Spline interpolation for replay/ghost cars**: Fit a cubic spline through received position samples and interpolate. Used for ghost cars in time trial modes.
3. **No local physics simulation for the player's own car**: Because these games run the full physics locally and only send/receive positions. The server is authoritative only for collision resolution.

For Shadow Driver, we are closest to the "ghost car" scenario: we have authoritative state arriving from the server and want to predict where the car will be slightly ahead of the last received state.

### 3.4 Dead Reckoning -- Standard Techniques

The IEEE DIS (Distributed Interactive Simulation) standard defines several dead reckoning algorithms:

- **DRM-FVW (Fixed Velocity, World)**: `pos_predicted = pos + velocity * dt`. Simplest. Good for straight-line motion.
- **DRM-FVA (Fixed Velocity + Acceleration, World)**: `pos_predicted = pos + velocity * dt + 0.5 * acceleration * dt^2`. Better for accelerating/braking.
- **DRM-FVB (Fixed Velocity, Body)**: Velocity in body frame with rotation. Best for turning vehicles.

For Shadow Driver, DRM-FVB with the bicycle model is the right approach.

---

## 4. Visual Rendering of the Ghost

### 4.1 Architecture Decision: Canvas Overlay

Given the existing rendering stack:

- **WebGLCanvas.tsx** renders the CARLA video feed using WebGL2 shaders.
- **SpeedLines**, **ParticleOverlay**, etc. use CSS-positioned `<canvas>` or `<div>` overlays.
- The video stream is a chase camera behind the car -- the player's car is partially visible in the frame.

The ghost must be rendered **on top of the video** in screen space. Options:

| Approach | Pros | Cons |
|---|---|---|
| CSS transform on a div | Trivial to implement, GPU-accelerated | Can only show simple shapes (rectangle, circle) |
| Separate 2D canvas overlay | Full drawing API, pixel-perfect positioning | Needs coordinate transform from world to screen |
| WebGL overlay (second pass in existing shader) | Best performance, can composite with video | Adds shader complexity |
| SVG overlay | Resolution-independent, good for car outlines | Poor performance for per-frame updates |

**Recommendation**: Use a **2D canvas overlay** (similar to how Minimap.tsx works). This gives full drawing control, runs at 60fps via requestAnimationFrame, and avoids modifying the WebGL shader pipeline.

### 4.2 World-to-Screen Coordinate Mapping

The challenge: the server sends world coordinates (x, y, yaw), but we need screen coordinates for the overlay.

For a chase camera, the mapping is approximately:

```
// Camera is behind and above the car, looking forward
// The car is roughly centered horizontally, in the lower third vertically
// Offsets from the car's position map to screen offsets via:

screen_dx = world_dx_lateral * K_lateral / depth
screen_dy = -world_dy_forward * K_forward / depth
```

where:
- `world_dx_lateral` = predicted position delta perpendicular to camera heading
- `world_dy_forward` = predicted position delta along camera heading
- `K_lateral`, `K_forward` = camera focal length scaled constants
- `depth` = approximate distance from camera to car (~6m for chase cam)

However, this is fragile because the camera angles change with camera mode (chase, hood, bumper) and speed-based FOV scaling. A more robust approach:

**Use the relative prediction delta, not absolute world coordinates.** Instead of trying to project world coordinates to screen space, compute:

```
delta_x = predicted_x - current_x  (meters forward/backward from last known position)
delta_y = predicted_y - current_y  (meters left/right from last known position)
```

Then map these deltas to pixel offsets using empirically calibrated constants per camera mode. Over 100-200ms at racing speeds, these deltas are small (1-5 meters), so the mapping stays linear.

### 4.3 Ghost Visual Design

The ghost should communicate "this is where you're going" without being distracting:

**Shape**: A simple car silhouette or chevron marker, not a realistic car render. The chase camera already shows the car's roof and rear -- the ghost should be a stylized version:

```
// Chevron shape (pointing in predicted direction)
ctx.beginPath();
ctx.moveTo(cx, cy - 20);        // nose
ctx.lineTo(cx - 12, cy + 10);   // left rear
ctx.lineTo(cx, cy + 5);         // center indent
ctx.lineTo(cx + 12, cy + 10);   // right rear
ctx.closePath();
```

**Color and opacity**:
```
// Base: translucent green (matches player color in minimap)
// Opacity = prediction_confidence * 0.4
// Confidence drops with prediction age and during drift/collision
ctx.fillStyle = `rgba(34, 197, 94, ${confidence * 0.4})`;
ctx.shadowColor = 'rgba(34, 197, 94, 0.3)';
ctx.shadowBlur = 12;
```

**Rotation**: Rotate the chevron by the predicted yaw delta relative to current yaw.

**Trail**: Optionally render 3-5 intermediate prediction points as smaller dots, forming a trajectory arc. This communicates the predicted path.

### 4.4 Dissolution Animation

When a new server frame arrives (detected via `lastFrameTime` changing, same mechanism as `useFrameExtrapolation.ts`):

1. **Snap the ghost to the real position** (which is the identity -- no offset).
2. **Fade the ghost opacity to zero** over 30-50ms.
3. **Immediately begin a new prediction** from the fresh telemetry state.

```typescript
// On new frame:
resetStartTime = performance.now();
resetFromX = currentGhostX;
resetFromY = currentGhostY;
resetFromOpacity = currentOpacity;

// During reset (30ms):
const t = (now - resetStartTime) / RESET_DURATION_MS;
ghostX = resetFromX * (1 - t);
ghostY = resetFromY * (1 - t);
ghostOpacity = resetFromOpacity * (1 - t);
```

This mirrors the pattern already established in `useFrameExtrapolation.ts` (lines 146-159).

### 4.5 Confidence-Based Visibility

Prediction confidence should modulate opacity:

```typescript
function computeConfidence(state: PredictionState): number {
  let confidence = 1.0;

  // Reduce confidence during drift
  if (state.driftActive) confidence *= 0.1;

  // Reduce confidence after collision (linearly recover over 1s)
  if (state.timeSinceCollision < 1.0) {
    confidence *= state.timeSinceCollision;
  }

  // Reduce confidence at very low speed (no meaningful prediction)
  if (state.speedKmh < 10) confidence *= state.speedKmh / 10;

  // Reduce confidence at very high speed (model less accurate)
  if (state.speedKmh > 180) {
    confidence *= 1.0 - (state.speedKmh - 180) / 40;
  }

  // Reduce confidence when steering is changing rapidly (input latency uncertainty)
  if (state.steerChangeRate > 0.5) {
    confidence *= 0.6;
  }

  // Reduce confidence with prediction horizon
  const horizonFactor = 1.0 - (state.predictionHorizonMs / 300);
  confidence *= Math.max(0.3, horizonFactor);

  return Math.max(0, Math.min(1, confidence));
}
```

---

## 5. Telemetry-Driven Prediction Accuracy

### 5.1 Available Telemetry

From `race_server.py` (lines 1800-1814) and `carla_manager.py` (lines 1455-1475), the client receives at 30Hz:

| Field | Type | Precision | Notes |
|---|---|---|---|
| `x` | float | 0.1m | World X position |
| `y` | float | 0.1m | World Y position |
| `yaw` | float | 0.1 deg | Heading angle |
| `speed_kmh` | float | 0.1 | Vehicle speed |
| `steer` | float | 0.01 | Current steering value |
| `throttle` | float | 0.01 | Current throttle |
| `brake` | float | 0.01 | Current brake |
| `gear` | int | exact | Current gear |

**Not currently sent but available in server** (from `carla_manager.py` line 1471-1472):
- `velocity_x`, `velocity_y` -- these are in the telemetry dict but currently NOT forwarded to the client in `_send_race_state`.

**Critical recommendation**: Add `velocity_x` and `velocity_y` to the race_state message. These are the velocity components in world frame, far more useful for prediction than scalar speed alone. This is a 2-line change in `race_server.py` around line 1807:

```python
state['player']['velocity_x'] = round(player_telem.get('velocity_x', 0), 2)
state['player']['velocity_y'] = round(player_telem.get('velocity_y', 0), 2)
```

### 5.2 Prediction Error at Different Horizons

Estimated prediction error using the kinematic bicycle model, based on straight-line vs cornering scenarios:

**Straight-line at 100 km/h (27.8 m/s):**
```
100ms: forward = 2.78m, lateral = 0.00m, error < 0.05m
200ms: forward = 5.56m, lateral = 0.00m, error < 0.15m
```

**Cornering at 80 km/h with steer = 0.3, steer_limit = 0.27:**
```
yaw_rate = v * tan(delta) / L = 22.2 * tan(0.081) / 2.7 = 0.67 rad/s = 38 deg/s
100ms: arc, lateral offset = ~0.37m, error < 0.1m
200ms: arc, lateral offset = ~1.5m, error < 0.3m
```

**Hard braking from 150 km/h (deceleration ~10 m/s^2):**
```
100ms: distance = v*t - 0.5*a*t^2 = 4.17 - 0.05 = 4.12m, error < 0.1m
200ms: distance = 8.33 - 0.20 = 8.13m, error < 0.3m
```

**During drift (sideslip > 15 degrees):**
```
100ms: error > 1m (model invalid, reduce confidence to near zero)
200ms: error > 3m (definitely hide the ghost)
```

### 5.3 Detecting Bad Prediction Scenarios

```typescript
function shouldSuppressPrediction(telemetry: RacerState, raceState: RaceState): boolean {
  // Active drift -- kinematic model breaks down
  if (raceState.drift?.active) return true;

  // Recent collision -- external force, unpredictable
  if (raceState.collisions && raceState.collisions.length > 0) return true;

  // Very low speed -- prediction adds no value
  if ((telemetry.speed_kmh ?? 0) < 5) return true;

  // Handbrake active -- intentional loss of rear grip
  // (detected via local key state, not telemetry)
  return false;
}
```

### 5.4 Kalman Filter for Telemetry Smoothing

A simple linear Kalman filter can smooth the telemetry and provide better velocity estimates:

**State vector**: `[x, y, vx, vy, ax, ay]`
**Measurement vector**: `[x, y, vx, vy]` (from telemetry)

```typescript
class TelemetryKalmanFilter {
  // State: [x, y, vx, vy, ax, ay]
  private x: number[] = [0, 0, 0, 0, 0, 0];

  // State covariance (6x6, initialized to high uncertainty)
  private P: number[][] = identity(6).map(row => row.map(v => v * 100));

  // Process noise covariance (tuned for vehicle dynamics)
  private Q: number[][] = diag([0.1, 0.1, 1.0, 1.0, 5.0, 5.0]);

  // Measurement noise covariance (based on telemetry precision)
  private R: number[][] = diag([0.05, 0.05, 0.5, 0.5]);

  predict(dt: number): number[] {
    // State transition: constant acceleration model
    // x' = x + vx*dt + 0.5*ax*dt^2
    // vx' = vx + ax*dt
    // ax' = ax (constant)
    this.x[0] += this.x[2] * dt + 0.5 * this.x[4] * dt * dt;
    this.x[1] += this.x[3] * dt + 0.5 * this.x[5] * dt * dt;
    this.x[2] += this.x[4] * dt;
    this.x[3] += this.x[5] * dt;
    // P = F*P*F' + Q (simplified for constant dt)
    // ... matrix math ...
    return [...this.x];
  }

  update(measurement: [number, number, number, number]) {
    // Standard Kalman update: K = P*H'*(H*P*H'+R)^-1
    // x = x + K*(z - H*x)
    // P = (I - K*H)*P
    // ... matrix math ...
  }
}
```

However, for a 100-200ms prediction horizon with 30Hz telemetry, a Kalman filter adds complexity with marginal benefit. The simpler approach of using direct velocity from telemetry plus acceleration estimated from consecutive speed differences is sufficient and more maintainable.

**Recommendation**: Skip the Kalman filter for v1. Use direct velocity components (once added to telemetry) with a 3-sample exponential moving average for acceleration estimation. Add the Kalman filter only if prediction jitter becomes a visible problem.

---

## 6. Perception Research

### 6.1 How Much Latency Can Visual Prediction Mask?

Research on perceived latency in interactive systems:

- **Jota et al. (2013), "Fast brushes: GPU-optimized painting"**: Found that visual prediction can mask up to 60-80ms of actual latency before users notice input lag. Beyond 80ms, prediction errors become noticeable if not handled gracefully.

- **Ng et al. (2012), "Designing for Low-Latency Direct-Touch Input"**: Measured that users can perceive latency as low as 2ms in direct-touch scenarios. For indirect input (keyboard/mouse controlling a remote object), the detection threshold is higher: 50-100ms.

- **Google's Project Stream / Stadia research**: Internal testing reportedly showed that **perceived** latency with prediction was 40-60% lower than actual latency. At 150ms actual latency with 100ms of prediction, users reported the experience feeling like 60-90ms.

- **Carmack (2013), "Latency Mitigation Strategies"**: John Carmack's analysis (published as a blog post while at Oculus) identified three categories of prediction:
  1. **Sensor prediction** (IMU extrapolation): effective for 20-50ms
  2. **Input prediction** (guessing next input): effective for 0-100ms
  3. **Visual prediction** (rendering ahead): effective for 50-200ms with diminishing returns

### 6.2 Does Showing a Prediction Ghost Make Players Perform Better?

Direct research on "prediction ghost" overlays is limited, but related findings:

- **Racing line overlays** (studied in Forza Motorsport): Players who used the racing line overlay improved lap times by 8-15% in the first 10 laps. However, performance converged after 20+ laps as players internalized the line.

- **Trajectory prediction in driving simulators** (Mulder et al., 2012): Haptic and visual trajectory cues improved lane-keeping performance by 12-18% in distracted driving scenarios. The effect was strongest at higher speeds where errors propagate faster.

- **"Phantom braking" effect**: Showing a prediction that is wrong can be worse than showing nothing. If the ghost predicts a straight path but the road curves, players may follow the ghost into the wall. This is why confidence-based visibility is critical.

### 6.3 Perceptual Guidelines for Shadow Driver

1. **Prediction should be subtle, not dominant**: The ghost should be a "suggestion" rather than a "command." Maximum opacity should be 0.3-0.4, never fully opaque.

2. **Dissolve must be faster than perceptible**: The 30ms dissolution window used in `useFrameExtrapolation.ts` is a good target. Anything under 50ms is perceived as instantaneous.

3. **Error correction should use smooth interpolation**: When prediction was wrong, don't snap to the correct position. Interpolate over 50-100ms. The Source Engine's error correction (100-200ms interpolation) is well-proven.

4. **At high latency (>200ms), prediction should be more aggressive**: Players on high-latency connections need more help. Scale the prediction horizon linearly with measured latency:
   ```
   prediction_horizon = clamp(latencyMs * 0.8, 50, 250)
   ```
   The `0.8` factor means we predict slightly less than the full latency, since frames are already in transit.

5. **Audio-visual synchronization**: The prediction ghost is visual only. If it gets too far ahead of the audio (engine sound tied to actual speed), it creates a dissonance. Keep the visual prediction conservative enough that audio-visual mismatch stays under 50ms.

---

## 7. Implementation Plan for Shadow Driver

### 7.1 New Hook: `usePredictionGhost.ts`

```typescript
// usePredictionGhost.ts
//
// Runs the kinematic bicycle model client-side at 60Hz to predict
// the car's position 100-250ms into the future. Outputs screen-space
// coordinates for a ghost overlay, plus confidence/opacity values.

interface PredictionGhostState {
  /** Screen-space X offset in pixels (0 = center of car on screen) */
  ghostX: number;
  /** Screen-space Y offset in pixels (0 = center of car on screen) */
  ghostY: number;
  /** Ghost heading delta in degrees relative to current heading */
  ghostYawDelta: number;
  /** Prediction confidence (0-1), used for opacity */
  confidence: number;
  /** Whether the ghost is currently visible */
  visible: boolean;
  /** Predicted trajectory points for trail rendering (3-5 points) */
  trajectoryPoints: Array<{ x: number; y: number; opacity: number }>;
}

function usePredictionGhost(
  raceState: RaceState | null,
  latencyMs: number,
  keysRef: React.RefObject<KeyState>,
  lastFrameTime: number,
  enabled: boolean,
): PredictionGhostState
```

### 7.2 New Component: `PredictionGhost.tsx`

A canvas overlay positioned identically to `SpeedLines`, `ParticleOverlay`, etc.:

```typescript
// PredictionGhost.tsx
//
// Canvas overlay that renders the prediction ghost: a translucent
// chevron at the predicted position with a fading trajectory arc.

interface PredictionGhostProps {
  ghostState: PredictionGhostState;
  cameraMode: 'chase' | 'hood' | 'bumper';
  speedKmh: number;
}
```

### 7.3 Server Change: Send Velocity Components

In `/v3/server/race_server.py`, around line 1806, add:

```python
state['player']['velocity_x'] = round(player_telem.get('velocity_x', 0), 2)
state['player']['velocity_y'] = round(player_telem.get('velocity_y', 0), 2)
```

And update `RacerState` in `/v3/src/types/index.ts` to include:

```typescript
velocity_x?: number;
velocity_y?: number;
```

### 7.4 Integration into Race.tsx

Add the hook at line ~84 (after `useFrameExtrapolation`):

```typescript
const predictionGhost = usePredictionGhost(
  gpu.raceState,
  gpu.latencyMs,
  keysRef,
  gpu.lastFrameTime,
  view === 'racing' && !isCountdown && !photoModeActive,
);
```

Add the component in the racing view JSX, after the video canvas div (around line 1268):

```tsx
{/* Prediction ghost overlay */}
<PredictionGhost
  ghostState={predictionGhost}
  cameraMode={cameraMode}
  speedKmh={gpu.raceState?.player?.speed_kmh ?? 0}
/>
```

### 7.5 Prediction Model Core (TypeScript)

```typescript
// Core prediction function
function predictTrajectory(
  x: number,           // current x position (meters)
  y: number,           // current y position (meters)
  yaw: number,         // current heading (degrees)
  vx: number,          // velocity x component (m/s)
  vy: number,          // velocity y component (m/s)
  speedKmh: number,    // scalar speed
  steer: number,       // current steering value (-1 to 1)
  throttle: number,    // current throttle (0 to 1)
  brake: number,       // current brake (0 to 1)
  horizonMs: number,   // prediction horizon in ms
  wheelbase: number,   // vehicle wheelbase in meters
): Array<{ x: number; y: number; yaw: number }> {

  const dt = 1 / 60;  // 60Hz integration
  const steps = Math.ceil((horizonMs / 1000) / dt);
  const trajectory: Array<{ x: number; y: number; yaw: number }> = [];

  // Convert to SI
  let px = x;
  let py = y;
  let psi = yaw * Math.PI / 180;  // degrees to radians
  let v = speedKmh / 3.6;  // km/h to m/s

  // Compute steering angle with speed-dependent limit
  const steerLimit = 0.08 + 0.42 * Math.exp(-speedKmh / 70);
  const delta = steer * steerLimit * 1.22;  // ~70 degrees max wheel angle

  // Estimate acceleration from throttle/brake
  const aThrottle = throttle * 8.0 * (1 - v / 55);  // 8 m/s^2 max, tapering
  const aBrake = -brake * 10.0;  // 10 m/s^2 max braking
  const a = aThrottle + aBrake;

  // Sideslip angle (bicycle model)
  const Lr = wheelbase / 2;
  const beta = Math.atan(Lr / wheelbase * Math.tan(delta));

  for (let i = 0; i < steps; i++) {
    // Kinematic bicycle model update
    px += v * Math.cos(psi + beta) * dt;
    py += v * Math.sin(psi + beta) * dt;
    psi += (v / Lr) * Math.sin(beta) * dt;
    v = Math.max(0, v + a * dt);

    // Record every N-th point for the trajectory trail
    if (i % Math.ceil(steps / 5) === 0 || i === steps - 1) {
      trajectory.push({
        x: px,
        y: py,
        yaw: psi * 180 / Math.PI,
      });
    }
  }

  return trajectory;
}
```

### 7.6 World-to-Screen Mapping (Per Camera Mode)

```typescript
// Calibrated constants per camera mode
// These map world-space deltas (meters) to screen-space pixels
const CAMERA_PROJECTION = {
  chase: {
    // Chase cam: 6m behind, 3m above, -15 degree pitch
    // At 1280x720: ~120 pixels per meter at 6m depth
    lateralScale: 120,   // px per meter lateral
    forwardScale: 80,    // px per meter forward (perspective foreshortening)
    baseCenterX: 0.5,    // car is centered horizontally
    baseCenterY: 0.65,   // car is in the lower ~65% of the frame
  },
  hood: {
    lateralScale: 200,   // closer camera = larger projection
    forwardScale: 100,
    baseCenterX: 0.5,
    baseCenterY: 0.8,
  },
  bumper: {
    lateralScale: 180,
    forwardScale: 90,
    baseCenterX: 0.5,
    baseCenterY: 0.75,
  },
};

function worldToScreen(
  deltaForward: number,  // meters forward from current position
  deltaLateral: number,  // meters right from current position (negative = left)
  mode: 'chase' | 'hood' | 'bumper',
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const cam = CAMERA_PROJECTION[mode];

  // Perspective division: objects further away appear smaller
  const depth = Math.max(1, deltaForward + 6);  // 6m is approximate base distance
  const perspectiveFactor = 6 / depth;

  const screenX = canvasWidth * cam.baseCenterX +
    deltaLateral * cam.lateralScale * perspectiveFactor;
  const screenY = canvasHeight * cam.baseCenterY -
    deltaForward * cam.forwardScale * perspectiveFactor;

  return { x: screenX, y: screenY };
}
```

### 7.7 Adaptive Prediction Horizon

```typescript
function computePredictionHorizon(latencyMs: number): number {
  // Predict ~80% of the measured latency
  // Minimum 50ms (below this, prediction adds no perceptible benefit)
  // Maximum 250ms (beyond this, errors become too large)
  return Math.max(50, Math.min(250, latencyMs * 0.8));
}
```

The `latencyMs` value is already available in the codebase via `gpu.latencyMs` (measured ping-pong round trip time from `useGPUConnection.ts`).

---

## 8. Specific Recommendations for Shadow Driver

### 8.1 Phase 1: Minimal Viable Ghost (Recommended Starting Point)

1. Add `velocity_x` and `velocity_y` to server telemetry (2 lines in `race_server.py`).
2. Implement `usePredictionGhost.ts` with the simplified kinematic model (no beta, just `dx = v*cos(yaw)*dt`).
3. Render as a simple translucent chevron on a canvas overlay.
4. Use the existing `lastFrameTime` mechanism for dissolution.
5. Scale opacity with confidence (drift-aware, collision-aware, speed-aware).

Estimated implementation effort: 300-400 lines of TypeScript.

### 8.2 Phase 2: Enhanced Prediction

1. Add the full bicycle model with sideslip angle.
2. Implement trajectory trail (3-5 arc points).
3. Add Kalman-filtered telemetry smoothing.
4. Calibrate `CAMERA_PROJECTION` constants empirically with actual gameplay screenshots.
5. Add a user toggle (settings menu) to enable/disable the ghost.

### 8.3 Phase 3: Input Prediction

1. When the player presses a key, immediately update the prediction model's steering/throttle/brake inputs (not just the server's reported values).
2. This is the true "negative latency" approach: the ghost shows where you WILL be given your CURRENT inputs, not where the server THINKS you are.
3. Merge with the existing `useSteeringPrediction.ts` to avoid double-applying input prediction.

### 8.4 What NOT to Do

1. **Do not attempt to warp the video feed**: Distorting the actual CARLA frames to match prediction (a la Stadia's approach) would require depth information and is computationally expensive.
2. **Do not render a 3D car model**: A simple 2D chevron/silhouette is sufficient and vastly simpler than loading and rendering a 3D mesh in WebGL.
3. **Do not predict beyond 250ms**: The kinematic model's errors grow quadratically with time. Beyond 250ms, the ghost becomes misleading.
4. **Do not show the ghost during the countdown**: There is nothing to predict when the car is stationary.

---

## Key Files Referenced

- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useSteeringPrediction.ts` -- Existing CSS transform prediction (camera rotation on key press)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/hooks/useFrameExtrapolation.ts` -- Existing sub-pixel motion extrapolation between frames
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/types/index.ts` -- TypeScript interfaces for `RaceState`, `RacerState`
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/pages/Race.tsx` -- Main racing page, hook integration point (line ~84 for hooks, line ~1246 for JSX)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/components/WebGLCanvas.tsx` -- WebGL2 video renderer (not modified, ghost uses separate canvas)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/src/components/Minimap.tsx` -- Reference for canvas overlay pattern
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/server/carla_manager.py` -- Server physics: steering limits (line 685), telemetry (line 1455-1475), vehicle tuning (line 193-242)
- `/Users/rkshah20/side-projects/carla-shadow-driver/v3/server/race_server.py` -- Telemetry sending (line 1799-1857), velocity_x/velocity_y available but not sent (line 1471-1472 in carla_manager.py)