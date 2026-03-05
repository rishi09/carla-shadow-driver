import { useState } from 'react';

interface ModelSelectorProps {
  models: string[];
  currentModel: string;
  onSelect: (model: string) => void;
  className?: string;
}

type Difficulty = 'Easy' | 'Medium' | 'Hard';

interface ModelInfo {
  name: string;
  description: string;
  difficulty: Difficulty;
}

const DIFFICULTY_STYLES: Record<Difficulty, { bg: string; text: string; border: string }> = {
  Easy: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40' },
  Medium: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40' },
  Hard: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' },
};

const MODEL_INFO: Record<string, ModelInfo> = {
  carla_pilotnet: {
    name: 'Steady Driver',
    description:
      'Imitation learning model trained on human driving. Cautious and consistent, rarely crashes but takes wider lines.',
    difficulty: 'Easy',
  },
  pilotnet: {
    name: 'Weekend Racer',
    description:
      'Classic PilotNet architecture. More aggressive cornering but occasionally misjudges turns.',
    difficulty: 'Medium',
  },
  alpamayo: {
    name: 'Pro Racer',
    description:
      'Alpamayo-R1 10B parameter vision-language model. Aggressive racing lines, pushes the limits.',
    difficulty: 'Hard',
  },
};

function getModelInfo(modelId: string): ModelInfo {
  return (
    MODEL_INFO[modelId] || {
      name: modelId,
      description: '',
      difficulty: 'Medium' as Difficulty,
    }
  );
}

export function ModelSelector({ models, currentModel, onSelect, className = '' }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (models.length === 0) return null;

  const currentInfo = getModelInfo(currentModel);
  const currentDiffStyle = DIFFICULTY_STYLES[currentInfo.difficulty];

  return (
    <div className={`bg-dark-300/80 backdrop-blur-sm rounded-lg border border-white/10 p-4 ${className}`}>
      <h3 className="text-white/60 text-xs font-mono uppercase tracking-wider mb-3">AI Model</h3>

      {/* Selected model dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left px-3 py-2.5 rounded-lg border bg-ai/20 border-ai/50 text-white transition-colors hover:bg-ai/30"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{currentInfo.name}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${currentDiffStyle.bg} ${currentDiffStyle.text} ${currentDiffStyle.border}`}
            >
              {currentInfo.difficulty}
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Dropdown options */}
      {isOpen && (
        <div className="mt-2 space-y-1.5 border border-white/10 rounded-lg bg-dark-400/90 backdrop-blur-sm p-2">
          {models.map((model) => {
            const info = getModelInfo(model);
            const diffStyle = DIFFICULTY_STYLES[info.difficulty];
            const isActive = model === currentModel;
            return (
              <button
                key={model}
                onClick={() => {
                  onSelect(model);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-ai/20 border-ai/50 text-white'
                    : 'bg-dark-400/50 border-white/5 text-white/60 hover:border-white/20 hover:text-white/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{info.name}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${diffStyle.bg} ${diffStyle.text} ${diffStyle.border}`}
                  >
                    {info.difficulty}
                  </span>
                </div>
                {info.description && (
                  <div className="text-xs text-white/30 mt-0.5 line-clamp-1">{info.description}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Bio card for the selected model */}
      {currentInfo.description && (
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-dark-400/60 border border-white/5">
          <p className="text-xs text-white/50 leading-relaxed">{currentInfo.description}</p>
        </div>
      )}
    </div>
  );
}
