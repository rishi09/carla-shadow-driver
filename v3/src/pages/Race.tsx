import { useState, useCallback, useMemo } from 'react';
import { useGPUConnection } from '../hooks/useGPUConnection.ts';
import { useEngineSound } from '../hooks/useEngineSound.ts';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic.ts';
import { useSteeringPrediction } from '../hooks/useSteeringPrediction.ts';
import { VideoCanvas } from '../components/VideoCanvas.tsx';
import { WebRTCVideo } from '../components/WebRTCVideo.tsx';
import { RaceHUD } from '../components/RaceHUD.tsx';
import { SpeedEffects } from '../components/SpeedEffects.tsx';
import { SpeedLines } from '../components/SpeedLines.tsx';
import { ParticleOverlay } from '../components/ParticleOverlay.tsx';
import { GPUConnectionModal } from '../components/GPUConnectionModal.tsx';
import { RaceResults } from '../components/RaceResults.tsx';
import { RaceSetup } from '../components/RaceSetup.tsx';
import { Minimap } from '../components/Minimap.tsx';
import { ControlsHint } from '../components/ControlsHint.tsx';
import type { KeyState } from '../types/index.ts';
import { useEffect, useRef } from 'react';

type RaceView = 'setup' | 'pre_race' | 'racing' | 'results';

const DEMO_WS_URL = 'ws://localhost:8765';

