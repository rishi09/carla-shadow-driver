import { useState, useEffect, useRef } from 'react';
import type { GPUProvisioningState, WebSocketConnectionState, GPUInstanceData, GPUError } from '../types/index.ts';

// Racing tips shown during provisioning wait
const LOADING_TIPS = [
  { icon: 'W', text: 'Hold W to rev the engine during countdown' },
  { icon: 'R', text: 'Press R to respawn if you get stuck' },
  { icon: 'C', text: 'Press C to switch camera angles' },
  { icon: 'F', text: 'Press F for fullscreen (immersive!)' },
  { icon: 'M', text: 'Press M to toggle the rear-view mirror' },
  { icon: 'P', text: 'Press P to enter Photo Mode mid-race' },
  { icon: 'V', text: 'Press V to save a replay clip' },
  { icon: 'G', text: 'Press G to record your screen' },
  { icon: '⌫', text: 'Press Backspace for instant race restart' },
  { icon: '⏎', text: 'Press Enter on results to race again instantly' },
  { icon: '🎮', text: 'Plug in an Xbox/PS controller for analog steering' },
  { icon: '🏁', text: 'The AI adapts to your skill — try Hard difficulty!' },
  { icon: '💨', text: 'Drift around corners for bonus drift points' },
  { icon: '🔗', text: 'Share your race link to challenge friends' },
];

// Progress steps shown as a timeline
const SETUP_STEPS = [
  { key: 'gpu', label: 'Finding a GPU', statusMatch: 'provisioning' },
  { key: 'docker', label: 'Loading game engine', statusMatch: 'loading_docker' },
  { key: 'carla', label: 'Starting CARLA simulator', statusMatch: 'starting_carla' },
  { key: 'tunnel', label: 'Creating secure tunnel', statusMatch: 'creating_tunnel' },
  { key: 'ready', label: 'Ready to race!', statusMatch: 'ready' },
];

function getStepIndex(setupStatus: string | null): number {
  if (!setupStatus) return 0;
  const idx = SETUP_STEPS.findIndex(s => s.statusMatch === setupStatus);
  return idx >= 0 ? idx : 0;
}

interface GPUConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  gpuStatus: GPUProvisioningState;
  wsStatus: WebSocketConnectionState;
  instanceData: GPUInstanceData;
  error: GPUError | null;
  retryCount: number;
  maxRetries: number;
  onStartGPU: () => void;
  onStopGPU: () => void;
  onProceedToRace: () => void;
}

