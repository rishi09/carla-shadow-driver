import { useState, useCallback, useMemo } from 'react';
import { useGPUConnection } from '../hooks/useGPUConnection.ts';
import { useEngineSound } from '../hooks/useEngineSound.ts';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic.ts';
import { useSteeringPrediction } from '../hooks/useSteeringPrediction.ts';
import { useFrameExtrapolation } from '../hooks/useFrameExtrapolation.ts';
import { useLeaderboard } from '../hooks/useLeaderboard.ts';
import { usePersonalBests } from '../hooks/usePersonalBests.ts';
import { useGamepad } from '../hooks/useGamepad.ts';
import { useStreak } from '../hooks/useStreak.ts';
import { getDailyChallenge, saveDailyChallengeResult } from '../hooks/useDailyChallenge.ts';
import type { PersonalBestResult } from '../hooks/usePersonalBests.ts';
import { VideoCanvas } from '../components/VideoCanvas.tsx';
import { WebGLCanvas, supportsWebGL2 } from '../components/WebGLCanvas.tsx';
import { WebRTCVideo } from '../components/WebRTCVideo.tsx';
import { RaceHUD } from '../components/RaceHUD.tsx';
import { SpeedEffects } from '../components/SpeedEffects.tsx';
import { SpeedLines } from '../components/SpeedLines.tsx';
import { ParticleOverlay } from '../components/ParticleOverlay.tsx';
import { DriftScore } from '../components/DriftScore.tsx';
import { CommentaryOverlay } from '../components/CommentaryOverlay.tsx';
import { AIChatBubble } from '../components/AIChatBubble.tsx';
import { GPUConnectionModal } from '../components/GPUConnectionModal.tsx';
import { RaceResults } from '../components/RaceResults.tsx';
import { RaceSetup } from '../components/RaceSetup.tsx';
import { Minimap } from '../components/Minimap.tsx';
import { ControlsHint } from '../components/ControlsHint.tsx';
import { WeatherOverlay } from '../components/WeatherOverlay.tsx';
import { FirstTimeOverlay } from '../components/FirstTimeOverlay.tsx';
import { PhotoMode } from '../components/PhotoMode.tsx';
import { ClipPreview } from '../components/ClipPreview.tsx';
import { useReplayRecorder } from '../hooks/useReplayRecorder.ts';
import type { KeyState } from '../types/index.ts';
import { useEffect, useRef } from 'react';

type RaceView = 'setup' | 'pre_race' | 'racing' | 'results';

const DEMO_WS_URL = 'ws://localhost:8765';