export function Race() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === 'true';
  const directWsUrl = params.get('ws');
  const [view, setView] = useState<RaceView>(isDemo || directWsUrl ? 'pre_race' : 'setup');
  const [showRespawning, setShowRespawning] = useState(false);
  const [raceWeather, setRaceWeather] = useState('clear');
  const keysRef = useRef<KeyState>({ w: false, a: false, s: false, d: false, space: false });
  const keyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraIndexRef = useRef(0);
  const CAMERA_MODES = ['chase', 'hood', 'bumper'] as const;

  // Store last race settings for instant replay and share link
  const lastRaceSettingsRef = useRef<{ track: string; laps: number; weather: string; model?: string; playerCar?: string } | null>(null);

  const gpu = useGPUConnection();
  const engineSound = useEngineSound();
  const bgMusic = useBackgroundMusic();
  const steeringPrediction = useSteeringPrediction(keysRef, view === 'racing', gpu.raceState?.player?.speed_kmh ?? 0);

  // Track previous race_status for countdown detection
  const prevRaceStatusRef = useRef<string | null>(null);

  // Countdown rev engine: track W key during countdown for rev sound
  const countdownRevRef = useRef(false);

  // Controls hint: show when race transitions from countdown to racing
  const [showControlsHint, setShowControlsHint] = useState(false);
  const controlsHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setShowControlsHint(true);
      if (controlsHintTimeoutRef.current) clearTimeout(controlsHintTimeoutRef.current);
      controlsHintTimeoutRef.current = setTimeout(() => setShowControlsHint(false), 4000);
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
    const maxIntensity = Math.max(...collisions.map(c => c.intensity));
    const magnitude = Math.min(10, maxIntensity / 500);
    triggerScreenShake(magnitude, 300);

    return () => {
      if (shakeRafRef.current !== null) {
        cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = null;
      }
    };
  }, [gpu.raceState?.collisions, engineSound.playImpact, triggerScreenShake]);

  // --- Background music lifecycle ---
  useEffect(() => {
    const status = gpu.raceState?.race_status;
    if (view === 'racing' && (status === 'racing' || status === 'countdown')) {
      bgMusic.start();
    } else {
      bgMusic.stop();
    }
  }, [view, gpu.raceState?.race_status, bgMusic.start, bgMusic.stop]);

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

      if (key === 'r') {
        gpu.sendRespawn();
        setShowRespawning(true);
        if (respawnTimeoutRef.current) clearTimeout(respawnTimeoutRef.current);
        respawnTimeoutRef.current = setTimeout(() => setShowRespawning(false), 1500);
        return;
      }
      if (key === 'c') {
        cameraIndexRef.current = (cameraIndexRef.current + 1) % CAMERA_MODES.length;
        gpu.sendCameraMode(CAMERA_MODES[cameraIndexRef.current]);
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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Send controls at 30Hz
    keyIntervalRef.current = setInterval(() => {
      gpu.sendControls(keysRef.current);
    }, 33);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
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
  }, [view, gpu.sendControls, gpu.sendRespawn, gpu.sendCameraMode, gpu.raceState?.race_status]);

  // --- Watch for race finished ---
  useEffect(() => {
    if (gpu.raceFinished) {
      setView('results');
    }
  }, [gpu.raceFinished]);

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
  }, [view]);

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
  const pendingDemoRaceRef = useRef<{ track: string; laps: number; weather: string; model?: string; player_car?: string } | null>(null);

  // --- Send start_race once connected in demo mode ---
  useEffect(() => {
    if ((isDemo || directWsUrl) && gpu.isConnected && pendingDemoRaceRef.current) {
      const { track, laps, weather, model, player_car } = pendingDemoRaceRef.current;
      pendingDemoRaceRef.current = null;
      gpu.sendStartRace(track, laps, weather, model, player_car);
    }
  }, [isDemo, directWsUrl, gpu.isConnected, gpu.sendStartRace]);

  const handleStartRace = useCallback((track: string, laps: number, weather: string, model?: string, playerCar?: string) => {
    // Save settings for instant replay
    lastRaceSettingsRef.current = { track, laps, weather, model, playerCar };
    setView('racing');
    setRaceWeather(weather);
    if (isDemo || directWsUrl) {
      pendingDemoRaceRef.current = { track, laps, weather, model, player_car: playerCar };
      const wsUrl = directWsUrl || DEMO_WS_URL;
      gpu.connectDirect(wsUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
    } else {
      gpu.sendStartRace(track, laps, weather, model, playerCar);
    }
  }, [gpu, isDemo, directWsUrl]);

  const handlePlayAgain = useCallback(() => {
    setView('pre_race');
  }, []);

  // Instant replay: restart with same settings, skip setup screen
  const handleInstantReplay = useCallback(() => {
    const settings = lastRaceSettingsRef.current;
    if (settings) {
      handleStartRace(settings.track, settings.laps, settings.weather, settings.model, settings.playerCar);
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
          onBack={() => isDemo ? (window.location.href = '/') : setView('setup')}
        />
      )}

      {/* Racing view */}
      {view === 'racing' && (
        <div
          className="relative w-full h-screen overflow-hidden"
          style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}
        >
          {/* Video feed: prefer WebRTC, fall back to JPEG canvas */}
          {/* Speed-based FOV scale + client-side steering prediction + motion blur + countdown zoom */}
          <div
            className="absolute inset-0"
            style={{
              ...countdownZoomStyle,
              transform: isCountdown
                ? countdownZoomStyle.transform
                : (steeringPrediction.transform !== 'none'
                  ? `scale(${speedFovScale}) ${steeringPrediction.transform}`
                  : `scale(${speedFovScale})`),
              filter: motionBlurPx > 0.05 ? `blur(${motionBlurPx.toFixed(2)}px)` : 'none',
            }}
          >
          {gpu.remoteStream ? (
            <WebRTCVideo
              remoteStream={gpu.remoteStream}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <VideoCanvas
              onBinaryFrame={gpu.onBinaryFrame}
              className="absolute inset-0 w-full h-full object-cover"
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
          <RaceHUD raceState={gpu.raceState} latencyMs={gpu.latencyMs} />

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
            className="absolute bottom-4 left-4 z-10 pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white/60 hover:text-white text-sm border border-white/10 transition-colors"
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
            <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
              <div className="bg-black/70 backdrop-blur-md rounded-xl px-10 py-6 border border-white/20 flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-3 border-white/30 border-t-accent rounded-full animate-spin" />
                <span className="text-white text-xl font-bold font-mono">Connecting to GPU...</span>
                <span className="text-white/50 text-sm font-mono">Setting up CARLA race</span>
              </div>
            </div>
          )}

          {/* Controls hint: appears briefly when race starts after countdown */}
          <ControlsHint visible={showControlsHint} />
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
        />
      )}
    </div>
  );
}
