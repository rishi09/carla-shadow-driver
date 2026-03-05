import { useState, useEffect, useRef, useCallback } from 'react';
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
  { icon: '\u232B', text: 'Press Backspace for instant race restart' },
  { icon: '\u23CE', text: 'Press Enter on results to race again instantly' },
  { icon: '\uD83C\uDFAE', text: 'Plug in an Xbox/PS controller for analog steering' },
  { icon: '\uD83C\uDFC1', text: 'The AI adapts to your skill \u2014 try Hard difficulty!' },
  { icon: '\uD83D\uDCA8', text: 'Drift around corners for bonus drift points' },
  { icon: '\uD83D\uDD17', text: 'Share your race link to challenge friends' },
];

// Progress steps shown as a timeline
const SETUP_STEPS = [
  { key: 'gpu', label: 'Finding a GPU', statusMatch: 'provisioning' },
  { key: 'docker', label: 'Loading game engine', statusMatch: 'loading_docker' },
  { key: 'carla', label: 'Starting CARLA simulator', statusMatch: 'starting_carla' },
  { key: 'tunnel', label: 'Creating secure tunnel', statusMatch: 'creating_tunnel' },
  { key: 'ready', label: 'Ready to race!', statusMatch: 'ready' },
];

// Track info for the available CARLA maps
const TRACK_INFO: Record<string, { name: string; turns: number; lapLength: string; difficulty: string; description: string }> = {
  'Town05': { name: 'Town05 \u2014 Urban Grid', turns: 12, lapLength: '~2.1 km', difficulty: 'Medium', description: 'Wide multilane roads with many intersections' },
  'Town03': { name: 'Town03 \u2014 Mixed Town', turns: 8, lapLength: '~1.8 km', difficulty: 'Medium', description: 'Suburban streets blending into highway sections' },
  'Town04': { name: 'Town04 \u2014 Highway Circuit', turns: 6, lapLength: '~2.5 km', difficulty: 'Easy', description: 'Long straights with a small town section' },
  'Town01': { name: 'Town01 \u2014 Small Town', turns: 10, lapLength: '~1.5 km', difficulty: 'Medium', description: 'River crossings, bridges, moderate intersections' },
  'Town02': { name: 'Town02 \u2014 Residential', turns: 14, lapLength: '~1.2 km', difficulty: 'Hard', description: 'Narrow winding streets with tight corners' },
  'Town10HD': { name: 'Town10HD \u2014 Downtown', turns: 16, lapLength: '~1.4 km', difficulty: 'Hard', description: 'Dense skyscraper blocks with tight turns' },
  'Town07': { name: 'Town07 \u2014 Rural Highway', turns: 5, lapLength: '~2.8 km', difficulty: 'Easy', description: 'Open rural highway loop through countryside' },
};

function getStepIndex(setupStatus: string | null): number {
  if (!setupStatus) return 0;
  const idx = SETUP_STEPS.findIndex(s => s.statusMatch === setupStatus);
  return idx >= 0 ? idx : 0;
}

