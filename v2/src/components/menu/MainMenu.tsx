import { useState } from 'react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { HowToPlay } from './HowToPlay';

type GameMode = 'head-to-head' | 'time-trial';

interface MainMenuProps {
  onSelectMode?: (mode: GameMode) => void;
}

export function MainMenu({ onSelectMode }: MainMenuProps) {
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null);
  const [isHovering, setIsHovering] = useState<GameMode | null>(null);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  const handleModeSelect = (mode: GameMode) => {
    setSelectedMode(mode);
    onSelectMode?.(mode);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      {/* How to Play Modal */}
      <HowToPlay
        isOpen={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
      />

      {/* Hero Section */}
      <div className="text-center mb-16">
        {/* Animated Title */}
        <div className="relative inline-block">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4">
            <span className="text-gradient-human">Shadow</span>
            <span className="text-white mx-3">vs</span>
            <span className="text-gradient-ai">Driver</span>
          </h1>

          {/* Subtle glow effect behind title */}
          <div
            className="absolute inset-0 blur-3xl opacity-30 -z-10"
            style={{
              background: 'linear-gradient(90deg, rgba(76, 175, 80, 0.4) 0%, rgba(33, 150, 243, 0.4) 100%)',
            }}
          />
        </div>

        {/* Tagline with animation */}
        <p className="text-xl md:text-2xl text-white/60 font-light animate-pulse-slow">
          A Racing Game - Drive and Beat the Computer!
        </p>

        {/* Decorative line */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-human/50" />
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-ai/50" />
        </div>
      </div>

      {/* Mode Selection Cards */}
      <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full mb-12">
        {/* Head-to-Head Mode */}
        <ModeCard
          mode="head-to-head"
          title="Race Against Computer"
          description="Drive side-by-side with the computer. First car to finish 3 laps wins!"
          icon={<HeadToHeadIcon />}
          primaryColor="human"
          secondaryColor="ai"
          isSelected={selectedMode === 'head-to-head'}
          isHovering={isHovering === 'head-to-head'}
          onHover={() => setIsHovering('head-to-head')}
          onLeave={() => setIsHovering(null)}
          onSelect={() => handleModeSelect('head-to-head')}
          features={['Two cars racing at once', 'See who is faster', 'Fun competition']}
        />

        {/* Time Trial Mode */}
        <ModeCard
          mode="time-trial"
          title="Practice Mode"
          description="Drive alone at your own pace. No pressure, just practice and improve!"
          icon={<TimeTrialIcon />}
          primaryColor="accent"
          secondaryColor="accent"
          isSelected={selectedMode === 'time-trial'}
          isHovering={isHovering === 'time-trial'}
          onHover={() => setIsHovering('time-trial')}
          onLeave={() => setIsHovering(null)}
          onSelect={() => handleModeSelect('time-trial')}
          features={['Drive at your own speed', 'Save your best times', 'Great for beginners']}
        />
      </div>

      {/* Play Button */}
      <div className="flex flex-col items-center gap-4">
        <Button
          variant={selectedMode ? 'primary' : 'ghost'}
          size="lg"
          disabled={!selectedMode}
          className="min-w-[200px] text-lg"
          rightIcon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          }
        >
          {selectedMode ? 'Choose a Track' : 'Select a Mode First'}
        </Button>

        {selectedMode && (
          <p className="text-base text-white/40 animate-pulse">
            Click the button above to continue
          </p>
        )}

        {/* How to Play Button */}
        <Button
          variant="ghost"
          size="md"
          onClick={() => setShowHowToPlay(true)}
          className="mt-4"
          leftIcon={
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
        >
          How to Play (Help)
        </Button>
      </div>
    </div>
  );
}

interface ModeCardProps {
  mode: GameMode;
  title: string;
  description: string;
  icon: React.ReactNode;
  primaryColor: 'human' | 'ai' | 'accent';
  secondaryColor: 'human' | 'ai' | 'accent';
  isSelected: boolean;
  isHovering: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
  features: string[];
}

function ModeCard({
  title,
  description,
  icon,
  primaryColor,
  isSelected,
  isHovering,
  onHover,
  onLeave,
  onSelect,
  features,
}: ModeCardProps) {
  const colorMap = {
    human: {
      border: 'border-human/30 hover:border-human/60',
      selectedBorder: 'border-human',
      glow: 'shadow-glow-human',
      bg: 'from-human/10 to-transparent',
      icon: 'text-human',
      bullet: 'bg-human',
    },
    ai: {
      border: 'border-ai/30 hover:border-ai/60',
      selectedBorder: 'border-ai',
      glow: 'shadow-glow-ai',
      bg: 'from-ai/10 to-transparent',
      icon: 'text-ai',
      bullet: 'bg-ai',
    },
    accent: {
      border: 'border-accent/30 hover:border-accent/60',
      selectedBorder: 'border-accent',
      glow: 'shadow-glow-accent',
      bg: 'from-accent/10 to-transparent',
      icon: 'text-accent',
      bullet: 'bg-accent',
    },
  };

  const colors = colorMap[primaryColor];

  return (
    <Card
      variant="interactive"
      padding="none"
      role="button"
      aria-label={`Select ${title} mode. ${description}`}
      aria-pressed={isSelected}
      tabIndex={0}
      className={`
        relative overflow-hidden cursor-pointer
        transition-all duration-300 ease-out
        ${isSelected ? `${colors.selectedBorder} ${colors.glow}` : colors.border}
        ${isHovering || isSelected ? 'scale-[1.02]' : ''}
      `}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Gradient overlay */}
      <div
        className={`
          absolute inset-0 bg-gradient-to-br ${colors.bg}
          opacity-0 transition-opacity duration-300
          ${isHovering || isSelected ? 'opacity-100' : ''}
        `}
      />

      {/* Content */}
      <div className="relative p-8">
        {/* Icon */}
        <div
          className={`
            w-16 h-16 rounded-lg mb-6
            bg-dark-300/80 backdrop-blur-sm
            flex items-center justify-center
            border border-white/10
            transition-all duration-300
            ${isHovering || isSelected ? colors.icon : 'text-white/60'}
          `}
        >
          {icon}
        </div>

        {/* Title */}
        <h3 className="text-2xl font-bold text-white mb-3">
          {title}
        </h3>

        {/* Description */}
        <p className="text-white/70 mb-6 leading-relaxed text-base">
          {description}
        </p>

        {/* Features list */}
        <ul className="space-y-3">
          {features.map((feature, index) => (
            <li key={index} className="flex items-center gap-3 text-base text-white/60">
              <div className={`w-2 h-2 rounded-full ${colors.bullet} opacity-70`} />
              {feature}
            </li>
          ))}
        </ul>

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-4 right-4">
            <div
              className={`
                w-8 h-8 rounded-full
                bg-gradient-to-br ${colors.bg.replace('to-transparent', `to-${primaryColor}/30`)}
                flex items-center justify-center
                border border-${primaryColor}/50
              `}
            >
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// Icons
function HeadToHeadIcon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {/* Two cars racing */}
      <rect x="2" y="8" width="8" height="4" rx="1" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />

      <rect x="14" y="8" width="8" height="4" rx="1" />
      <circle cx="16" cy="13" r="1.5" />
      <circle cx="20" cy="13" r="1.5" />

      {/* Speed lines */}
      <line x1="1" y1="10" x2="0" y2="10" strokeOpacity="0.5" />
      <line x1="13" y1="10" x2="11" y2="10" strokeOpacity="0.5" />
    </svg>
  );
}

function TimeTrialIcon() {
  return (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      {/* Stopwatch */}
      <circle cx="12" cy="13" r="8" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="13" x2="15" y2="13" />
      <line x1="12" y1="5" x2="12" y2="3" />
      <line x1="9" y1="3" x2="15" y2="3" />
      {/* Speed indicator */}
      <path d="M18 7l2-2" strokeOpacity="0.7" />
    </svg>
  );
}
