import { useState, useMemo } from 'react';
import { Card } from '../common/Card';
import { Button } from '../common/Button';

type GameMode = 'head-to-head' | 'time-trial';
type Difficulty = 'easy' | 'medium' | 'hard';

interface TrackSelectProps {
  mode: GameMode;
  onSelectTrack: (trackId: string) => void;
  onBack: () => void;
}

interface TrackData {
  id: string;
  name: string;
  icon: string;
  difficulty: Difficulty;
  description: string;
  parTime: number; // in milliseconds
  goldTime: number; // in milliseconds
}

const TRACKS: TrackData[] = [
  {
    id: 'sunset-speedway',
    name: 'Sunset Speedway',
    icon: '🌅',
    difficulty: 'easy',
    description: 'A smooth coastal track perfect for beginners. Wide lanes and gentle curves.',
    parTime: 55000, // 55 seconds
    goldTime: 42000, // 42 seconds
  },
  {
    id: 'mountain-pass',
    name: 'Mountain Pass',
    icon: '⛰️',
    difficulty: 'medium',
    description: 'Winding mountain roads with elevation changes. Test your cornering skills.',
    parTime: 70000, // 70 seconds
    goldTime: 55000, // 55 seconds
  },
  {
    id: 'nightmare-circuit',
    name: 'Nightmare Circuit',
    icon: '💀',
    difficulty: 'hard',
    description: 'Treacherous hairpins and narrow passages. Only the best survive.',
    parTime: 90000, // 90 seconds
    goldTime: 72000, // 72 seconds
  },
];

/**
 * Get the best time for a track/mode combination from localStorage
 */