// ---------------------------------------------------------------------------
// Interactive 2D Car Practice Canvas
// ---------------------------------------------------------------------------
function CarPracticeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const carRef = useRef({ x: 150, y: 100, angle: -Math.PI / 2, speed: 0 });
  const trailRef = useRef<Array<{ x: number; y: number; age: number }>>([]);
  const frameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Active key display state
  const [activeKeys, setActiveKeys] = useState({ w: false, a: false, s: false, d: false });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) {
      e.preventDefault();
      keysRef.current[key] = true;
      setActiveKeys(prev => ({ ...prev, [key]: true }));
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) {
      keysRef.current[key] = false;
      setActiveKeys(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 300;
    const H = 200;

    const loop = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 0.016;
      lastTimeRef.current = time;

      const car = carRef.current;
      const keys = keysRef.current;

      // Physics
      const acceleration = 120;
      const braking = 180;
      const friction = 60;
      const turnSpeed = 3.0;
      const maxSpeed = 150;

      // Throttle / brake
      if (keys['w']) {
        car.speed += acceleration * dt;
      } else if (keys['s']) {
        car.speed -= braking * dt;
      } else {
        // Friction
        if (car.speed > 0) car.speed = Math.max(0, car.speed - friction * dt);
        else if (car.speed < 0) car.speed = Math.min(0, car.speed + friction * dt);
      }
      car.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, car.speed));

      // Steering (only when moving)
      if (Math.abs(car.speed) > 2) {
        const steerFactor = Math.min(1, Math.abs(car.speed) / 40);
        if (keys['a']) car.angle -= turnSpeed * steerFactor * dt * Math.sign(car.speed);
        if (keys['d']) car.angle += turnSpeed * steerFactor * dt * Math.sign(car.speed);
      }

      // Move
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;

      // Wrap around edges
      if (car.x < -10) car.x = W + 10;
      if (car.x > W + 10) car.x = -10;
      if (car.y < -10) car.y = H + 10;
      if (car.y > H + 10) car.y = -10;

      // Add trail point when moving
      if (Math.abs(car.speed) > 5) {
        trailRef.current.push({ x: car.x, y: car.y, age: 0 });
        if (trailRef.current.length > 200) trailRef.current.shift();
      }

      // Age trail
      for (const pt of trailRef.current) {
        pt.age += dt;
      }
      // Remove old trail points
      trailRef.current = trailRef.current.filter(pt => pt.age < 5);

      // --- Draw ---
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, W, H);

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += 30) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += 30) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }

      // Draw trail
      for (const pt of trailRef.current) {
        const alpha = Math.max(0, 0.4 - pt.age * 0.08);
        ctx.fillStyle = `rgba(76, 175, 80, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw car
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      // Car body
      const carW = 18;
      const carH = 10;
      ctx.fillStyle = '#4CAF50';
      ctx.shadowColor = '#4CAF50';
      ctx.shadowBlur = 8;
      ctx.fillRect(-carW / 2, -carH / 2, carW, carH);
      ctx.shadowBlur = 0;

      // Windshield
      ctx.fillStyle = '#81C784';
      ctx.fillRect(carW / 2 - 4, -carH / 2 + 2, 3, carH - 4);

      // Taillights
      ctx.fillStyle = keys['s'] ? '#ff4444' : '#882222';
      ctx.fillRect(-carW / 2 - 1, -carH / 2 + 1, 2, 2);
      ctx.fillRect(-carW / 2 - 1, carH / 2 - 3, 2, 2);

      // Headlights
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(carW / 2 - 1, -carH / 2 + 1, 2, 2);
      ctx.fillRect(carW / 2 - 1, carH / 2 - 3, 2, 2);

      ctx.restore();

      // Speed indicator
      const speedPct = Math.abs(car.speed) / maxSpeed;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(8, H - 14, 60, 6);
      ctx.fillStyle = speedPct > 0.7 ? '#ef4444' : '#4CAF50';
      ctx.fillRect(8, H - 14, 60 * speedPct, 6);

      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '9px monospace';
      ctx.fillText(`${Math.abs(Math.round(car.speed))} km/h`, 72, H - 8);

      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div className="mt-4">
      <p className="text-white/40 text-xs text-center mb-2 tracking-wide uppercase">
        Practice your controls while you wait
      </p>
      <div className="relative rounded-lg overflow-hidden border border-white/10 mx-auto" style={{ width: 300, height: 200 }}>
        <canvas ref={canvasRef} width={300} height={200} className="block" />
        {/* WASD overlay in bottom-right */}
        <div className="absolute bottom-2 right-2 flex flex-col items-center gap-0.5 opacity-60">
          <div className="flex gap-0.5">
            <span className={`w-5 h-5 rounded text-[9px] font-mono flex items-center justify-center transition-colors ${activeKeys.w ? 'bg-player/40 text-player border border-player/60' : 'bg-white/5 text-white/30 border border-white/10'}`}>W</span>
          </div>
          <div className="flex gap-0.5">
            <span className={`w-5 h-5 rounded text-[9px] font-mono flex items-center justify-center transition-colors ${activeKeys.a ? 'bg-player/40 text-player border border-player/60' : 'bg-white/5 text-white/30 border border-white/10'}`}>A</span>
            <span className={`w-5 h-5 rounded text-[9px] font-mono flex items-center justify-center transition-colors ${activeKeys.s ? 'bg-player/40 text-player border border-player/60' : 'bg-white/5 text-white/30 border border-white/10'}`}>S</span>
            <span className={`w-5 h-5 rounded text-[9px] font-mono flex items-center justify-center transition-colors ${activeKeys.d ? 'bg-player/40 text-player border border-player/60' : 'bg-white/5 text-white/30 border border-white/10'}`}>D</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Track Info Panel
// ---------------------------------------------------------------------------
function TrackInfoPanel({ trackId }: { trackId?: string }) {
  const info = TRACK_INFO[trackId || 'Town05'] || TRACK_INFO['Town05'];
  const difficultyColor = info.difficulty === 'Easy' ? 'text-player' : info.difficulty === 'Hard' ? 'text-warning' : 'text-accent';

  return (
    <div className="mt-4 bg-white/5 rounded-lg p-3 border border-white/5">
      <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Track Info</p>
      <p className="text-white font-bold text-sm mb-1">{info.name}</p>
      <p className="text-white/50 text-xs mb-2">{info.description}</p>
      <div className="flex gap-4 text-xs">
        <div>
          <span className="text-white/30">Turns: </span>
          <span className="text-white/70 font-mono">{info.turns}</span>
        </div>
        <div>
          <span className="text-white/30">Lap: </span>
          <span className="text-white/70 font-mono">{info.lapLength}</span>
        </div>
        <div>
          <span className="text-white/30">Difficulty: </span>
          <span className={`font-bold ${difficultyColor}`}>{info.difficulty}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown Estimation Bar
// ---------------------------------------------------------------------------
function CountdownEstimation({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Estimate range: 60-90 seconds, use asymptotic fill that slows near the end
  const estimateLow = 60;
  const estimateHigh = 90;
  const midEstimate = (estimateLow + estimateHigh) / 2;
  // Asymptotic progress: fills quickly at first, slows near 95%
  const progress = Math.min(0.95, 1 - Math.exp(-elapsed / midEstimate * 1.8));

  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-white/30 mb-1">
        <span>Usually ready in ~60-90 seconds</span>
        <span className="font-mono">{elapsed}s</span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${progress * 100}%`,
            background: 'linear-gradient(90deg, #4CAF50, #FFD700)',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------
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
  selectedTrack?: string;
}

