import { useState, useCallback } from 'react';
import { useGPUConnection } from '../hooks/useGPUConnection.ts';
import { VideoCanvas } from '../components/VideoCanvas.tsx';
import { RaceHUD } from '../components/RaceHUD.tsx';
import { SpeedEffects } from '../components/SpeedEffects.tsx';
import { GPUConnectionModal } from '../components/GPUConnectionModal.tsx';
import { ModelSelector } from '../components/ModelSelector.tsx';
import { RaceResults } from '../components/RaceResults.tsx';
import { RaceSetup } from '../components/RaceSetup.tsx';
import type { KeyState } from '../types/index.ts';
import { useEffect, useRef } from 'react';

type RaceView = 'setup' | 'pre_race' | 'racing' | 'results';

export function Race() {
  const [view, setView] = useState<RaceView>('setup');
  const [currentModel, setCurrentModel] = useState('carla_pilotnet');
  const keysRef = useRef<KeyState>({ w: false, a: false, s: false, d: false, space: false });
  const keyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gpu = useGPUConnection();

  // --- Keyboard controls ---
  useEffect(() => {
    if (view !== 'racing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
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
    };
  }, [view, gpu.sendControls]);

  // --- Watch for race finished ---
  useEffect(() => {
    if (gpu.raceFinished) {
      setView('results');
    }
  }, [gpu.raceFinished]);

  const handleProceedToRace = useCallback(() => {
    setView('pre_race');
  }, []);

  const handleStartRace = useCallback((track: string, laps: number, weather: string) => {
    setView('racing');
    gpu.sendStartRace(track, laps, weather);
  }, [gpu]);

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
          onBack={() => setView('setup')}
        />
      )}

      {/* Racing view */}
      {view === 'racing' && (
        <div className="relative w-full h-screen">
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

          {/* GPU cost indicator */}
          {gpu.instanceData.cost_so_far > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-mono text-accent/70 border border-accent/20">
                ${gpu.instanceData.cost_so_far.toFixed(4)}
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
