import type { GPUProvisioningState, WebSocketConnectionState, GPUInstanceData, GPUError } from '../types/index.ts';

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
  if (!isOpen) return null;

  const isConnected = wsStatus === 'connected';
  const isLoading = gpuStatus === 'starting' || wsStatus === 'connecting';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-md w-full p-6 shadow-2xl">
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
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
              <p className="text-white/70">
                {instanceData.setup_message || 'Setting up...'}
              </p>
              {instanceData.gpu_name && (
                <p className="text-white/40 text-sm mt-2">
                  GPU: {instanceData.gpu_name}
                  {instanceData.price_per_hour && ` ($${instanceData.price_per_hour.toFixed(2)}/hr)`}
                </p>
              )}
              {retryCount > 0 && (
                <p className="text-warning/70 text-sm mt-1">
                  Retry {retryCount}/{maxRetries}
                </p>
              )}
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
