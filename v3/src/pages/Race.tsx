import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useGPUConnection } from '../hooks/useGPUConnection.ts';
import { getLastWsUrl } from '../hooks/useGPUConnection.ts';
import { useEngineSound } from '../hooks/useEngineSound.ts';
import { useSteeringPrediction } from '../hooks/useSteeringPrediction.ts';
import { useFrameExtrapolation } from '../hooks/useFrameExtrapolation.ts';
import { useLeaderboard } from '../hooks/useLeaderboard.ts';
import { usePersonalBests } from '../hooks/usePersonalBests.ts';
import type { PersonalBestResult } from '../hooks/usePersonalBests.ts';
import { useGamepad } from '../hooks/useGamepad.ts';
import { useStreak } from '../hooks/useStreak.ts';
import { useCrowdAmbiance } from '../hooks/useCrowdAmbiance.ts';
import { VideoCanvas } from '../components/VideoCanvas.tsx';
import { WebGLCanvas, supportsWebGL2 } from '../components/WebGLCanvas.tsx';
import { WebRTCVideo } from '../components/WebRTCVideo.tsx';
import { RaceHUD } from '../components/RaceHUD.tsx';
import { SpeedEffects } from '../components/SpeedEffects.tsx';
import { SpeedLines } from '../components/SpeedLines.tsx';
import { ParticleOverlay } from '../components/ParticleOverlay.tsx';
import { DriftScore } from '../components/DriftScore.tsx';
import { GPUConnectionModal } from '../components/GPUConnectionModal.tsx';
import { RaceResults } from '../components/RaceResults.tsx';
import { RaceSetup } from '../components/RaceSetup.tsx';
import { Minimap } from '../components/Minimap.tsx';
import { ControlsHint } from '../components/ControlsHint.tsx';
import { FirstTimeOverlay } from '../components/FirstTimeOverlay.tsx';
import { PhotoMode } from '../components/PhotoMode.tsx';
import { DebugOverlay } from '../components/DebugOverlay.tsx';

import { SplitTimeDelta } from '../components/SplitTimeDelta.tsx';
import type { KeyState } from '../types/index.ts';

type RaceView = 'setup' | 'pre_race' | 'racing' | 'results';

const DEMO_WS_URL = 'ws://localhost:8765';