export function GPUConnectionModal({
  isOpen, onClose, gpuStatus, wsStatus, instanceData, error,
  retryCount, maxRetries, onStartGPU, onStopGPU, onProceedToRace,
}: GPUConnectionModalProps) {
  // Rotating tip index
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * LOADING_TIPS.length));
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = wsStatus === 'connected';
  const isLoading = gpuStatus === 'starting' || wsStatus === 'connecting';

  // Rotate tips every 4 seconds during loading
  useEffect(() => {
    if (!isLoading) {
      if (tipTimerRef.current) { clearInterval(tipTimerRef.current); tipTimerRef.current = null; }
      return;
    }
    tipTimerRef.current = setInterval(() => {
      setTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
    }, 4000);
    return () => { if (tipTimerRef.current) clearInterval(tipTimerRef.current); };
  }, [isLoading]);

  if (!isOpen) return null;

  const currentStep = getStepIndex(instanceData.setup_status);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">GPU Connection</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Status */}
        <div className="space-y-4 mb-6">
          {gpuStatus === 'idle' && (
            <div className="text-center">
              <p className="text-white/70 mb-4">
                Race against a real neural network running on a cloud GPU.
                Costs ~$0.50-1.50/hour on Vast.ai.
              </p>
              <button
                onClick={onStartGPU}
                className="w-full py-3 px-6 bg-gradient-to-r from-player to-ai rounded-lg text-white font-bold text-lg hover:opacity-90 transition-opacity"
              >
                Start GPU
              </button>
            </div>
          )}

          {isLoading && (
            <div>
              {/* Progress timeline */}
              <div className="mb-6">
                {SETUP_STEPS.map((step, i) => {
                  const isDone = i < currentStep;
                  const isCurrent = i === currentStep;
                  return (
                    <div key={step.key} className="flex items-center gap-3 mb-2 last:mb-0">
                      {/* Step indicator */}
                      <div className={`
                        w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                        ${isDone ? 'bg-player/30 text-player' : isCurrent ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-white/5 text-white/20'}
                      `}>
                        {isDone ? '\u2713' : i + 1}
                      </div>
                      <span className={`text-sm ${isDone ? 'text-player/70' : isCurrent ? 'text-white' : 'text-white/30'}`}>
                        {step.label}
                      </span>
                      {isCurrent && (
                        <div className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin ml-auto" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Status message */}
              <p className="text-white/70 text-center text-sm">
                {instanceData.setup_message || 'Setting up...'}
              </p>
              {instanceData.gpu_name && (
                <p className="text-white/40 text-sm mt-2 text-center">
                  GPU: {instanceData.gpu_name}
                  {instanceData.price_per_hour && ` ($${instanceData.price_per_hour.toFixed(2)}/hr)`}
                </p>
              )}
              {retryCount > 0 && (
                <p className="text-warning/70 text-sm mt-1 text-center">
                  Retry {retryCount}/{maxRetries}
                </p>
              )}

              {/* Rotating tip card */}
              <div className="mt-5 bg-white/5 rounded-lg p-4 border border-white/5 min-h-[60px] flex items-center gap-3 transition-all">
                <div className="w-8 h-8 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-mono text-sm font-bold shrink-0">
                  {LOADING_TIPS[tipIndex].icon}
                </div>
                <p className="text-white/60 text-sm" key={tipIndex} style={{ animation: 'tipFade 0.4s ease-out' }}>
                  {LOADING_TIPS[tipIndex].text}
                </p>
              </div>

              {/* Controls preview */}
              <div className="mt-4 flex justify-center gap-4 text-white/30 text-xs">
                <div className="flex flex-col items-center gap-1">
                  <div className="flex gap-0.5">
                    <span className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">W</span>
                  </div>
                  <div className="flex gap-0.5">
                    <span className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">A</span>
                    <span className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">S</span>
                    <span className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">D</span>
                  </div>
                  <span className="mt-0.5">Drive</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="flex gap-0.5">
                    <span className="w-14 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">Space</span>
                  </div>
                  <span className="mt-1">Handbrake</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="flex gap-0.5">
                    <span className="w-6 h-6 rounded border border-white/20 flex items-center justify-center text-[10px] font-mono">R</span>
                  </div>
                  <span className="mt-1">Respawn</span>
                </div>
              </div>

              <style>{`
                @keyframes tipFade {
                  from { opacity: 0; transform: translateY(4px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
            </div>
          )}

          {isConnected && (
            <div className="text-center">
              <div className="text-player text-4xl mb-2">&#10003;</div>
              <p className="text-player font-bold text-lg mb-1">Connected!</p>
              <p className="text-white/50 text-sm">
                {instanceData.gpu_name}
                {instanceData.price_per_hour && ` - $${instanceData.price_per_hour.toFixed(2)}/hr`}
              </p>
              <button
                onClick={onProceedToRace}
                className="w-full mt-4 py-3 px-6 bg-gradient-to-r from-player to-ai rounded-lg text-white font-bold text-lg hover:opacity-90 transition-opacity animate-glow"
              >
                Start Race!
              </button>
            </div>
          )}

          {gpuStatus === 'error' && error && (
            <div className="text-center">
              <div className="text-warning text-4xl mb-2">!</div>
              <p className="text-warning font-bold mb-1">Error</p>
              <p className="text-white/50 text-sm mb-4">{error.message}</p>
              <button
                onClick={onStartGPU}
                className="w-full py-3 px-6 bg-warning/20 border border-warning/40 rounded-lg text-warning font-medium hover:bg-warning/30 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Cost display */}
        {instanceData.cost_so_far > 0 && (
          <div className="border-t border-white/10 pt-3 flex justify-between text-sm">
            <span className="text-white/40">Cost so far:</span>
            <span className="text-accent font-mono">${instanceData.cost_so_far.toFixed(4)}</span>
          </div>
        )}

        {/* Stop button when running */}
        {(gpuStatus === 'starting' || gpuStatus === 'running') && (
          <button
            onClick={onStopGPU}
            className="w-full mt-4 py-2 px-4 border border-warning/30 rounded-lg text-warning/70 text-sm hover:bg-warning/10 transition-colors"
          >
            Stop GPU
          </button>
        )}
      </div>
    </div>
  );
}
