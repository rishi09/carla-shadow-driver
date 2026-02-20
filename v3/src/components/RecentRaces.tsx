import { useEffect, useRef, useState } from 'react';

interface RaceResult {
  name: string;
  track: string;
  time: number;
  beat_ai: boolean;
  gap: number;
  difficulty: string;
  timestamp: number;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${secs.toFixed(1)}s`;
}

function ResultEntry({ result }: { result: RaceResult }) {
  const difficultyColor: Record<string, string> = {
    Easy: 'text-green-400',
    Medium: 'text-amber-400',
    Hard: 'text-red-400',
  };
  const color = difficultyColor[result.difficulty] || 'text-white/50';

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-5 text-sm">
      <span className="text-white/70 font-medium">{result.name}</span>
      {result.beat_ai ? (
        <>
          <span className="text-green-400">beat</span>
          <span className={color}>{result.difficulty} AI</span>
          <span className="text-white/30">by</span>
          <span className="text-white/60 font-mono">{Math.abs(result.gap).toFixed(1)}s</span>
        </>
      ) : (
        <>
          <span className="text-red-400/70">lost to</span>
          <span className={color}>{result.difficulty} AI</span>
        </>
      )}
      <span className="text-white/30">on</span>
      <span className="text-cyan-400/70">{result.track}</span>
      <span className="text-white/20">in</span>
      <span className="text-white/40 font-mono">{formatTime(result.time)}</span>
      <span className="text-white/15 mx-1">&mdash;</span>
      <span className="text-white/25 text-xs">{timeAgo(result.timestamp)}</span>
    </span>
  );
}

interface RecentRacesProps {
  results: RaceResult[];
}

export function RecentRaces({ results }: RecentRacesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || results.length === 0) return;

    let animationId: number;
    let pos = 0;

    function tick() {
      if (!isHovered && el) {
        pos -= 0.5; // pixels per frame
        const contentWidth = el.scrollWidth / 2; // We duplicate content
        if (Math.abs(pos) >= contentWidth) {
          pos = 0;
        }
        el.style.transform = `translateX(${pos}px)`;
      }
      animationId = requestAnimationFrame(tick);
    }

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [results, isHovered]);

  if (results.length === 0) {
    return null;
  }

  // Duplicate content for seamless looping
  const displayResults = [...results, ...results];

  return (
    <div
      className="w-full overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mb-3 text-center">
        <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/20">
          Recent races
        </span>
      </div>
      <div className="relative">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#030308] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#030308] to-transparent z-10 pointer-events-none" />

        <div
          ref={scrollRef}
          className="inline-flex items-center py-2"
          style={{ willChange: 'transform' }}
        >
          {displayResults.map((result, i) => (
            <ResultEntry key={`${result.timestamp}-${i}`} result={result} />
          ))}
        </div>
      </div>
    </div>
  );
}
