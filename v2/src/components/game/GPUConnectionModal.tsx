import { useEffect, useState } from 'react';
import { Button } from '../common/Button';
import { Card, CardContent } from '../common/Card';

type GPUStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
type WSStatus = 'disconnected' | 'connecting' | 'connected';

interface GPUInfo {
  gpu_name: string;
  price_per_hour: number;
  cost_so_far: number;
  uptime_seconds: number;
  tunnel_url?: string;
}

interface GPUConnectionModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Current GPU provisioning status */
  gpuStatus: GPUStatus;
  /** Current WebSocket connection status */
  wsStatus: WSStatus;
  /** GPU instance information when running */
  gpuInfo: GPUInfo | null;
  /** Error message if any */
  error: string | null;
  /** Callback to start GPU provisioning */
  onStartGPU: () => void;
  /** Callback to stop GPU instance */
  onStopGPU: () => void;
  /** Callback to proceed without GPU (use local AI) */
  onProceedWithLocalAI: () => void;
  /** Callback to proceed with GPU (start race with real AI) */
  onProceedWithGPU?: () => void;
}

/**
 * GPUConnectionModal - Modal for connecting to cloud GPU for real AI racing
 *
 * Displays different states:
 * - Idle: Option to start GPU or use local AI
 * - Starting: Progress indicator with status steps
 * - Running/Connected: GPU info and race start option
 * - Error: Error message with retry options
 */