export function Race() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === 'true';
  const directWsUrl = params.get('ws');
  const isQuickstart = params.get('quickstart') === 'true';
  const [view, setView] = useState<RaceView>(isDemo || directWsUrl || isQuickstart ? 'pre_race' : 'setup');
  const [showRespawning, setShowRespawning] = useState(false);
  const [raceWeather, setRaceWeather] = useState('clear');
  const keysRef = useRef<KeyState>({ w: false, a: false, s: false, d: false, space: false });
  const keyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraIndexRef = useRef(0);
  const CAMERA_MODES = ['chase', 'hood', 'bumper'] as const;

  // Feature-detect WebGL2 once (stable across renders)
  const [useWebGL2] = useState(() => supportsWebGL2());

  // Store last race settings for instant replay and share link
  const lastRaceSettingsRef = useRef<{ track: string; laps: number; weather: string; model?: string; playerCar?: string; timeOfDay?: string } | null>(null);

  const gpu = useGPUConnection();
  const engineSound = useEngineSound();
  const bgMusic = useBackgroundMusic();
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

  // Daily challenge state
  const [isDailyChallenge, setIsDailyChallenge] = useState(false);
  const [dailyChallengePosition, setDailyChallengePosition] = useState<{ position: number; total: number; isNewBest: boolean } | null>(null);

  // First-time player detection
  const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
  const hasPlayedBeforeRef = useRef(() => {
    try { return localStorage.getItem('shadow_driver_has_played') === 'true'; } catch { return false; }
  });

  // Streak result for the most recent finished race
  const [streakResult, setStreakResult] = useState<{ newStreak: number; isNewRecord: boolean } | null>(null);

  // Track previous race_status for countdown detection
  const prevRaceStatusRef = useRef<string | null>(null);

  // Countdown rev engine: track W key during countdown for rev sound
  const countdownRevRef = useRef(false);

  // Controls hint: show when race transitions from countdown to racing
  const [showControlsHint, setShowControlsHint] = useState(false);
  const controlsHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Photo Mode state ---
  const [photoModeActive, setPhotoModeActive] = useState(false);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- Replay clip recording ---
  const replayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const replayRecorder = useReplayRecorder(replayCanvasRef, gpu.raceState);
  const [showClipPreview, setShowClipPreview] = useState(false);

  // --- Screen shake state ---
  const [shakeX, setShakeX] = useState(0);
  const [shakeY, setShakeY] = useState(0);
  const shakeRef = useRef<{ x: number; y: number; decay: number }>({ x: 0, y: 0, decay: 0 });
  const shakeRafRef = useRef<number | null>(null);

  // --- GO screen shake trigger ---
  const goShakeTriggeredRef = useRef(false);

  // --- Camera countdown zoom state ---
  // During countdown: scale(0.95) translateY(-10px), on GO: scale(1.0) translateY(0)
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

  // --- Engine sound + background music update loop ---
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

        // Update background music intensity based on speed and gap
        const speedFactor = player.speed_kmh / 150;
        const gapCloseFactor = (player.gap_seconds != null && Math.abs(player.gap_seconds) < 3) ? 0.3 : 0;
        const intensity = Math.min(1.0, speedFactor + gapCloseFactor);
        bgMusic.updateIntensity(intensity);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(rafId); };
  }, [view, gpu.raceState, engineSound.update, bgMusic.updateIntensity]);

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

  // --- Screen shake helper ---
  const triggerScreenShake = useCallback((magnitude: number, duration: number) => {
    shakeRef.current = {
      x: (Math.random() - 0.5) * 2 * magnitude,
      y: (Math.random() - 0.5) * 2 * magnitude,
      decay: magnitude,
    };

    if (shakeRafRef.current !== null) {
      cancelAnimationFrame(shakeRafRef.current);
    }

    const shakeStart = performance.now();

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
      setShakeX((Math.random() - 0.5) * 2 * currentMag);
      setShakeY((Math.random() - 0.5) * 2 * currentMag);
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
    // sqrt scaling so even moderate collisions (200-500) produce noticeable shake
    const maxIntensity = Math.max(...collisions.map(c => c.intensity));
    const magnitude = Math.min(15, Math.sqrt(maxIntensity) * 0.5);
    // Duration scales with magnitude: 200ms for light taps, up to 500ms for heavy impacts
    const shakeDuration = 200 + Math.min(300, magnitude * 20);
    triggerScreenShake(magnitude, shakeDuration);

    return () => {
      if (shakeRafRef.current !== null) {
        cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = null;
      }
    };
  }, [gpu.raceState?.collisions, engineSound.playImpact, triggerScreenShake]);

  // --- Adaptive music event triggers ---
  // Track previous gap sign for overtake detection and previous lap for final lap
  const prevGapSignRef = useRef<number>(0); // positive = player behind, negative = player ahead
  const prevLapRef = useRef<number>(0);
  const closeGapTriggeredRef = useRef(false);

  useEffect(() => {
    if (view !== 'racing') return;
    const player = gpu.raceState?.player;
    if (!player) return;

    const gap = player.gap_seconds;

    // Overtake detection: gap crosses from positive (behind) to negative (ahead)
    if (gap != null) {
      const currentSign = gap > 0 ? 1 : gap < 0 ? -1 : 0;
      if (prevGapSignRef.current > 0 && currentSign < 0) {
        // Player just overtook the AI
        engineSound.triggerEvent('overtake');
      }
      prevGapSignRef.current = currentSign;

      // Close gap tension: activate when |gap| < 1s, deactivate when |gap| >= 1s
      if (Math.abs(gap) < 1.0) {
        if (!closeGapTriggeredRef.current) {
          closeGapTriggeredRef.current = true;
          engineSound.triggerEvent('close_gap');
        }
      } else {
        if (closeGapTriggeredRef.current) {
          closeGapTriggeredRef.current = false;
          engineSound.stopCloseGapTension();
        }
      }
    }

    // Final lap detection
    if (player.total_laps > 1 && player.lap === player.total_laps && prevLapRef.current !== player.total_laps) {
      engineSound.triggerEvent('final_lap');
    }
    prevLapRef.current = player.lap;
  }, [view, gpu.raceState?.player?.gap_seconds, gpu.raceState?.player?.lap, gpu.raceState?.player?.total_laps, engineSound.triggerEvent, engineSound.stopCloseGapTension]);

  // Collision hit sound (percussive white noise burst, layered on top of existing impact)
  useEffect(() => {
    const collisions = gpu.raceState?.collisions;
    if (!collisions || collisions.length === 0) return;
    engineSound.triggerEvent('collision_hit');
  }, [gpu.raceState?.collisions, engineSound.triggerEvent]);

  // --- Background music lifecycle ---
  useEffect(() => {
    const status = gpu.raceState?.race_status;
    if (view === 'racing' && (status === 'racing' || status === 'finishing' || status === 'countdown')) {
      bgMusic.start();
    } else {
      bgMusic.stop();
    }
  }, [view, gpu.raceState?.race_status, bgMusic.start, bgMusic.stop]);

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

    // Re-acquire wake lock when tab becomes visible again (released on visibility change)
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
        return; // Don't process other keys during countdown
      }

      // Photo mode toggle: P key (only during racing, not during countdown)
      if (key === 'p') {
        if (!photoModeActive) {
          setPhotoModeActive(true);
          gpu.sendPause();
          // Release all keys so car stops
          keysRef.current = { w: false, a: false, s: false, d: false, space: false };
          gpu.sendControls({ w: false, a: false, s: false, d: false, space: false });
        }
        return;
      }

      // Don't process driving keys while in photo mode
      if (photoModeActive) return;

      if (key === 'r') {        // Respawn: teleport player back to last checkpoint
        gpu.sendRespawn();
        setShowRespawning(true);
        if (respawnTimeoutRef.current) clearTimeout(respawnTimeoutRef.current);
        respawnTimeoutRef.current = setTimeout(() => setShowRespawning(false), 1500);
        return;
      }
      if (key === 'backspace') {
        // Full race restart (like Trackmania)
        gpu.sendRestartRace();
        return;
      }
      if (key === 'f') {
        // Toggle fullscreen
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
        return;
      }
      if (key === 'c') {
        cameraIndexRef.current = (cameraIndexRef.current + 1) % CAMERA_MODES.length;
        gpu.sendCameraMode(CAMERA_MODES[cameraIndexRef.current]);
        return;
      }
      if (key === 'v') {
        // Save replay clip (last 15 seconds)
        replayRecorder.saveClip().then(url => {
          if (url) setShowClipPreview(true);
        });
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
      // Send a "release all" control message to the server so the car stops moving
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

    // Send controls at 30Hz, merging keyboard + gamepad
    keyIntervalRef.current = setInterval(() => {
      if (gamepad.connected) {
        // Gamepad connected: send analog controls
        // Also set keyboard keys based on gamepad for server compatibility
        const gpKeys: KeyState = {
          w: gamepad.throttle > 0.05,
          a: gamepad.steering < -0.05,
          s: gamepad.brake > 0.05,
          d: gamepad.steering > 0.05,
          space: gamepad.handbrake,
        };
        // Merge: gamepad takes priority, but also keep keyboard keys active
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
      // Reset key state so stale keys don't persist across view changes
      keysRef.current = { w: false, a: false, s: false, d: false, space: false };
      countdownRevRef.current = false;
    };
  }, [view, gpu.sendControls, gpu.sendRespawn, gpu.sendRestartRace, gpu.sendCameraMode, gpu.sendPause, gpu.raceState?.race_status, photoModeActive, gamepad.connected, gamepad.steering, gamepad.throttle, gamepad.brake, gamepad.handbrake]);

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
      gpu.sendCameraMode(CAMERA_MODES[cameraIndexRef.current]);
    }
  }, [view, gamepad.connected, gamepad.respawn, gamepad.cameraToggle, gamepad.throttle, gpu.raceState?.race_status, gpu.sendRespawn, gpu.sendCameraMode]);

  // --- Watch for race finished ---
  useEffect(() => {
    if (gpu.raceFinished) {
      setView('results');

      // Record streak (consecutive days played)
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
        });

        // Compute personal best result BEFORE saving (so we compare against the old best)
        const settings = lastRaceSettingsRef.current;
        const pbResultData = personalBests.getResult(config.track, config.laps, gpu.raceFinished.player_time);
        setPbResult(pbResultData);

        // Save personal best
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

        // Save daily challenge result if applicable
        if (isDailyChallenge) {
          const daily = getDailyChallenge();
          const dcResult = saveDailyChallengeResult(gpu.raceFinished.player_time, daily.daySeed);
          setDailyChallengePosition(dcResult);
        }
      } else {
        setPbResult(null);
      }
    }
  }, [gpu.raceFinished]);

  // --- Show clip preview when auto-highlight saves a clip ---
  useEffect(() => {
    if (replayRecorder.lastClipUrl) {
      setShowClipPreview(true);
    }
  }, [replayRecorder.lastClipUrl]);

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

  const handleProceedToRace = useCallback(() => {
    setView('pre_race');
  }, []);

  // --- Speed-based FOV zoom ---
  // Subtle scale from 1.0 at rest to 1.05 at 150+ km/h to simulate FOV widening
  const speedFovScale = useMemo(() => {
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    const t = Math.min(1, speed / 150);
    return 1.0 + t * 0.05;
  }, [gpu.raceState?.player?.speed_kmh]);

  // --- Speed-based motion blur ---
  // Subtle CSS blur: 0px at rest, max 1.5px at 200+ km/h
  const motionBlurPx = useMemo(() => {
    const speed = gpu.raceState?.player?.speed_kmh ?? 0;
    const t = Math.min(1, speed / 200);
    return t * 1.5;
  }, [gpu.raceState?.player?.speed_kmh]);

  // Track pending demo race config to send once WebSocket connects
  const pendingDemoRaceRef = useRef<{ track: string; laps: number; weather: string; model?: string; player_car?: string; time_of_day?: string } | null>(null);

  // --- Send start_race once connected in demo mode ---
  useEffect(() => {
    if ((isDemo || directWsUrl) && gpu.isConnected && pendingDemoRaceRef.current) {
      const { track, laps, weather, model, player_car, time_of_day } = pendingDemoRaceRef.current;
      pendingDemoRaceRef.current = null;
      gpu.sendStartRace(track, laps, weather, model, player_car, time_of_day);
    }
  }, [isDemo, directWsUrl, gpu.isConnected, gpu.sendStartRace]);

  const handleStartRace = useCallback((track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string) => {
    // Save settings for instant replay
    lastRaceSettingsRef.current = { track, laps, weather, model, playerCar, timeOfDay };
    // Save config for leaderboard
    raceConfigRef.current = {
      track,
      laps,
      model: model ?? 'carla_pilotnet',
      playerCar: playerCar ?? 'vehicle.tesla.model3',
    };
    setView('racing');
    setRaceWeather(weather);
    if (isDemo || directWsUrl) {
      pendingDemoRaceRef.current = { track, laps, weather, model, player_car: playerCar, time_of_day: timeOfDay };
      const wsUrl = directWsUrl || DEMO_WS_URL;
      gpu.connectDirect(wsUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
    } else {
      gpu.sendStartRace(track, laps, weather, model, playerCar, timeOfDay);
    }
  }, [gpu, isDemo, directWsUrl]);

  // --- Daily Challenge handler ---
  const handleStartDailyChallenge = useCallback(() => {
    const daily = getDailyChallenge();
    setIsDailyChallenge(true);
    setDailyChallengePosition(null);
    handleStartRace(daily.track, daily.laps, daily.weather, daily.model, undefined, daily.timeOfDay);
  }, [handleStartRace]);

  const handlePlayAgain = useCallback(() => {
    setIsDailyChallenge(false);
    setDailyChallengePosition(null);
    setView('pre_race');
  }, []);

  // Instant replay: restart with same settings, skip setup screen
  const handleInstantReplay = useCallback(() => {
    const settings = lastRaceSettingsRef.current;
    if (settings) {
      handleStartRace(settings.track, settings.laps, settings.weather, settings.model, settings.playerCar, settings.timeOfDay);
    } else {
      // Fallback to setup if no saved settings
      setView('pre_race');
    }
  }, [handleStartRace]);

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
        />
      )}

      {/* Pre-race setup */}
      {view === 'pre_race' && (
        <RaceSetup
          onStartRace={handleStartRace}
          onBack={() => (isDemo || isQuickstart) ? (window.location.href = '/') : setView('setup')}
          onStartDailyChallenge={handleStartDailyChallenge}
          quickstart={isQuickstart}
          isConnected={gpu.isConnected}
        />
      )}

      {/* Racing view */}
      {view === 'racing' && (
        <div
          className="relative w-full h-screen overflow-hidden"
          style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}
        >
          {/* Video feed: prefer WebRTC, fall back to JPEG canvas */}
          {/* Speed-based FOV scale + client-side steering prediction + frame extrapolation + motion blur + countdown zoom */}
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
                  ].filter(Boolean).join(' '),
              filter: motionBlurPx > 0.05 ? `blur(${motionBlurPx.toFixed(2)}px)` : 'none',
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
              className="absolute inset-0 w-full h-full object-cover"
              speedKmh={gpu.raceState?.player?.speed_kmh ?? 0}
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
          <SpeedLines speedKmh={gpu.raceState?.player.speed_kmh ?? 0} />

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

          {/* HUD overlay */}
          <RaceHUD raceState={gpu.raceState} latencyMs={gpu.latencyMs} gamepadConnected={gamepad.connected} />

          {/* Drift score overlay (active drift display + score popups + total score) */}
          <DriftScore
            drift={gpu.raceState?.drift}
            totalDriftScore={gpu.raceState?.total_drift_score}
            driftEndEvent={gpu.latestDriftEnd}
          />

          {/* AI race commentary */}
          <CommentaryOverlay messages={gpu.commentary} />

          {/* AI opponent trash talk bubble */}
          <AIChatBubble message={gpu.aiChat} />

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
          <Minimap raceState={gpu.raceState} />

          {/* Mute/unmute button (controls both engine sound and background music) */}
          <button
            onClick={() => {
              const newMuted = !engineSound.isMuted;
              engineSound.setMuted(newMuted);
              bgMusic.setMuted(newMuted);
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
                {/* Pulsing dot animation */}
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

          {/* Save clip button (camera icon) */}
          {replayRecorder.isRecording && (
            <button
              onClick={() => {
                replayRecorder.saveClip().then(url => {
                  if (url) setShowClipPreview(true);
                });
              }}
              className="absolute bottom-20 left-4 z-10 pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white/60 hover:text-white text-sm border border-white/10 transition-colors"
              title="Save Clip (V)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
          )}

          {/* Recording indicator dot */}
          {replayRecorder.isRecording && (
            <div className="absolute bottom-[132px] left-5 z-10 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
              <span className="text-white/30 text-[10px] font-mono">REC</span>
            </div>
          )}

          {/* Clip preview overlay */}
          <ClipPreview
            clipUrl={showClipPreview ? replayRecorder.lastClipUrl : null}
            onDismiss={() => setShowClipPreview(false)}
            onDownload={() => {
              if (replayRecorder.lastClipUrl) {
                const a = document.createElement('a');
                a.href = replayRecorder.lastClipUrl;
                a.download = `shadow-driver-clip-${Date.now()}.webm`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }
            }}
          />

          {/* First-time player overlay: full controls guide, dismiss with any key */}
          <FirstTimeOverlay
            visible={showFirstTimeOverlay}
            onDismiss={() => setShowFirstTimeOverlay(false)}
          />
        </div>
      )}

      {/* Results view */}
      {view === 'results' && gpu.raceFinished && (
        <RaceResults
          result={gpu.raceFinished}
          onPlayAgain={handlePlayAgain}
          onMainMenu={handleMainMenu}
          raceSettings={raceSettingsForResults}
          onInstantReplay={handleInstantReplay}
          personalBestResult={pbResult}
          isDailyChallenge={isDailyChallenge}
          dailyChallengePosition={dailyChallengePosition}
          streakResult={streakResult}
        />
      )}
    </div>
  );
}
