import { useState, useCallback } from 'react';
import { useGPUConnection } from '../hooks/useGPUConnection.ts';
import { useEngineSound } from '../hooks/useEngineSound.ts';
import { useBackgroundMusic } from '../hooks/useBackgroundMusic.ts';
import { VideoCanvas } from '../components/VideoCanvas.tsx';
import { RaceHUD } from '../components/RaceHUD.tsx';
import { SpeedEffects } from '../components/SpeedEffects.tsx';
import { GPUConnectionModal } from '../components/GPUConnectionModal.tsx';
import { ModelSelector } from '../components/ModelSelector.tsx';
import { RaceResults } from '../components/RaceResults.tsx';
import { RaceSetup } from '../components/RaceSetup.tsx';
import { Minimap } from '../components/Minimap.tsx';
import type { KeyState } from '../types/index.ts';
import { useEffect, useRef } from 'react';

type RaceView = 'setup' | 'pre_race' | 'racing' | 'results';

const DEMO_WS_URL = 'ws://localhost:8765';

export function Race() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === 'true';
  const directWsUrl = params.get('ws');
  const [view, setView] = useState<RaceView>(isDemo || directWsUrl ? 'pre_race' : 'setup');
  const [currentModel, setCurrentModel] = useState('carla_pilotnet');
  const [showRespawning, setShowRespawning] = useState(false);
  const keysRef = useRef<KeyState>({ w: false, a: false, s: false, d: false, space: false });
  const keyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const respawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraIndexRef = useRef(0);
  const CAMERA_MODES = ['chase', 'hood', 'bumper'] as const;

  const gpu = useGPUConnection();
  const engineSound = useEngineSound();
  const bgMusic = useBackgroundMusic();

  // Track previous race_status for countdown detection
  const prevRaceStatusRef = useRef<string | null>(null);

  // --- Screen shake state ---
  const [shakeX, setShakeX] = useState(0);
  const [shakeY, setShakeY] = useState(0);
  const shakeRef = useRef<{ x: number; y: number; decay: number }>({ x: 0, y: 0, decay: 0 });
  const shakeRafRef = useRef<number | null>(null);

  // --- Engine sound + background music update loop ---
  useEffect(() => {
    if (view !== 'racing') return;

    let rafId: number;
    const tick = () => {
      const player = gpu.raceState?.player;
      if (player) {
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

  // --- Countdown beeps ---
  useEffect(() => {
    const status = gpu.raceState?.race_status ?? null;
    if (status === 'countdown' && prevRaceStatusRef.current !== 'countdown') {
      engineSound.playCountdownBeeps();
    }
    prevRaceStatusRef.current = status;
  }, [gpu.raceState?.race_status, engineSound.playCountdownBeeps]);

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
    // Shake magnitude: proportional to intensity, capped at 10px
    const magnitude = Math.min(10, maxIntensity / 500);

    // Set initial shake values
    shakeRef.current = {
      x: (Math.random() - 0.5) * 2 * magnitude,
      y: (Math.random() - 0.5) * 2 * magnitude,
      decay: magnitude,
    };

    // Cancel any existing shake animation
    if (shakeRafRef.current !== null) {
      cancelAnimationFrame(shakeRafRef.current);
    }

    const shakeStart = performance.now();
    const shakeDuration = 300; // ms

    const animateShake = (now: number) => {
      const elapsed = now - shakeStart;
      if (elapsed >= shakeDuration) {
        setShakeX(0);
        setShakeY(0);
        shakeRafRef.current = null;
        return;
      }

      // Decay factor: starts at 1, goes to 0 over shakeDuration
      const decayFactor = 1 - elapsed / shakeDuration;
      const currentMag = magnitude * decayFactor;

      const newX = (Math.random() - 0.5) * 2 * currentMag;
      const newY = (Math.random() - 0.5) * 2 * currentMag;
      setShakeX(newX);
      setShakeY(newY);

      shakeRafRef.current = requestAnimationFrame(animateShake);
    };

    shakeRafRef.current = requestAnimationFrame(animateShake);

    return () => {
      if (shakeRafRef.current !== null) {
        cancelAnimationFrame(shakeRafRef.current);
        shakeRafRef.current = null;
      }
    };
  }, [gpu.raceState?.collisions, engineSound.playImpact]);

  // --- Background music lifecycle ---
  useEffect(() => {
    const status = gpu.raceState?.race_status;
    if (view === 'racing' && (status === 'racing' || status === 'countdown')) {
      bgMusic.start();
    } else {
      bgMusic.stop();
    }
  }, [view, gpu.raceState?.race_status, bgMusic.start, bgMusic.stop]);

  // --- Keyboard controls ---
  useEffect(() => {
    if (view !== 'racing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
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
    };
  }, [view, gpu.sendControls, gpu.sendRespawn, gpu.sendCameraMode]);

  // --- Watch for race finished ---
  useEffect(() => {
    if (gpu.raceFinished) {
      setView('results');
    }
  }, [gpu.raceFinished]);

  const handleProceedToRace = useCallback(() => {
    setView('pre_race');
  }, []);

  // Track pending demo race config to send once WebSocket connects
  const pendingDemoRaceRef = useRef<{ track: string; laps: number; weather: string } | null>(null);

  // --- Send start_race once connected in demo mode ---
  useEffect(() => {
    if ((isDemo || directWsUrl) && gpu.isConnected && pendingDemoRaceRef.current) {
      const { track, laps, weather } = pendingDemoRaceRef.current;
      pendingDemoRaceRef.current = null;
      gpu.sendStartRace(track, laps, weather);
    }
  }, [isDemo, gpu.isConnected, gpu.sendStartRace]);

  const handleStartRace = useCallback((track: string, laps: number, weather: string) => {
    setView('racing');
    if (isDemo || directWsUrl) {
      pendingDemoRaceRef.current = { track, laps, weather };
      const wsUrl = directWsUrl || DEMO_WS_URL;
      gpu.connectDirect(wsUrl.replace('https://', 'wss://').replace('http://', 'ws://'));
    } else {
      gpu.sendStartRace(track, laps, weather);
    }
  }, [gpu, isDemo, directWsUrl]);

  const handleSwitchModel = useCallback((model: string) => {
    setCurrentModel(model);
    gpu.sendSwitchModel(model);
  }, [gpu]);

  const handlePlayAgain = useCallback(() => {
    setView('pre_race');
  }, []);

  const handleMainMenu = useCallback(() => {
    gpu.stopGPU();
    window.location.href = '/';
  }, [gpu]);

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
          className="relative w-full h-screen"
          style={{ transform: `translate(${shakeX}px, ${shakeY}px)` }}
        >
          {/* Video feed */}
          <VideoCanvas
            onBinaryFrame={gpu.onBinaryFrame}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Speed effects overlay (speed lines + vignette) */}
          <SpeedEffects speedKmh={gpu.raceState?.player.speed_kmh ?? 0} />

          {/* HUD overlay */}
          <RaceHUD raceState={gpu.raceState} latencyMs={gpu.latencyMs} />

          {/* Model selector (top-right, collapsible) */}
          {gpu.availableModels.length > 0 && (
            <div className="absolute top-4 right-4 z-10 pointer-events-auto">
              <ModelSelector
                models={gpu.availableModels}
                currentModel={currentModel}
                onSelect={handleSwitchModel}
              />
            </div>
          )}

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
        </div>
      )}

      {/* Results view */}
      {view === 'results' && gpu.raceFinished && (
        <RaceResults
          result={gpu.raceFinished}
          onPlayAgain={handlePlayAgain}
          onMainMenu={handleMainMenu}
        />
      )}
    </div>
  );
}