const getBestTime = (trackId: string, mode: string): number | null => {
  try {
    const key = `best_${trackId}_${mode}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    // localStorage may be unavailable in private browsing mode
    return null;
  }
};

/**
 * Format time in milliseconds to MM:SS.mmm format
 */
const formatTime = (ms: number | null): string => {
  if (ms === null) return '--:--.---';

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

/**
 * Format time in a shorter format for display
 */
const formatTimeShort = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
};

const difficultyConfig: Record<Difficulty, { label: string; description: string; bgClass: string; textClass: string; glowColor: string }> = {
  easy: {
    label: 'BEGINNER',
    description: 'Wide roads, gentle turns',
    bgClass: 'bg-green-500/20',
    textClass: 'text-green-400',
    glowColor: 'rgba(34, 197, 94, 0.4)',
  },
  medium: {
    label: 'NORMAL',
    description: 'Some tricky corners',
    bgClass: 'bg-amber-500/20',
    textClass: 'text-amber-400',
    glowColor: 'rgba(245, 158, 11, 0.4)',
  },
  hard: {
    label: 'EXPERT',
    description: 'Narrow roads, sharp turns',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-400',
    glowColor: 'rgba(239, 68, 68, 0.4)',
  },
};

export function TrackSelect({ mode, onSelectTrack, onBack }: TrackSelectProps) {
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);

  const handleTrackClick = (trackId: string) => {
    setSelectedTrack(trackId);
  };

  const handleStartRace = () => {
    if (selectedTrack) {
      onSelectTrack(selectedTrack);
    }
  };

  const modeLabel = mode === 'head-to-head' ? 'Race Against Computer' : 'Practice Mode';

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
      {/* Header Section */}
      <div className="text-center mb-12">
        <div className="relative inline-block">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-2 text-white">
            PICK A TRACK
          </h1>
          <p className="text-lg text-white/60 mt-2">
            Choose where you want to race
          </p>

          {/* Mode badge */}
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-dark-200/60 border border-white/10">
            <span className="text-white/60 text-base">Mode:</span>
            <span className={`text-base font-semibold ${mode === 'head-to-head' ? 'text-gradient-human' : 'text-gradient'}`}>
              {modeLabel}
            </span>
          </div>
        </div>

        {/* Decorative line */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-accent/50" />
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-accent/50" />
        </div>
      </div>

      {/* Track Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl w-full mb-12">
        {TRACKS.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            mode={mode}
            isSelected={selectedTrack === track.id}
            isHovered={hoveredTrack === track.id}
            onSelect={() => handleTrackClick(track.id)}
            onHover={() => setHoveredTrack(track.id)}
            onLeave={() => setHoveredTrack(null)}
          />
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col items-center gap-4">
        {selectedTrack && (
          <Button
            variant="primary"
            size="lg"
            onClick={handleStartRace}
            className="min-w-[200px] animate-pulse-slow"
            rightIcon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            }
          >
            Start Race
          </Button>
        )}

        <Button
          variant="ghost"
          size="md"
          onClick={onBack}
          leftIcon={
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          }
        >
          Back to Mode Select
        </Button>
      </div>
    </div>
  );
}

interface TrackCardProps {
  track: TrackData;
  mode: GameMode;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHover: () => void;
  onLeave: () => void;
}

function TrackCard({
  track,
  mode,
  isSelected,
  isHovered,
  onSelect,
  onHover,
  onLeave,
}: TrackCardProps) {
  const diffConfig = difficultyConfig[track.difficulty];

  const bestTime = useMemo(
    () => getBestTime(track.id, mode),
    [track.id, mode]
  );

  const hasBestTime = bestTime !== null;
  const isGoldTime = hasBestTime && bestTime <= track.goldTime;
  const isParTime = hasBestTime && bestTime <= track.parTime;

  return (
    <Card
      variant="interactive"
      padding="none"
      className={`
        relative overflow-hidden cursor-pointer
        transition-all duration-300 ease-out
        ${isSelected
          ? `border-accent ring-2 ring-accent/50 scale-[1.02]`
          : 'hover:scale-[1.02]'
        }
        ${isHovered && !isSelected ? 'border-white/30' : ''}
      `}
      style={{
        boxShadow: isSelected
          ? `0 0 30px ${diffConfig.glowColor}`
          : isHovered
            ? `0 0 20px ${diffConfig.glowColor}`
            : undefined,
      }}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Gradient overlay based on difficulty */}
      <div
        className={`
          absolute inset-0 opacity-20 transition-opacity duration-300
          ${isHovered || isSelected ? 'opacity-30' : ''}
        `}
        style={{
          background: `linear-gradient(135deg, ${diffConfig.glowColor} 0%, transparent 70%)`,
        }}
      />

      {/* Content */}
      <div className="relative p-6">
        {/* Track Icon */}
        <div className="text-5xl mb-4 filter drop-shadow-lg">
          {track.icon}
        </div>

        {/* Track Name */}
        <h3 className="text-xl font-bold text-white mb-2 tracking-wide uppercase">
          {track.name}
        </h3>

        {/* Difficulty Badge */}
        <div
          className={`
            inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold
            ${diffConfig.bgClass} ${diffConfig.textClass}
            border border-current/30 mb-2
          `}
          title={diffConfig.description}
        >
          {diffConfig.label}
        </div>

        {/* Difficulty description */}
        <p className="text-white/50 text-sm mb-4">
          {diffConfig.description}
        </p>

        {/* Description */}
        <p className="text-white/60 text-base mb-6 leading-relaxed min-h-[50px]">
          {track.description}
        </p>

        {/* Divider */}
        <div className="h-px bg-white/10 mb-4" />

        {/* Times Section */}
        <div className="space-y-3 mb-6">
          {/* Personal Best */}
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-sm">Your Best Time</span>
            <span
              className={`
                font-mono text-base font-semibold
                ${isGoldTime ? 'text-yellow-400' : isParTime ? 'text-green-400' : hasBestTime ? 'text-white' : 'text-white/30'}
              `}
            >
              {hasBestTime ? formatTime(bestTime) : 'Not played yet'}
              {isGoldTime && <span className="ml-1">(Trophy)</span>}
            </span>
          </div>

          {/* Target Time - simplified explanation */}
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-sm" title="A good target time to beat">
              Target Time
            </span>
            <span className="font-mono text-base text-white/70">{formatTimeShort(track.parTime)}</span>
          </div>

          {/* Gold Time - simplified explanation */}
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-sm" title="The best possible time - very hard to beat!">
              Best Possible
            </span>
            <span className="font-mono text-base text-yellow-400/80">{formatTimeShort(track.goldTime)} (Gold)</span>
          </div>
        </div>

        {/* Select Button */}
        <button
          className={`
            w-full py-4 px-4 rounded-lg font-semibold text-base uppercase tracking-wider
            transition-all duration-200
            ${isSelected
              ? 'bg-accent text-dark-400'
              : 'bg-white/10 text-white hover:bg-white/20 border border-white/10 hover:border-white/30'
            }
          `}
          aria-pressed={isSelected}
        >
          {isSelected ? 'Track Selected!' : 'Choose This Track'}
        </button>

        {/* Selected Indicator */}
        {isSelected && (
          <div className="absolute top-4 right-4">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-dark-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default TrackSelect;
