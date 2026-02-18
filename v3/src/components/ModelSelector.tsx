interface ModelSelectorProps {
  models: string[];
  currentModel: string;
  onSelect: (model: string) => void;
  className?: string;
}

const MODEL_DISPLAY: Record<string, { name: string; desc: string; badge?: string }> = {
  carla_pilotnet: {
    name: 'CARLA PilotNet',
    desc: 'NVIDIA PilotNet trained on CARLA data. Fast, lightweight.',
  },
  pilotnet: {
    name: 'PilotNet',
    desc: 'Original NVIDIA end-to-end driving network.',
  },
  alpamayo: {
    name: 'Alpamayo R1-10B',
    desc: '10B parameter Vision-Language-Action model. Requires 24GB+ VRAM.',
    badge: 'ADVANCED',
  },
};

export function ModelSelector({ models, currentModel, onSelect, className = '' }: ModelSelectorProps) {
  if (models.length === 0) return null;

  return (
    <div className={`bg-dark-300/80 backdrop-blur-sm rounded-lg border border-white/10 p-4 ${className}`}>
      <h3 className="text-white/60 text-xs font-mono uppercase tracking-wider mb-3">AI Model</h3>
      <div className="space-y-2">
        {models.map(model => {
          const info = MODEL_DISPLAY[model] || { name: model, desc: '' };
          const isActive = model === currentModel;
          return (
            <button
              key={model}
              onClick={() => onSelect(model)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                isActive
                  ? 'bg-ai/20 border-ai/50 text-white'
                  : 'bg-dark-400/50 border-white/5 text-white/60 hover:border-white/20 hover:text-white/80'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{info.name}</span>
                {info.badge && (
                  <span className="text-[10px] font-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                    {info.badge}
                  </span>
                )}
              </div>
              {info.desc && <div className="text-xs text-white/30 mt-0.5">{info.desc}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