export function Race() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === 'true';
  const directWsUrl = params.get('ws') || getLastWsUrl();
  const isQuickstart = params.get('quickstart') === 'true';

  // Deep linking: parse race settings from URL
  const urlSettings = useMemo(() => {
    return {
      track: params.get('track') || undefined,
      laps: params.get('laps') ? parseInt(params.get('laps')!, 10) : undefined,
      weather: params.get('weather') || undefined,
      model: params.get('model') || undefined,
      playerCar: params.get('playerCar') || undefined,
      timeOfDay: params.get('timeOfDay') || undefined,
      postprocess: params.get('postprocess') || undefined,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [view, setView] = useState<RaceView>(isDemo || directWsUrl || isQuickstart ? 'pre_race' : 'setup');
  const [showRespawning, setShowRespawning] = useState(false);
  const [raceWeather, setRaceWeather] = useState('clear');

  const keysRef = useRef<KeyState>({ w: false, a: false, s: false, d: false, space: false });
  const keyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraIndexRef = useRef(0);
  const CAMERA_MODES = ['chase', 'hood', 'bumper'] as const;
  const [cameraMode, setCameraMode] = useState<typeof CAMERA_MODES[number]>('chase');

  // Feature-detect WebGL2 once (stable across renders)
  const [useWebGL2] = useState(() => supportsWebGL2());

  // Store last race settings for instant replay and share link
  const lastRaceSettingsRef = useRef<{ track: string; laps: number; weather: string; model?: string; playerCar?: string; timeOfDay?: string; postprocess?: string } | null>(null);

  const gpu = useGPUConnection();
  const engineSound = useEngineSound();
  const crowd = useCrowdAmbiance();
  const leaderboard = useLeaderboard();
  const personalBests = usePersonalBests();
  const gamepad = useGamepad();
  const streak = useStreak();
  const steeringPrediction = useSteeringPrediction(keysRef, view === 'racing', gpu.raceState?.player?.speed_kmh ?? 0);
  const frameExtrapolation = useFrameExtrapolation(
    gpu.raceState?.player?.speed_kmh ?? 0,
    gpu.raceState?.player?.steer ?? 0,
    gpu.lastFrameTime,
    view === 'racing',
  );

  // Track race config for leaderboard saving
  const raceConfigRef = useRef<{ track: string; laps: number; model: string; playerCar: string } | null>(null);

  // Personal best result for the most recent finished race
  const [pbResult, setPbResult] = useState<PersonalBestResult | null>(null);

  // First-time player detection
  const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
  const hasPlayedBeforeRef = useRef(() => {
    try { return localStorage.getItem('shadow_driver_has_played') === 'true'; } catch { return false; }
  });

  // Streak result for the most recent finished race
  const [streakResult, setStreakResult] = useState<{ newStreak: number; isNewRecord: boolean } | null>(null);

  // Track previous race_status for countdown detection
  const prevRaceStatusRef = useRef<string | null>(null);

  // Track previous gear for downshift blip detection
  const prevGearRef = useRef<number>(0);

  // Countdown rev engine: track W key during countdown for rev sound
  const countdownRevRef = useRef(false);

  // Controls hint: show when race transitions from countdown to racing
  const [showControlsHint, setShowControlsHint] = useState(false);
  const controlsHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Debug: show FPS/latency in browser tab title ---
  const fpsCountRef = useRef(0);
  useEffect(() => {
    if (view !== 'racing') return;
    // Count frames via gpu.lastFrameTime changes
    fpsCountRef.current++;
    // Update title every second
    const interval = setInterval(() => {
      const fps = fpsCountRef.current;
      fpsCountRef.current = 0;
      const lat = gpu.latencyMs ?? '?';
      document.title = `${fps}fps ${lat}ms | Shadow Driver`;
    }, 1000);
    return () => { clearInterval(interval); document.title = 'Shadow Driver'; };
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  // Track frame count from lastFrameTime changes
  useEffect(() => { fpsCountRef.current++; }, [gpu.lastFrameTime]);



  // --- Photo Mode state ---
  const [photoModeActive, setPhotoModeActive] = useState(false);

  // --- Canvas ref for replay/photo ---
  const replayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- Screen shake state ---
  const [shakeX, setShakeX] = useState(0);
  const [shakeY, setShakeY] = useState(0);
  const shakeRef = useRef<{ x: number; y: number; decay: number }>({ x: 0, y: 0, decay: 0 });
  const shakeRafRef = useRef<number | null>(null);
  const [crashDesaturate, setCrashDesaturate] = useState(false);
  const [checkpointFlash, setCheckpointFlash] = useState(false);
  const prevCheckpointRef = useRef(0);
  const [lastLapOvertake, setLastLapOvertake] = useState(false);
  const [niceSave, setNiceSave] = useState(false);
  const speedHistoryRef = useRef<number[]>([]);

  // --- Photo Finish detection state ---
  const [photoFinish, setPhotoFinish] = useState(false);
  // Building tension: approaching photo finish (final lap, last ~10% checkpoints, gap < 1.0s)
  const [photoFinishTension, setPhotoFinishTension] = useState(false);
  const photoFinishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audio swell ref for cleanup
  const photoFinishAudioRef = useRef<{ ctx: AudioContext; nodes: AudioNode[] } | null>(null);

  // --- Comeback mechanic: slipstream boost visual when >3s behind ---
  const [slipstreamBoost, setSlipstreamBoost] = useState(false);

  // --- Near-miss detection: "CLOSE CALL!" popup when cars pass within 3m at relative speed > 30 km/h ---
  const [nearMiss, setNearMiss] = useState(false);
  const nearMissCooldownRef = useRef(false);

  // --- Drift boost: "DRIFT BOOST!" popup + orange glow + speed line intensification ---
  const [driftBoostActive, setDriftBoostActive] = useState(false);
  const [driftBoostGlow, setDriftBoostGlow] = useState(false);
  const [driftBoostSpeedLines, setDriftBoostSpeedLines] = useState(false);
  const lastDriftBoostEventRef = useRef<unknown>(null);

  // --- Split time delta tracking ---
  const checkpointTimesRef = useRef<number[]>([]);
  const splitLapRef = useRef(0);
  const [splitDelta, setSplitDelta] = useState<number | null>(null);
  const [splitRawTime, setSplitRawTime] = useState<number>(0);
  const [splitTrigger, setSplitTrigger] = useState(0);

  // --- GO screen shake trigger ---
  const goShakeTriggeredRef = useRef(false);

  // --- Player trail for minimap racing line comparison ---
  const playerTrailRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastTrailTimeRef = useRef(0);
  const [playerTrail, setPlayerTrail] = useState<Array<{ x: number; y: number }>>([]);

  // --- Racing line (checkpoint polyline, stored from first telemetry with checkpoints) ---
  const racingLineRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const [racingLine, setRacingLine] = useState<Array<{ x: number; y: number }> | null>(null);

  // --- Camera countdown zoom state ---
  const isCountdown = gpu.raceState?.race_status === 'countdown';
  const countdownZoomStyle = useMemo(() => {
    if (isCountdown) {
      return {
        transform: 'scale(0.95) translateY(-10px)',
        transition: 'transform 1.0s ease-out',
      };
    }
    return {
      transform: 'scale(1.0) translateY(0px)',
      transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
    };
  }, [isCountdown]);

  // --- Engine sound update loop ---
  useEffect(() => {
    if (view !== 'racing') return;

    let rafId: number;
    const tick = () => {
      const player = gpu.raceState?.player;
      const raceStatus = gpu.raceState?.race_status;

      if (raceStatus === 'countdown') {
        // During countdown: rev engine if W is held (via countdownRevRef)
        const revThrottle = countdownRevRef.current ? 0.8 : 0.0;
        const revRpm = countdownRevRef.current ? 4000 : 800;
        engineSound.update(revRpm, revThrottle, 0, 0);
      } else if (player) {
        engineSound.update(
          player.rpm ?? 800,
          player.throttle ?? 0,
          player.speed_kmh,
          player.steer ?? 0,
        );

        // Record player trail for minimap (throttled to ~10Hz, max 1000 entries)
        if (player.x != null && player.y != null) {
          const now = performance.now();
          if (now - lastTrailTimeRef.current >= 100) {
            lastTrailTimeRef.current = now;
            playerTrailRef.current.push({ x: player.x, y: player.y });
            if (playerTrailRef.current.length > 1000) {
              playerTrailRef.current = playerTrailRef.current.slice(-1000);
            }
            if (playerTrailRef.current.length % 10 === 0) {
              setPlayerTrail([...playerTrailRef.current]);
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(rafId); };
  }, [view, gpu.raceState, engineSound.update]);

  // --- Countdown beeps + GO screen shake ---
  useEffect(() => {
    const status = gpu.raceState?.race_status ?? null;
    if (status === 'countdown' && prevRaceStatusRef.current !== 'countdown') {
      engineSound.playCountdownBeeps();
      goShakeTriggeredRef.current = false;
    }
    // Show controls hint when transitioning from countdown to racing
    if (status === 'racing' && prevRaceStatusRef.current === 'countdown') {
      // First-time players get the full controls overlay; returning players get the brief hint
      if (!hasPlayedBeforeRef.current()) {
        setShowFirstTimeOverlay(true);
      } else {
        setShowControlsHint(true);
        if (controlsHintTimeoutRef.current) clearTimeout(controlsHintTimeoutRef.current);
        controlsHintTimeoutRef.current = setTimeout(() => setShowControlsHint(false), 4000);
      }
    }

    // Trigger screen shake on GO (countdown === 0)
    if (status === 'countdown' && gpu.raceState?.countdown === 0 && !goShakeTriggeredRef.current) {
      goShakeTriggeredRef.current = true;
      triggerScreenShake(6, 250);
    }

    prevRaceStatusRef.current = status;
  }, [gpu.raceState?.race_status, gpu.raceState?.countdown, engineSound.playCountdownBeeps]);

  // --- Capture racing line from checkpoints (once, on first telemetry) ---
  useEffect(() => {
    const checkpoints = gpu.raceState?.checkpoints;
    if (checkpoints && checkpoints.length > 1 && !racingLineRef.current) {
      racingLineRef.current = checkpoints;
      setRacingLine(checkpoints);
    }
  }, [gpu.raceState?.checkpoints]);

  // --- Screen shake helper ---
  const triggerScreenShake = useCallback((magnitude: number, duration: number, dirX?: number, dirY?: number) => {
    const hasDirection = dirX != null && dirY != null;
    shakeRef.current = {
      x: hasDirection ? dirX * magnitude : (Math.random() - 0.5) * 2 * magnitude,
      y: hasDirection ? dirY * magnitude : (Math.random() - 0.5) * 2 * magnitude,
      decay: magnitude,
    };

    if (shakeRafRef.current !== null) {
      cancelAnimationFrame(shakeRafRef.current);
    }

    const shakeStart = performance.now();
    setShakeX(shakeRef.current.x);
    setShakeY(shakeRef.current.y);

    const animateShake = (now: number) => {
      const elapsed = now - shakeStart;
      if (elapsed >= duration) {
        setShakeX(0);
        setShakeY(0);
        shakeRafRef.current = null;
        return;
      }
      const decayFactor = 1 - elapsed / duration;
      const currentMag = magnitude * decayFactor;
      const dirBlend = hasDirection ? Math.max(0, 1 - elapsed / (duration * 0.4)) : 0;
      const randomX = (Math.random() - 0.5) * 2 * currentMag;
      const randomY = (Math.random() - 0.5) * 2 * currentMag;
      const biasX = hasDirection ? dirX! * currentMag : 0;
      const biasY = hasDirection ? dirY! * currentMag : 0;
      setShakeX(randomX * (1 - dirBlend) + biasX * dirBlend);
      setShakeY(randomY * (1 - dirBlend) + biasY * dirBlend);
      shakeRafRef.current = requestAnimationFrame(animateShake);
    };

    shakeRafRef.current = requestAnimationFrame(animateShake);
  }, []);

  // --- Collision: screen shake + impact sound ---
  useEffect(() => {
    const collisions = gpu.raceState?.collisions;
    if (!collisions || collisions.length === 0) return;

    // Play impact sound for each collision
    for (const collision of collisions) {
      engineSound.playImpact(collision.intensity);
    }

    // Use the strongest collision for shake intensity
    const maxIntensity = Math.max(...collisions.map(c => c.intensity));

    const magnitude = Math.min(15, Math.sqrt(maxIntensity) * 0.5);
    const shakeDuration = 200 + Math.min(300, magnitude * 20);

    // Directional shake: compute direction from player to AI for collision impulse
    const player = gpu.raceState?.player;
    const ai = gpu.raceState?.ai;
    let collDirX: number | undefined;
    let collDirY: number | undefined;
    if (player && ai && player.x != null && player.y != null && ai.x != null && ai.y != null) {
      const dx = ai.x - player.x;
      const dy = ai.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01) {
        collDirX = -(dx / dist);
        collDirY = -(dy / dist);
      }
    }
    triggerScreenShake(magnitude, shakeDuration, collDirX, collDirY);

    // Haptic feedback on mobile (Vibration API)
    if (navigator.vibrate) {
      navigator.vibrate(Math.min(100, Math.round(magnitude * 7)));
    }

    // Crash desaturation: brief grayscale on big impacts
    if (maxIntensity > 2000) {
      setCrashDesaturate(true);
      setTimeout(() => setCrashDesaturate(false), 250);
    }

    return () => {
      if (shakeRafRef.current !== null) {
        cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = null;
      }
    };
  }, [gpu.raceState?.collisions, engineSound.playImpact, triggerScreenShake]);

  // --- Acceleration/braking: subtle camera shake on hard inputs ---
  const prevThrottleRef = useRef(0);
  const prevBrakeRef = useRef(0);
  const prevSpeedForShakeRef = useRef(0);
  const impactPreClickCooldownRef = useRef(0);

  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;

    const throttle = player.throttle ?? 0;
    const brake = player.brake ?? 0;
    const speed = player.speed_kmh ?? 0;
    const prevSpeed = prevSpeedForShakeRef.current;

    // Hard acceleration onset
    const throttleDelta = throttle - prevThrottleRef.current;
    if (throttleDelta > 0.4 && speed > 5) {
      const mag = Math.min(3, 1 + speed / 80);
      triggerScreenShake(mag, 120, 0, 1);
    }

    // Hard braking onset
    const brakeDelta = brake - prevBrakeRef.current;
    if (brakeDelta > 0.4 && speed > 20) {
      const mag = Math.min(4, 1.5 + speed / 60);
      triggerScreenShake(mag, 180, 0, -1);
    }

    // Speed loss jolt
    const speedDrop = prevSpeedForShakeRef.current - speed;
    if (speedDrop > 30 && brake < 0.3) {
      const mag = Math.min(5, speedDrop / 15);
      triggerScreenShake(mag, 150);
    }

    // Client-side impact pre-trigger
    if (Math.abs(speed - prevSpeed) > 20 && brake < 0.3) {
      const now = performance.now();
      if (now - impactPreClickCooldownRef.current > 500) {
        impactPreClickCooldownRef.current = now;
        engineSound.playImpactPreClick();
      }
    }

    prevThrottleRef.current = throttle;
    prevBrakeRef.current = brake;
    prevSpeedForShakeRef.current = speed;
  }, [view, gpu.raceState?.player?.throttle, gpu.raceState?.player?.brake, gpu.raceState?.player?.speed_kmh, triggerScreenShake, engineSound.playImpactPreClick]);

  // --- Adaptive music event triggers ---
  const prevGapSignRef = useRef<number>(0);
  const prevLapRef = useRef<number>(0);
  const closeGapTriggeredRef = useRef(false);

  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;

    const gap = player.gap_seconds;

    // Overtake detection
    if (gap != null) {
      const currentSign = gap > 0 ? 1 : gap < 0 ? -1 : 0;
      if (prevGapSignRef.current > 0 && currentSign < 0) {
        // Player just overtook the AI
        engineSound.triggerEvent('overtake');
        engineSound.playPassingWhoosh();
        crowd.cheer();
      }
      if (prevGapSignRef.current < 0 && currentSign > 0) {
        // AI just overtook the player
        engineSound.playPassingWhoosh();
      }
      prevGapSignRef.current = currentSign;

      // Close gap tension
      if (Math.abs(gap) < 1.0) {
        if (!closeGapTriggeredRef.current) {
          closeGapTriggeredRef.current = true;
          engineSound.triggerEvent('close_gap');
        }
        crowd.setAnticipation(1 - Math.abs(gap));
      } else {
        if (closeGapTriggeredRef.current) {
          closeGapTriggeredRef.current = false;
          engineSound.stopCloseGapTension();
        }
        crowd.setAnticipation(0);
      }

      // Comeback mechanic: show slipstream boost visual when player is >3s behind
      setSlipstreamBoost(gap > 3.0);
    }

    // Final lap detection
    if (player.total_laps > 1 && player.lap === player.total_laps && prevLapRef.current !== player.total_laps) {
      engineSound.triggerEvent('final_lap');
    }
    prevLapRef.current = player.lap;
  }, [view, gpu.raceState?.player?.gap_seconds, gpu.raceState?.player?.lap, gpu.raceState?.player?.total_laps, gpu.raceState?.player?.checkpoint, gpu.raceState?.player?.total_checkpoints, engineSound.triggerEvent, engineSound.stopCloseGapTension, engineSound.playPassingWhoosh, crowd.cheer, crowd.setAnticipation]);

  // Collision hit sound (percussive white noise burst)
  useEffect(() => {
    const collisions = gpu.raceState?.collisions;
    if (!collisions || collisions.length === 0) return;
    engineSound.triggerEvent('collision_hit');
    crowd.gasp();
  }, [gpu.raceState?.collisions, engineSound.triggerEvent, crowd.gasp]);

  // --- Downshift blip: play rev-match sound when gear decreases ---
  useEffect(() => {
    if (view !== 'racing') return;
    const gear = gpu.raceState?.player?.gear;
    if (gear == null) return;
    if (prevGearRef.current > 0 && gear < prevGearRef.current) {
      engineSound.playDownshiftBlip();
    }
    prevGearRef.current = gear;
  }, [view, gpu.raceState?.player?.gear, engineSound.playDownshiftBlip]);

  // --- Checkpoint celebration flash ---
  useEffect(() => {
    if (view !== 'racing') return;
    const cp = gpu.raceState?.player?.checkpoint ?? 0;
    if (cp > 0 && cp !== prevCheckpointRef.current && prevCheckpointRef.current > 0) {
      setCheckpointFlash(true);
      setTimeout(() => setCheckpointFlash(false), 150);
    }
    prevCheckpointRef.current = cp;
  }, [view, gpu.raceState?.player?.checkpoint]);

  // --- Split time delta at every checkpoint ---
  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;

    const cp = player.checkpoint;
    const lap = player.lap;
    const lapTime = player.lap_time;
    const config = raceConfigRef.current;

    // Detect lap change: reset checkpoint times for the new lap
    if (lap !== splitLapRef.current) {
      if (lap > splitLapRef.current && splitLapRef.current > 0 && config) {
        const completedLapSplits = [...checkpointTimesRef.current];
        const completedLapTime = player.best_lap ?? lapTime;
        if (completedLapSplits.length > 0) {
          personalBests.saveSplits(config.track, config.laps, completedLapTime, completedLapSplits);
        }
      }
      splitLapRef.current = lap;
      checkpointTimesRef.current = [];
      return;
    }

    // Detect checkpoint advance within the same lap
    const expectedIdx = checkpointTimesRef.current.length;
    if (cp === expectedIdx + 1 || (cp > 0 && cp > expectedIdx)) {
      while (checkpointTimesRef.current.length < cp - 1) {
        checkpointTimesRef.current.push(lapTime);
      }
      checkpointTimesRef.current.push(lapTime);

      const cpIndex = checkpointTimesRef.current.length - 1;
      if (config) {
        const pbSplits = personalBests.getSplits(config.track, config.laps);
        if (pbSplits && cpIndex < pbSplits.length) {
          const delta = lapTime - pbSplits[cpIndex];
          setSplitDelta(delta);
          setSplitRawTime(lapTime);
        } else {
          setSplitDelta(null);
          setSplitRawTime(lapTime);
        }
      } else {
        setSplitDelta(null);
        setSplitRawTime(lapTime);
      }
      setSplitTrigger(prev => prev + 1);
    }
  }, [view, gpu.raceState?.player?.checkpoint, gpu.raceState?.player?.lap, gpu.raceState?.player?.lap_time, personalBests.getSplits, personalBests.saveSplits]);

  // --- "LAST LAP OVERTAKE!" detection ---
  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;
    const gap = player.gap_seconds;
    if (
      gap != null && gap < 0 &&
      player.total_laps > 1 &&
      player.lap === player.total_laps &&
      player.total_checkpoints &&
      player.checkpoint >= player.total_checkpoints * 0.8 &&
      prevGapSignRef.current > 0
    ) {
      setLastLapOvertake(true);
      setTimeout(() => setLastLapOvertake(false), 3000);
    }
  }, [view, gpu.raceState?.player?.gap_seconds, gpu.raceState?.player?.lap, gpu.raceState?.player?.checkpoint]);

  // --- "NICE SAVE!" detection: speed drops >50% then recovers within 2s ---
  useEffect(() => {
    if (view !== 'racing') return;
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    const history = speedHistoryRef.current;
    history.push(speed);
    if (history.length > 60) history.shift();

    if (history.length >= 30) {
      const recentMax = Math.max(...history.slice(-30));
      const recentMin = Math.min(...history.slice(-30));
      if (recentMin < recentMax * 0.5 && speed > recentMax * 0.7 && recentMax > 60) {
        const midIdx = history.length - 15;
        const midSpeed = history[midIdx] ?? speed;
        if (midSpeed < recentMax * 0.5) {
          setNiceSave(true);
          speedHistoryRef.current = [speed];
          setTimeout(() => setNiceSave(false), 2000);
        }
      }
    }
  }, [view, gpu.raceState?.player?.speed_kmh]);

  // --- Photo Finish tension detection ---
  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;
    const gap = player.gap_seconds;
    const raceStatus = gpu.raceState?.race_status;

    const isFinalLap = player.lap === player.total_laps;
    const isFinishing = raceStatus === 'finishing';
    const totalCp = player.total_checkpoints ?? 0;
    const cpProgress = totalCp > 0 ? player.checkpoint / totalCp : 0;
    const isNearEnd = cpProgress >= 0.9;

    if (gap != null && Math.abs(gap) < 1.0 && (isFinishing || (isFinalLap && isNearEnd))) {
      if (!photoFinishTension) {
        setPhotoFinishTension(true);
      }
    } else {
      if (photoFinishTension) {
        setPhotoFinishTension(false);
      }
    }
  }, [view, gpu.raceState?.player?.gap_seconds, gpu.raceState?.player?.lap, gpu.raceState?.player?.total_laps, gpu.raceState?.player?.checkpoint, gpu.raceState?.player?.total_checkpoints, gpu.raceState?.race_status, photoFinishTension]);

  // --- Near-miss detection ---
  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    const ai = gpu.raceState?.ai;
    if (!player || !ai) return;
    if (player.x == null || player.y == null || ai.x == null || ai.y == null) return;

    const dx = player.x - ai.x;
    const dy = player.y - ai.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const relativeSpeed = Math.abs(player.speed_kmh - ai.speed_kmh);

    if (distance < 3 && relativeSpeed > 30 && !nearMissCooldownRef.current) {
      nearMissCooldownRef.current = true;
      setNearMiss(true);
      const hideTimeout = setTimeout(() => setNearMiss(false), 1300);
      const cooldownTimeout = setTimeout(() => { nearMissCooldownRef.current = false; }, 3000);
      return () => {
        clearTimeout(hideTimeout);
        clearTimeout(cooldownTimeout);
      };
    }
  }, [view, gpu.raceState?.player?.x, gpu.raceState?.player?.y, gpu.raceState?.ai?.x, gpu.raceState?.ai?.y, gpu.raceState?.player?.speed_kmh, gpu.raceState?.ai?.speed_kmh]);

  // --- Drift boost: detect drift end with score > 200 ---
  useEffect(() => {
    if (view !== 'racing') return;
    const driftEnd = gpu.latestDriftEnd;
    if (!driftEnd) return;
    if (lastDriftBoostEventRef.current === driftEnd) return;
    lastDriftBoostEventRef.current = driftEnd;

    if (driftEnd.score > 200) {
      setDriftBoostActive(true);
      setTimeout(() => setDriftBoostActive(false), 1500);

      setDriftBoostGlow(true);
      setTimeout(() => setDriftBoostGlow(false), 1500);

      setDriftBoostSpeedLines(true);
      setTimeout(() => setDriftBoostSpeedLines(false), 1500);

      engineSound.playDriftBoost();
    }
  }, [view, gpu.latestDriftEnd, engineSound.playDriftBoost]);

  // --- Crowd ambiance lifecycle ---
  useEffect(() => {
    const status = gpu.raceState?.race_status;
    if (view === 'racing' && (status === 'racing' || status === 'finishing' || status === 'countdown')) {
      crowd.start();
    } else {
      crowd.stop();
    }
  }, [view, gpu.raceState?.race_status, crowd.start, crowd.stop]);

  // --- Wake Lock: prevent screen from sleeping during race ---
  useEffect(() => {
    if (view !== 'racing') return;

    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request('screen');
      } catch {
        // Wake Lock API not supported or permission denied -- ignore
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      wakeLock?.release().catch(() => {});
    };
  }, [view]);

  // --- Keyboard controls (racing view) ---
  useEffect(() => {
    if (view !== 'racing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const raceStatus = gpu.raceState?.race_status;

      // During countdown, only accept W for engine rev (no movement)
      if (raceStatus === 'countdown') {
        if (key === 'w') {
          countdownRevRef.current = true;
        }
        return;
      }

      // Photo mode toggle: P key (only during racing, not during countdown)
      if (key === 'p') {
        if (!photoModeActive) {
          setPhotoModeActive(true);
          gpu.sendPause();
          keysRef.current = { w: false, a: false, s: false, d: false, space: false };
          gpu.sendControls({ w: false, a: false, s: false, d: false, space: false });
        }
        return;
      }

      // Don't process driving keys while in photo mode
      if (photoModeActive) return;

      if (key === 'r') {
        gpu.sendRespawn();
        setShowRespawning(true);
        if (respawnTimeoutRef.current) clearTimeout(respawnTimeoutRef.current);
        respawnTimeoutRef.current = setTimeout(() => setShowRespawning(false), 1500);
        return;
      }
      if (key === 'backspace') {
        gpu.sendRestartRace();
        return;
      }
      if (key === 'f') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
        return;
      }
      if (key === 'c') {
        cameraIndexRef.current = (cameraIndexRef.current + 1) % CAMERA_MODES.length;
        const newMode = CAMERA_MODES[cameraIndexRef.current];
        setCameraMode(newMode);
        gpu.sendCameraMode(newMode);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        keysRef.current = { ...keysRef.current, space: true };
      } else if (key in keysRef.current) {
        keysRef.current = { ...keysRef.current, [key]: true };
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w') {
        countdownRevRef.current = false;
      }
      if (key === ' ') {
        keysRef.current = { ...keysRef.current, space: false };
      } else if (key in keysRef.current) {
        keysRef.current = { ...keysRef.current, [key]: false };
      }
    };

    // Reset all keys when window loses focus (prevents stuck keys on alt-tab)
    const resetAllKeys = () => {
      keysRef.current = { w: false, a: false, s: false, d: false, space: false };
      countdownRevRef.current = false;
      gpu.sendControls({ w: false, a: false, s: false, d: false, space: false });
    };

    const handleBlur = () => {
      resetAllKeys();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        resetAllKeys();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Expose keysRef for browser console debugging
    (window as unknown as Record<string, unknown>).__keysRef = keysRef;

    // Send controls at 30Hz, merging keyboard + gamepad
    keyIntervalRef.current = setInterval(() => {
      // E2E testing override: if window.__e2eKeys is set, use those keys
      const e2eKeys = (window as unknown as Record<string, unknown>).__e2eKeys as KeyState | undefined;
      if (e2eKeys) {
        keysRef.current = e2eKeys;
      }

      if (gamepad.connected) {
        // Gamepad connected: send analog controls
        const gpKeys: KeyState = {
          w: gamepad.throttle > 0.05,
          a: gamepad.steering < -0.05,
          s: gamepad.brake > 0.05,
          d: gamepad.steering > 0.05,
          space: gamepad.handbrake,
        };
        const mergedKeys: KeyState = {
          w: keysRef.current.w || gpKeys.w,
          a: keysRef.current.a || gpKeys.a,
          s: keysRef.current.s || gpKeys.s,
          d: keysRef.current.d || gpKeys.d,
          space: keysRef.current.space || gpKeys.space,
        };
        gpu.sendControls(mergedKeys, {
          steer: gamepad.steering,
          throttle: gamepad.throttle,
          brake: gamepad.brake,
          handbrake: gamepad.handbrake,
        });
      } else {
        // Keyboard-only
        gpu.sendControls(keysRef.current);
      }
    }, 33);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (keyIntervalRef.current) {
        clearInterval(keyIntervalRef.current);
        keyIntervalRef.current = null;
      }
      if (respawnTimeoutRef.current) {
        clearTimeout(respawnTimeoutRef.current);
        respawnTimeoutRef.current = null;
      }
      if (controlsHintTimeoutRef.current) {
        clearTimeout(controlsHintTimeoutRef.current);
        controlsHintTimeoutRef.current = null;
      }
      keysRef.current = { w: false, a: false, s: false, d: false, space: false };
      countdownRevRef.current = false;
    };
  }, [view, gpu.sendControls, gpu.sendRespawn, gpu.sendRestartRace, gpu.sendCameraMode, gpu.sendPause, gpu.raceState?.race_status, photoModeActive, gamepad.connected, gamepad.steering, gamepad.throttle, gamepad.brake, gamepad.handbrake]);

  // --- Dismiss first-time overlay ---
  const dismissFirstTimeOverlay = useCallback(() => {
    setShowFirstTimeOverlay(false);
  }, []);

  // --- Photo Mode exit handler ---
  const handleExitPhotoMode = useCallback(() => {
    setPhotoModeActive(false);
    gpu.sendResume();
  }, [gpu.sendResume]);

  // --- Gamepad button actions (rising-edge: respawn, camera toggle, countdown rev) ---
  useEffect(() => {
    if (view !== 'racing' || !gamepad.connected) return;
    const raceStatus = gpu.raceState?.race_status;

    // During countdown, use right trigger for engine rev
    if (raceStatus === 'countdown') {
      countdownRevRef.current = gamepad.throttle > 0.1;
      return;
    }

    if (gamepad.respawn) {
      gpu.sendRespawn();
      setShowRespawning(true);
      if (respawnTimeoutRef.current) clearTimeout(respawnTimeoutRef.current);
      respawnTimeoutRef.current = setTimeout(() => setShowRespawning(false), 1500);
    }
    if (gamepad.cameraToggle) {
      cameraIndexRef.current = (cameraIndexRef.current + 1) % CAMERA_MODES.length;
      const newMode = CAMERA_MODES[cameraIndexRef.current];
      setCameraMode(newMode);
      gpu.sendCameraMode(newMode);
    }
  }, [view, gamepad.connected, gamepad.respawn, gamepad.cameraToggle, gamepad.throttle, gpu.raceState?.race_status, gpu.sendRespawn, gpu.sendCameraMode]);

  // --- Watch for race finished ---
  useEffect(() => {
    if (gpu.raceFinished) {
      setView('results');
      crowd.roar();

      // Snapshot final player trail for post-race display
      setPlayerTrail([...playerTrailRef.current]);

      // --- Photo Finish detection: gap < 1.0s between player and AI ---
      const pTime = gpu.raceFinished.player_time;
      const aTime = gpu.raceFinished.ai_time;
      if (pTime != null && aTime != null && Math.abs(pTime - aTime) < 1.0) {
        setPhotoFinish(true);
        setPhotoFinishTension(false);

        // Play dramatic audio swell (rising chord + cymbal wash)
        try {
          const ctx = new AudioContext();
          const nodes: AudioNode[] = [];
          const now = ctx.currentTime;

          const master = ctx.createGain();
          master.gain.setValueAtTime(0, now);
          master.gain.linearRampToValueAtTime(0.25, now + 0.8);
          master.gain.linearRampToValueAtTime(0.15, now + 2.0);
          master.gain.linearRampToValueAtTime(0, now + 3.0);
          master.connect(ctx.destination);
          nodes.push(master);

          const chordFreqs = [294, 370, 440];
          for (const freq of chordFreqs) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * 0.9, now);
            osc.frequency.exponentialRampToValueAtTime(freq, now + 0.6);
            osc.frequency.exponentialRampToValueAtTime(freq * 1.02, now + 2.5);
            const oscGain = ctx.createGain();
            oscGain.gain.setValueAtTime(0.3, now);
            osc.connect(oscGain);
            oscGain.connect(master);
            osc.start(now);
            osc.stop(now + 3.0);
            nodes.push(osc, oscGain);
          }

          const shimmer = ctx.createOscillator();
          shimmer.type = 'sawtooth';
          shimmer.frequency.setValueAtTime(880, now);
          shimmer.frequency.linearRampToValueAtTime(900, now + 2.5);
          const shimmerFilter = ctx.createBiquadFilter();
          shimmerFilter.type = 'lowpass';
          shimmerFilter.frequency.setValueAtTime(2000, now);
          shimmerFilter.frequency.linearRampToValueAtTime(4000, now + 1.0);
          shimmerFilter.frequency.linearRampToValueAtTime(1500, now + 2.5);
          const shimmerGain = ctx.createGain();
          shimmerGain.gain.setValueAtTime(0.08, now);
          shimmer.connect(shimmerFilter);
          shimmerFilter.connect(shimmerGain);
          shimmerGain.connect(master);
          shimmer.start(now);
          shimmer.stop(now + 3.0);
          nodes.push(shimmer, shimmerFilter, shimmerGain);

          const noiseLen = 3.0 * ctx.sampleRate;
          const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
          const noiseData = noiseBuffer.getChannelData(0);
          for (let i = 0; i < noiseLen; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.5;
          }
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer;
          const noiseFilter = ctx.createBiquadFilter();
          noiseFilter.type = 'highpass';
          noiseFilter.frequency.setValueAtTime(6000, now);
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(0, now);
          noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.3);
          noiseGain.gain.linearRampToValueAtTime(0.06, now + 1.5);
          noiseGain.gain.linearRampToValueAtTime(0, now + 3.0);
          noise.connect(noiseFilter);
          noiseFilter.connect(noiseGain);
          noiseGain.connect(master);
          noise.start(now);
          noise.stop(now + 3.0);
          nodes.push(noise, noiseFilter, noiseGain);

          photoFinishAudioRef.current = { ctx, nodes };

          setTimeout(() => {
            ctx.close().catch(() => {});
            photoFinishAudioRef.current = null;
          }, 3500);
        } catch {
          // Web Audio API not available
        }

        if (photoFinishTimeoutRef.current) clearTimeout(photoFinishTimeoutRef.current);
        photoFinishTimeoutRef.current = setTimeout(() => {
          setPhotoFinish(false);
        }, 3000);
      } else {
        setPhotoFinish(false);
        setPhotoFinishTension(false);
      }

      // Record streak
      const streakRes = streak.recordRace();
      setStreakResult(streakRes);

      // Mark player as having played before (for first-time overlay)
      try { localStorage.setItem('shadow_driver_has_played', 'true'); } catch { /* ignore */ }

      // Save to leaderboard
      if (raceConfigRef.current && gpu.raceFinished.player_time != null) {
        const config = raceConfigRef.current;
        const bestLap = gpu.raceFinished.player_laps.length > 0
          ? Math.min(...gpu.raceFinished.player_laps)
          : gpu.raceFinished.player_time;
        leaderboard.addResult({
          track: config.track,
          laps: config.laps,
          time: gpu.raceFinished.player_time,
          bestLap,
          maxSpeed: gpu.raceFinished.player_max_speed ?? 0,
          driftScore: gpu.raceFinished.total_drift_score ?? 0,
          difficulty: config.model,
          playerCar: config.playerCar,
          winner: gpu.raceFinished.winner,
          aiTime: gpu.raceFinished.ai_time,
        });

        // Compute personal best result BEFORE saving
        const pbResultData = personalBests.getResult(config.track, config.laps, gpu.raceFinished.player_time);
        setPbResult(pbResultData);

        // Save final lap's checkpoint splits if they exist
        if (checkpointTimesRef.current.length > 0) {
          const lastLapTime = gpu.raceFinished.player_laps.length > 0
            ? gpu.raceFinished.player_laps[gpu.raceFinished.player_laps.length - 1]
            : gpu.raceFinished.player_time;
          if (lastLapTime != null) {
            personalBests.saveSplits(config.track, config.laps, lastLapTime, [...checkpointTimesRef.current]);
          }
        }

        // Save personal best
        const settings = lastRaceSettingsRef.current;
        personalBests.saveBest({
          time: gpu.raceFinished.player_time,
          date: new Date().toISOString(),
          track: config.track,
          laps: config.laps,
          weather: settings?.weather ?? 'clear',
          difficulty: config.model,
          topSpeed: gpu.raceFinished.player_max_speed ?? 0,
          driftScore: gpu.raceFinished.total_drift_score,
        });
      } else {
        setPbResult(null);
      }
    }
  }, [gpu.raceFinished]);

  const handleProceedToRace = useCallback(() => {
    setView('pre_race');
  }, []);

  // --- Speed-based FOV zoom ---
  const isFirstPersonCam = cameraMode === 'hood' || cameraMode === 'bumper';
  const speedFovScale = useMemo(() => {
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    const t = Math.min(1, speed / 200);
    if (isFirstPersonCam) {
      return 1.0 + 0.12 * Math.pow(t, 1.3);
    }
    return 1.0 + 0.08 * Math.pow(t, 1.5);
  }, [gpu.raceState?.player?.speed_kmh, isFirstPersonCam]);

  // --- Camera G-force shift + brake/accel tilt ---
  const gForceTransform = useMemo(() => {
    const throttle = gpu.raceState?.player?.throttle ?? 0;
    const brake = gpu.raceState?.player?.brake ?? 0;
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    if (speed < 5) return '';
    const gY = throttle > 0.6 ? (throttle - 0.6) * 5 : brake > 0.6 ? -(brake - 0.6) * 5 : 0;
    const tiltX = throttle > 0.6 ? -(throttle - 0.6) * 0.5 : brake > 0.6 ? (brake - 0.6) * 0.75 : 0;
    if (Math.abs(gY) < 0.1 && Math.abs(tiltX) < 0.01) return '';
    return `translateY(${gY.toFixed(1)}px) rotateX(${tiltX.toFixed(2)}deg)`;
  }, [gpu.raceState?.player?.throttle, gpu.raceState?.player?.brake, gpu.raceState?.player?.speed_kmh]);

  // --- Speed-based motion blur ---
  const motionBlurPx = useMemo(() => {
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    const t = Math.min(1, speed / 200);
    return t * 1.5;
  }, [gpu.raceState?.player?.speed_kmh]);

  // Track pending demo race config to send once WebSocket connects
  const pendingDemoRaceRef = useRef<{ track: string; laps: number; weather: string; model?: string; player_car?: string; time_of_day?: string; postprocess?: string } | null>(null);

  // --- Send start_race once connected in demo mode ---
  useEffect(() => {
    if ((isDemo || directWsUrl) && gpu.isConnected && pendingDemoRaceRef.current) {
      const { track, laps, weather, model, player_car, time_of_day, postprocess } = pendingDemoRaceRef.current;
      pendingDemoRaceRef.current = null;
      gpu.sendStartRace(track, laps, weather, model, player_car, time_of_day, postprocess);
    }
  }, [isDemo, directWsUrl, gpu.isConnected, gpu.sendStartRace]);

  const handleStartRace = useCallback((track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string, postprocess?: string) => {
    // Save settings for instant replay
    lastRaceSettingsRef.current = { track, laps, weather, model, playerCar, timeOfDay, postprocess };
    // Save config for leaderboard
    raceConfigRef.current = {
      track,
      laps,
      model: model ?? 'carla_pilotnet',
      playerCar: playerCar ?? 'vehicle.tesla.model3',
    };
    setView('racing');
    setRaceWeather(weather);
    // Reset split time tracking for the new race
    checkpointTimesRef.current = [];
    splitLapRef.current = 0;
    // Reset player trail and racing line for the new race
    playerTrailRef.current = [];
    lastTrailTimeRef.current = 0;
    setPlayerTrail([]);
    racingLineRef.current = null;
    setRacingLine(null);
    if (isDemo || directWsUrl) {
      pendingDemoRaceRef.current = { track, laps, weather, model, player_car: playerCar, time_of_day: timeOfDay, postprocess };
      const wsUrl = directWsUrl || DEMO_WS_URL;
      gpu.connectDirect(wsUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
    } else {
      gpu.sendStartRace(track, laps, weather, model, playerCar, timeOfDay, postprocess);
    }
  }, [gpu, isDemo, directWsUrl]);

  const handlePlayAgain = useCallback(() => {
    setView('pre_race');
  }, []);

  // Instant replay: restart with same settings, skip setup screen
  const handleInstantReplay = useCallback(() => {
    const settings = lastRaceSettingsRef.current;
    if (settings) {
      handleStartRace(settings.track, settings.laps, settings.weather, settings.model, settings.playerCar, settings.timeOfDay, settings.postprocess);
    } else {
      setView('pre_race');
    }
  }, [handleStartRace]);

  // --- Enter key for instant race again on results screen ---
  useEffect(() => {
    if (view !== 'results') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleInstantReplay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, handleInstantReplay]);

  const handleMainMenu = useCallback(() => {
    gpu.stopGPU();
    window.location.href = '/';
  }, [gpu]);

  // Build race settings object for RaceResults share link
  const raceSettingsForResults = useMemo(() => {
    const s = lastRaceSettingsRef.current;
    if (!s) return undefined;
    return {
      track: s.track,
      laps: s.laps,
      weather: s.weather,
      model: s.model,
      playerCar: s.playerCar,
      timeOfDay: s.timeOfDay,
      postprocess: s.postprocess,
    };
  }, [view]); // Re-compute when view changes (entering results)

  return (
    <div className="min-h-screen bg-dark-500 text-white">
      {/* GPU setup modal */}
      {view === 'setup' && (
        <GPUConnectionModal
          isOpen={true}
          onClose={() => { window.location.href = '/'; }}
          gpuStatus={gpu.provisioningState}
          wsStatus={gpu.connectionState}
          instanceData={gpu.instanceData}
          error={gpu.error}
          retryCount={gpu.retryCount}
          maxRetries={gpu.maxRetries}
          onStartGPU={gpu.startGPU}
          onStopGPU={gpu.stopGPU}
          onProceedToRace={handleProceedToRace}
          selectedTrack={urlSettings.track}
        />
      )}

      {/* Pre-race setup */}
      {view === 'pre_race' && (
        <RaceSetup
          onStartRace={handleStartRace}
          onBack={() => (isDemo || isQuickstart) ? (window.location.href = '/') : setView('setup')}
          quickstart={isQuickstart}
          isConnected={gpu.isConnected}
          urlSettings={urlSettings}
        />
      )}

      {/* Racing view */}
      {view === 'racing' && (
        <div
          className="relative w-full h-screen overflow-hidden"
          style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}
        >
          {/* Video feed: prefer WebRTC, fall back to JPEG canvas */}
          <div
            className="absolute inset-0"
            style={{
              ...countdownZoomStyle,
              transform: isCountdown
                ? countdownZoomStyle.transform
                : [
                    `scale(${speedFovScale})`,
                    steeringPrediction.transform !== 'none' ? steeringPrediction.transform : '',
                    frameExtrapolation.transform !== 'none' ? frameExtrapolation.transform : '',
                    gForceTransform,
                  ].filter(Boolean).join(' '),
              filter: [
                !useWebGL2 && motionBlurPx > 0.05 ? `blur(${motionBlurPx.toFixed(2)}px)` : '',
                crashDesaturate ? 'grayscale(50%)' : '',
              ].filter(Boolean).join(' ') || 'none',
              transition: 'filter 100ms ease-out',
            }}
          >
          {gpu.remoteStream ? (
            <WebRTCVideo
              remoteStream={gpu.remoteStream}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : useWebGL2 ? (
            <WebGLCanvas
              onBinaryFrame={gpu.onBinaryFrame}
              onH264Frame={gpu.onH264Frame}
              onCodecConfig={gpu.onCodecConfig}
              className="absolute inset-0 w-full h-full object-cover"
              speedKmh={gpu.raceState?.player?.speed_kmh ?? 0}
              steer={gpu.raceState?.player?.steer ?? 0}
              externalCanvasRef={replayCanvasRef}
            />
          ) : (
            <VideoCanvas
              onBinaryFrame={gpu.onBinaryFrame}
              className="absolute inset-0 w-full h-full object-cover"
              externalCanvasRef={replayCanvasRef}
            />
          )}
          </div>

          {/* Speed lines overlay (anime-style radial lines at high speed) */}
          <SpeedLines speedKmh={gpu.raceState?.player.speed_kmh ?? 0} intensityMultiplier={(isFirstPersonCam ? 1.5 : 1.0) * (driftBoostSpeedLines ? 2.0 : 1.0)} />

          {/* Speed effects overlay (vignette + warp + collision flash + gear flash) */}
          <SpeedEffects
            speedKmh={gpu.raceState?.player.speed_kmh ?? 0}
            collisions={gpu.raceState?.collisions}
            gear={gpu.raceState?.player.gear}
          />

          {/* Particle effects overlay (sparks, tire smoke, rain) */}
          <ParticleOverlay
            collisions={gpu.raceState?.collisions}
            handbrake={keysRef.current.space}
            speedKmh={gpu.raceState?.player.speed_kmh ?? 0}
            weather={raceWeather}
          />

          {/* Checkpoint celebration: brief green edge flash */}
          {checkpointFlash && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                boxShadow: 'inset 0 0 60px 15px rgba(76, 175, 80, 0.3)',
                animation: 'checkpointFlash 150ms ease-out',
              }}
            />
          )}

          {/* Nice save cyan edge flash */}
          {niceSave && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                boxShadow: 'inset 0 0 60px 15px rgba(34,211,238,0.25)',
                animation: 'checkpointFlash 300ms ease-out',
              }}
            />
          )}

          {/* Drift boost orange edge glow (1.5s fade-out) */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              boxShadow: driftBoostGlow
                ? 'inset 0 0 80px 20px rgba(255,136,0,0.3), inset 0 0 160px 40px rgba(255,200,0,0.1)'
                : 'inset 0 0 80px 20px rgba(255,136,0,0)',
              transition: driftBoostGlow ? 'box-shadow 0.1s ease-in' : 'box-shadow 1.2s ease-out',
            }}
          />

          {/* Comeback mechanic: slipstream boost edge glow when >3s behind */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              boxShadow: slipstreamBoost
                ? 'inset 0 0 80px 20px rgba(100,150,255,0.15)'
                : 'inset 0 0 80px 20px rgba(100,150,255,0)',
              transition: 'box-shadow 0.8s ease-in-out',
            }}
          />
          {/* SLIPSTREAM label at top-center */}
          <div
            className="absolute top-8 left-1/2 -translate-x-1/2 pointer-events-none z-20"
            style={{
              opacity: slipstreamBoost ? 1 : 0,
              transition: 'opacity 0.8s ease-in-out',
            }}
          >
            <span
              className="text-sm font-bold tracking-[0.3em] uppercase"
              style={{
                color: 'rgba(160,200,255,0.6)',
                textShadow: '0 0 12px rgba(100,150,255,0.4), 0 0 24px rgba(100,150,255,0.2)',
                animation: slipstreamBoost ? 'slipstreamPulse 2s ease-in-out infinite' : 'none',
              }}
            >
              SLIPSTREAM
            </span>
          </div>

          {/* Split time delta popup at checkpoints */}
          <SplitTimeDelta
            delta={splitDelta}
            rawTime={splitRawTime}
            trigger={splitTrigger}
          />

          {/* LAST LAP OVERTAKE! dramatic text overlay */}
          {lastLapOvertake && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div
                className="text-center"
                style={{ animation: 'lastLapOvertake 3s ease-out forwards' }}
              >
                <div className="text-4xl sm:text-6xl font-black text-yellow-400 tracking-wider" style={{ textShadow: '0 0 30px rgba(250,204,21,0.5), 0 2px 8px rgba(0,0,0,0.8)' }}>
                  LAST LAP OVERTAKE!
                </div>
              </div>
            </div>
          )}

          {/* NICE SAVE! popup when recovering from a near-crash */}
          {niceSave && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div
                className="text-center"
                style={{ animation: 'niceSave 2s ease-out forwards' }}
              >
                <div className="text-3xl sm:text-5xl font-black text-cyan-400 tracking-wider" style={{ textShadow: '0 0 30px rgba(34,211,238,0.5), 0 2px 8px rgba(0,0,0,0.8)' }}>
                  NICE SAVE!
                </div>
              </div>
            </div>
          )}

          {/* CLOSE CALL! near-miss popup */}
          {nearMiss && (
            <>
              <div
                className="absolute inset-0 pointer-events-none z-20"
                style={{
                  boxShadow: 'inset 0 0 40px 10px rgba(255,255,255,0.2)',
                  animation: 'nearMissGlow 100ms ease-out forwards',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30" style={{ paddingTop: '15vh' }}>
                <div
                  className="text-center"
                  style={{ animation: 'closeCall 1.3s ease-out forwards' }}
                >
                  <div
                    className="text-2xl sm:text-4xl font-black tracking-wider"
                    style={{
                      color: '#ffffff',
                      textShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.8)',
                    }}
                  >
                    CLOSE CALL!
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Photo Finish approaching tension: pulsing golden edge glow */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              boxShadow: photoFinishTension
                ? 'inset 0 0 100px 30px rgba(255,200,50,0.2)'
                : 'inset 0 0 100px 30px rgba(255,200,50,0)',
              transition: 'box-shadow 0.6s ease-in-out',
              animation: photoFinishTension ? 'photoFinishTensionPulse 1.2s ease-in-out infinite' : 'none',
            }}
          />

          {/* PHOTO FINISH! text overlay (on race results transition) */}
          {photoFinish && (
            <>
              <div
                className="absolute inset-0 pointer-events-none z-30"
                style={{
                  boxShadow: 'inset 0 0 120px 40px rgba(255,200,50,0.3)',
                  animation: 'photoFinishGlow 3s ease-out forwards',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
                <div
                  className="text-center"
                  style={{ animation: 'photoFinishText 3s ease-out forwards' }}
                >
                  <div
                    className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-widest uppercase"
                    style={{
                      color: '#ffd700',
                      textShadow: '0 0 40px rgba(255,215,0,0.6), 0 0 80px rgba(255,200,50,0.3), 0 0 120px rgba(255,180,0,0.15), 0 4px 12px rgba(0,0,0,0.9)',
                      WebkitTextStroke: '1px rgba(255,240,200,0.3)',
                    }}
                  >
                    PHOTO FINISH!
                  </div>
                  <div
                    className="mt-2 text-lg sm:text-xl font-bold tracking-[0.4em] uppercase"
                    style={{
                      color: 'rgba(255,230,150,0.7)',
                      textShadow: '0 0 15px rgba(255,215,0,0.4), 0 2px 6px rgba(0,0,0,0.8)',
                      animation: 'photoFinishSubtext 3s ease-out forwards',
                    }}
                  >
                    TOO CLOSE TO CALL
                  </div>
                </div>
              </div>
            </>
          )}

          <style>{`
            @keyframes checkpointFlash {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes lastLapOvertake {
              0% { opacity: 0; transform: scale(0.5); }
              10% { opacity: 1; transform: scale(1.1); }
              20% { transform: scale(1.0); }
              70% { opacity: 1; }
              100% { opacity: 0; transform: scale(1.0) translateY(-20px); }
            }
            @keyframes niceSave {
              0% { opacity: 0; transform: scale(0.3) rotate(-5deg); }
              15% { opacity: 1; transform: scale(1.1) rotate(1deg); }
              25% { transform: scale(1.0) rotate(0deg); }
              65% { opacity: 1; }
              100% { opacity: 0; transform: scale(1.0) translateY(-15px); }
            }
            @keyframes slipstreamPulse {
              0%, 100% { opacity: 0.5; }
              50% { opacity: 1.0; }
            }
            @keyframes closeCall {
              0% { opacity: 0; transform: scale(0.3); }
              10% { opacity: 1; transform: scale(1.1); }
              18% { transform: scale(1.0); }
              62% { opacity: 1; transform: scale(1.0); }
              100% { opacity: 0; transform: scale(1.0) translateY(-15px); }
            }
            @keyframes nearMissGlow {
              0% { opacity: 0; }
              50% { opacity: 1; }
              100% { opacity: 0; }
            }
            @keyframes photoFinishTensionPulse {
              0%, 100% { opacity: 0.5; }
              50% { opacity: 1.0; }
            }
            @keyframes photoFinishGlow {
              0% { opacity: 0; }
              15% { opacity: 1; }
              70% { opacity: 0.8; }
              100% { opacity: 0; }
            }
            @keyframes photoFinishText {
              0% { opacity: 0; transform: scale(0.3) translateY(20px); }
              8% { opacity: 1; transform: scale(1.15) translateY(0); }
              16% { transform: scale(1.0) translateY(0); }
              60% { opacity: 1; transform: scale(1.0) translateY(0); }
              100% { opacity: 0; transform: scale(1.05) translateY(-30px); }
            }
            @keyframes photoFinishSubtext {
              0% { opacity: 0; transform: translateY(10px); }
              15% { opacity: 0; }
              25% { opacity: 0.7; transform: translateY(0); }
              60% { opacity: 0.7; }
              100% { opacity: 0; }
            }
          `}</style>

          {/* HUD overlay */}
          <RaceHUD raceState={gpu.raceState} latencyMs={gpu.latencyMs} gamepadConnected={gamepad.connected} localKeys={keysRef} />

          {/* Drift score overlay (active drift display + score popups + total score) */}
          <DriftScore
            drift={gpu.raceState?.drift}
            totalDriftScore={gpu.raceState?.total_drift_score}
            driftEndEvent={gpu.latestDriftEnd}
            showDriftBoost={driftBoostActive}
          />

          {/* Exit button */}
          <button
            onClick={handleMainMenu}
            className="absolute top-4 left-4 z-10 pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white/60 hover:text-white text-sm border border-white/10 transition-colors"
          >
            &#x2190; Exit
          </button>

          {/* Camera mode pill */}
          <div className="absolute top-14 left-4 z-10">
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-mono text-white/60 border border-white/10 uppercase tracking-wider">
              {gpu.cameraMode}
            </div>
          </div>

          {/* GPU cost indicator */}
          {gpu.instanceData.cost_so_far > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-mono text-accent/70 border border-accent/20">
                ${gpu.instanceData.cost_so_far.toFixed(4)}
              </div>
            </div>
          )}

          {/* Minimap */}
          <Minimap
            raceState={gpu.raceState}
            challengeGhost={null}
            racingLine={racingLine}
            playerTrail={playerTrail}
            raceFinished={false}
            sectorTimes={null}
          />

          {/* Rear-view mirror disabled */}

          {/* Mute/unmute button */}
          <button
            onClick={() => {
              const newMuted = !engineSound.isMuted;
              engineSound.setMuted(newMuted);
              crowd.setMuted(newMuted);
            }}
            className="absolute top-[88px] left-4 z-10 pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white/60 hover:text-white text-sm border border-white/10 transition-colors"
            title={engineSound.isMuted ? 'Unmute' : 'Mute'}
          >
            {engineSound.isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>

          {/* Respawning overlay */}
          {showRespawning && (
            <div
              className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
              style={{ animation: 'respawn-fade 1.5s ease-out forwards' }}
            >
              <style>{`@keyframes respawn-fade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }`}</style>
              <div className="bg-black/50 backdrop-blur-sm rounded-xl px-8 py-4 border border-accent/30">
                <span className="text-accent text-2xl font-bold font-mono">Respawning...</span>
              </div>
            </div>
          )}

          {/* Connecting overlay: shown when WS is not yet connected */}
          {!gpu.isConnected && (
            <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none bg-black/60">
              <div className="flex flex-col items-center gap-5">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <div
                    className="absolute w-16 h-16 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(34,197,94,0.3) 0%, transparent 70%)',
                      animation: 'connectPulse 2s ease-in-out infinite',
                    }}
                  />
                  <div
                    className="absolute w-10 h-10 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(34,197,94,0.5) 0%, transparent 70%)',
                      animation: 'connectPulse 2s ease-in-out 0.3s infinite',
                    }}
                  />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <span className="text-white text-xl font-bold">Connecting...</span>
                <span className="text-white/40 text-sm">Setting up your race on the GPU</span>
                <style>{`
                  @keyframes connectPulse {
                    0%, 100% { transform: scale(1); opacity: 0.6; }
                    50% { transform: scale(1.8); opacity: 0; }
                  }
                `}</style>
              </div>
            </div>
          )}

          {/* Controls hint: appears briefly when race starts after countdown */}
          <ControlsHint visible={showControlsHint} />

          {/* Photo Mode overlay */}
          {photoModeActive && (
            <PhotoMode
              canvasRef={replayCanvasRef}
              onExit={handleExitPhotoMode}
            />
          )}

          {/* First-time player overlay: full controls guide, dismiss with any key */}
          <FirstTimeOverlay
            visible={showFirstTimeOverlay}
            onDismiss={dismissFirstTimeOverlay}
          />

          {/* Debug overlay: toggle with backtick/tilde key */}
          <DebugOverlay
            connectionState={gpu.connectionState}
            latencyMs={gpu.latencyMs}
            lastFrameTime={gpu.lastFrameTime}
            perfStats={gpu.perfStats}
            noChangeCount={gpu.noChangeCount}
            totalFrameCount={gpu.totalFrameCount}
            dataChannelState={gpu.dataChannelState}
          />
        </div>
      )}

      {/* Results view */}
      {view === 'results' && gpu.raceFinished && (
        <>
          <RaceResults
            result={gpu.raceFinished}
            onPlayAgain={handlePlayAgain}
            onMainMenu={handleMainMenu}
            raceSettings={raceSettingsForResults}
            onInstantReplay={handleInstantReplay}
            personalBestResult={pbResult}
            streakResult={streakResult}
          />
          {/* Photo Finish overlay on results screen */}
          {photoFinish && (
            <>
              <div
                className="fixed inset-0 pointer-events-none z-50"
                style={{
                  boxShadow: 'inset 0 0 120px 40px rgba(255,200,50,0.3)',
                  animation: 'photoFinishGlow 3s ease-out forwards',
                }}
              />
              <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
                <div
                  className="text-center"
                  style={{ animation: 'photoFinishText 3s ease-out forwards' }}
                >
                  <div
                    className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-widest uppercase"
                    style={{
                      color: '#ffd700',
                      textShadow: '0 0 40px rgba(255,215,0,0.6), 0 0 80px rgba(255,200,50,0.3), 0 0 120px rgba(255,180,0,0.15), 0 4px 12px rgba(0,0,0,0.9)',
                      WebkitTextStroke: '1px rgba(255,240,200,0.3)',
                    }}
                  >
                    PHOTO FINISH!
                  </div>
                  <div
                    className="mt-2 text-lg sm:text-xl font-bold tracking-[0.4em] uppercase"
                    style={{
                      color: 'rgba(255,230,150,0.7)',
                      textShadow: '0 0 15px rgba(255,215,0,0.4), 0 2px 6px rgba(0,0,0,0.8)',
                      animation: 'photoFinishSubtext 3s ease-out forwards',
                    }}
                  >
                    TOO CLOSE TO CALL
                  </div>
                </div>
              </div>
              <style>{`
                @keyframes photoFinishGlow {
                  0% { opacity: 0; }
                  15% { opacity: 1; }
                  70% { opacity: 0.8; }
                  100% { opacity: 0; }
                }
                @keyframes photoFinishText {
                  0% { opacity: 0; transform: scale(0.3) translateY(20px); }
                  8% { opacity: 1; transform: scale(1.15) translateY(0); }
                  16% { transform: scale(1.0) translateY(0); }
                  60% { opacity: 1; transform: scale(1.0) translateY(0); }
                  100% { opacity: 0; transform: scale(1.05) translateY(-30px); }
                }
                @keyframes photoFinishSubtext {
                  0% { opacity: 0; transform: translateY(10px); }
                  15% { opacity: 0; }
                  25% { opacity: 0.7; transform: translateY(0); }
                  60% { opacity: 0.7; }
                  100% { opacity: 0; }
                }
              `}</style>
            </>
          )}
        </>
      )}
    </div>
  );
}
