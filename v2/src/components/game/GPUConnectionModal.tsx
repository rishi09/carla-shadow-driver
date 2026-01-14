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
  setup_status?: string | null;
  setup_message?: string | null;
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
  /** Current retry count */
  retryCount?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
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
  retryCount = 0,
  maxRetries = 3,
  onStartGPU,
  onStopGPU,
  onProceedWithLocalAI,
  onProceedWithGPU,
}: GPUConnectionModalProps) {
  // Track elapsed time for display
  const [elapsedTime, setElapsedTime] = useState(0);

  // Track elapsed time when starting
  useEffect(() => {
    if (gpuStatus === 'starting') {
      const timeInterval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);

      return () => {
        clearInterval(timeInterval);
      };
    } else {
      setElapsedTime(0);
    }
  }, [gpuStatus]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
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
      // Get real status from GPU or use defaults
      const setupStatus = gpuInfo?.setup_status || 'provisioning';
      const setupMessage = gpuInfo?.setup_message || 'Finding an available GPU...';
      const isRetrying = setupStatus === 'retrying';

      // Status explainer mapping - tells user what's happening
      const getStatusExplainer = (status: string): string => {
        switch (status) {
          case 'provisioning':
            return 'Searching the GPU marketplace for an available machine with enough power to run the AI model.';
          case 'booting':
            return 'The GPU server is starting up. This includes loading the operating system and GPU drivers.';
          case 'installing':
            return 'Installing Python dependencies and downloading the neural network model (~500MB).';
          case 'tunneling':
            return 'Creating a secure tunnel so your browser can communicate with the GPU server.';
          case 'starting':
            return 'Launching the AI inference server and preparing for WebSocket connections.';
          case 'retrying':
            return 'The previous GPU had issues. Automatically trying a different one...';
          case 'ready':
            return 'GPU is ready! Connecting now...';
          default:
            return 'Setting up the cloud GPU environment for real-time AI inference.';
        }
      };

      return (
        <>
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 relative">
              {/* Spinning loader */}
              <div className="absolute inset-0 rounded-full border-4 border-accent/20" />
              <div className={`absolute inset-0 rounded-full border-4 border-transparent border-t-accent animate-spin ${isRetrying ? 'border-t-yellow-500' : ''}`} />
              <div className="absolute inset-0 flex items-center justify-center">
                {isRetrying ? (
                  <svg
                    className="w-6 h-6 text-yellow-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                ) : (
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
                )}
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {isRetrying ? 'Trying Another GPU...' : 'Starting GPU...'}
            </h2>
            {retryCount > 0 && (
              <p className="text-yellow-400 text-sm mb-1">
                Attempt {retryCount + 1} of {maxRetries + 1}
              </p>
            )}
            <p className="text-white/60">{getEstimatedTimeRemaining()}</p>
          </div>

          {/* Current status - real message from GPU */}
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
              <div>
                <p className="text-white font-medium">{setupMessage}</p>
                <p className="text-white/50 text-sm mt-1">{getStatusExplainer(setupStatus)}</p>
              </div>
            </div>
          </div>

          {/* GPU info if available */}
          {gpuInfo?.gpu_name && (
            <div className="bg-dark-400/50 rounded-lg p-3 mb-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/60">Selected GPU</span>
                <span className="text-white font-medium">{gpuInfo.gpu_name}</span>
              </div>
            </div>
          )}

          {/* Timer and info */}
          <div className="bg-dark-400/50 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-white">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span className="text-lg font-mono">{formatUptime(elapsedTime)}</span>
              </div>
              <span className="text-white/40 text-sm">elapsed</span>
            </div>
            <div className="text-xs text-white/50">
              <p>Typically takes 1-2 minutes. If it takes longer, the system will automatically try a different GPU.</p>
            </div>
          </div>

          {/* What's happening explainer */}
          <div className="bg-dark-400/30 rounded-lg p-3 mb-4 border border-white/5">
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2">What's happening</h4>
            <ol className="text-xs text-white/60 space-y-1">
              <li className={setupStatus === 'provisioning' ? 'text-accent' : ''}>1. Find GPU on Vast.ai marketplace</li>
              <li className={setupStatus === 'booting' || setupStatus === 'installing' ? 'text-accent' : ''}>2. Boot server &amp; install dependencies</li>
              <li className={setupStatus === 'tunneling' ? 'text-accent' : ''}>3. Create secure tunnel connection</li>
              <li className={setupStatus === 'starting' || setupStatus === 'ready' ? 'text-accent' : ''}>4. Start AI inference server</li>
            </ol>
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