export function GPUConnectionModal({
  isOpen, onClose, gpuStatus, wsStatus, instanceData, error,
  retryCount, maxRetries, onStartGPU, onStopGPU, onProceedToRace,
  selectedTrack,
}: GPUConnectionModalProps) {
  // Rotating tip index
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * LOADING_TIPS.length));
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingStartRef = useRef<number>(0);

  const isConnected = wsStatus === 'connected';
  const isLoading = gpuStatus === 'starting' || wsStatus === 'connecting';

  // Track when loading starts for countdown estimation
  useEffect(() => {
    if (isLoading && loadingStartRef.current === 0) {
      loadingStartRef.current = Date.now();
    }
    if (!isLoading) {
      loadingStartRef.current = 0;
    }
  }, [isLoading]);

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

  // Show interactive practice during the middle loading steps (GPU found, loading engine/CARLA)
  const showPractice = isLoading && currentStep >= 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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

              {/* Countdown estimation bar */}
              {loadingStartRef.current > 0 && (
                <CountdownEstimation startTime={loadingStartRef.current} />
              )}

              {/* Status message */}
              <p className="text-white/70 text-center text-sm mt-3">
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

              {/* Track info panel */}
              <TrackInfoPanel trackId={selectedTrack} />

              {/* Interactive car practice */}
              {showPractice && <CarPracticeCanvas />}

              {/* Rotating tip card */}
              <div className="mt-4 bg-white/5 rounded-lg p-4 border border-white/5 min-h-[60px] flex items-center gap-3 transition-all">
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