export function GPUConnectionModal({
  isOpen,
  onClose,
  gpuStatus,
  wsStatus,
  gpuInfo,
  error,
  onStartGPU,
  onStopGPU,
  onProceedWithLocalAI,
  onProceedWithGPU,
}: GPUConnectionModalProps) {
  // Track startup progress for animation
  const [startupStep, setStartupStep] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Simulate startup steps when starting
  useEffect(() => {
    if (gpuStatus === 'starting') {
      const stepInterval = setInterval(() => {
        setStartupStep((prev) => Math.min(prev + 1, 2));
      }, 30000); // Progress every 30 seconds

      const timeInterval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);

      return () => {
        clearInterval(stepInterval);
        clearInterval(timeInterval);
      };
    } else {
      setStartupStep(0);
      setElapsedTime(0);
    }
  }, [gpuStatus]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStartupStep(0);
      setElapsedTime(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatUptime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  };

  const getEstimatedTimeRemaining = (): string => {
    const estimatedTotalSeconds = 120; // 2 minutes estimate
    const remaining = Math.max(0, estimatedTotalSeconds - elapsedTime);
    if (remaining === 0) return 'Almost ready...';
    return `~${Math.ceil(remaining / 60)} min remaining`;
  };

  // Render content based on state
  const renderContent = () => {
    // Error state
    if (gpuStatus === 'error' || error) {
      return (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Connection Error</h2>
            <p className="text-white/60">{error || 'Failed to connect to GPU'}</p>
          </div>

          <div className="bg-dark-400/50 rounded-lg p-4 mb-6">
            <p className="text-sm text-white/70">
              This could be due to network issues or the GPU service being temporarily unavailable.
              You can try again or continue with the local AI instead.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="primary" fullWidth onClick={onStartGPU}>
              Try Again
            </Button>
            <Button variant="ghost" fullWidth onClick={onProceedWithLocalAI}>
              Use Local AI
            </Button>
          </div>
        </>
      );
    }

    // Starting state
    if (gpuStatus === 'starting') {
      const steps = [
        { label: 'Provisioning GPU...', done: startupStep >= 1 },
        { label: 'Installing dependencies...', done: startupStep >= 2 },
        { label: 'Starting server...', done: wsStatus === 'connected' },
      ];

      return (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 relative">
              {/* Spinning loader */}
              <div className="absolute inset-0 rounded-full border-4 border-accent/20" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-accent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Starting GPU...</h2>
            <p className="text-white/60">{getEstimatedTimeRemaining()}</p>
          </div>

          <div className="space-y-3 mb-6">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  step.done
                    ? 'bg-green-500/10 border border-green-500/30'
                    : index === startupStep
                    ? 'bg-accent/10 border border-accent/30'
                    : 'bg-dark-400/50 border border-white/10'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    step.done
                      ? 'bg-green-500'
                      : index === startupStep
                      ? 'bg-accent animate-pulse'
                      : 'bg-white/20'
                  }`}
                >
                  {step.done ? (
                    <svg
                      className="w-4 h-4 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : index === startupStep ? (
                    <div className="w-2 h-2 bg-white rounded-full" />
                  ) : (
                    <span className="text-xs text-white/40">{index + 1}</span>
                  )}
                </div>
                <span
                  className={`text-sm ${
                    step.done
                      ? 'text-green-400'
                      : index === startupStep
                      ? 'text-white'
                      : 'text-white/40'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          <div className="bg-dark-400/50 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-sm text-white/60">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Elapsed: {formatUptime(elapsedTime)}</span>
            </div>
          </div>

          <Button variant="ghost" fullWidth onClick={onStopGPU}>
            Cancel
          </Button>
        </>
      );
    }

    // Running/Connected state
    if (gpuStatus === 'running' && (wsStatus === 'connected' || wsStatus === 'connecting')) {
      return (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-green-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">GPU Connected!</h2>
            <p className="text-white/60">Ready to race against real neural network AI</p>
          </div>

          {/* GPU Info */}
          {gpuInfo && (
            <div className="bg-dark-400/50 rounded-lg p-4 mb-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/60">GPU</span>
                <span className="text-sm text-white font-medium">{gpuInfo.gpu_name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/60">Current Cost</span>
                <span className="text-sm text-accent font-medium">{formatCost(gpuInfo.cost_so_far)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/60">Uptime</span>
                <span className="text-sm text-white font-medium">{formatUptime(gpuInfo.uptime_seconds)}</span>
              </div>
            </div>
          )}

          {/* WebSocket Status */}
          <div className="flex items-center gap-2 mb-4 p-3 bg-dark-400/50 rounded-lg">
            <div
              className={`w-3 h-3 rounded-full ${
                wsStatus === 'connected'
                  ? 'bg-green-500'
                  : wsStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-white">
              {wsStatus === 'connected'
                ? 'WebSocket Connected'
                : wsStatus === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
            </span>
          </div>

          {/* Cost Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-6">
            <div className="flex items-start gap-2">
              <svg
                className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className="text-sm text-yellow-200/80">
                GPU will auto-stop after 5 minutes of inactivity to save costs.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onProceedWithGPU || onClose}
              disabled={wsStatus !== 'connected'}
              rightIcon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              }
            >
              Start Race
            </Button>
          </div>
          <div className="mt-3">
            <Button variant="ghost" size="md" fullWidth onClick={onStopGPU}>
              Stop GPU
            </Button>
          </div>
        </>
      );
    }

    // Stopping state
    if (gpuStatus === 'stopping') {
      return (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 rounded-full border-4 border-white/20" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-white/60 animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Stopping GPU...</h2>
            <p className="text-white/60">Shutting down instance</p>
          </div>
        </>
      );
    }

    // Idle state (default)
    return (
      <>
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent-light/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" />
              <line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" />
              <line x1="15" y1="20" x2="15" y2="23" />
              <line x1="20" y1="9" x2="23" y2="9" />
              <line x1="20" y1="15" x2="23" y2="15" />
              <line x1="1" y1="9" x2="4" y2="9" />
              <line x1="1" y1="15" x2="4" y2="15" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Race Against Real AI?</h2>
          <p className="text-white/60 leading-relaxed">
            Start a cloud GPU to race against a real neural network trained on driving data.
          </p>
        </div>

        {/* Info box */}
        <div className="bg-dark-400/50 rounded-lg p-4 mb-4">
          <h4 className="text-sm font-semibold text-accent mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            What you get
          </h4>
          <ul className="space-y-2 text-sm text-white/70">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>Real neural network (PilotNet/Alpamayo style) making predictions</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>Cloud GPU with CUDA acceleration</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>Low-latency WebSocket connection</span>
            </li>
          </ul>
        </div>

        {/* Cost info */}
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">Estimated cost</span>
            <span className="text-lg font-bold text-accent">~$0.08/hour</span>
          </div>
          <p className="text-xs text-white/50">
            Uses Vast.ai spot instances. Actual cost may vary based on availability.
          </p>
        </div>

        {/* Cost Warning */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-6">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm text-yellow-200/80">
              GPU will auto-stop after 5 minutes of inactivity to save costs.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={onStartGPU}
            leftIcon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
              </svg>
            }
          >
            Start GPU (~2 min)
          </Button>
          <Button variant="ghost" fullWidth onClick={onProceedWithLocalAI}>
            Use Local AI (instant)
          </Button>
        </div>
      </>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-500/95 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gpu-modal-title"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <Card variant="default" className="max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header with close button */}
        <div className="flex items-center justify-end p-4 pb-0">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <CardContent className="flex-1 overflow-y-auto p-6 pt-2">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}

export default GPUConnectionModal;
