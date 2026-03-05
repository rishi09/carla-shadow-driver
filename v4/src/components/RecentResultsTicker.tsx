import { useEffect, useRef, useState } from 'react';

/**
 * RecentResultsTicker - Scrolling ticker showing the player's recent race
 * completions from localStorage leaderboard data.
 *
 * Reads from the same 'shadow-driver-v3-leaderboard' key used by useLeaderboard.
 * Formats each result as a short string and scrolls horizontally with CSS
 * gradient masks at the edges.
 *
 * If no results exist (first visit), renders nothing.
 */

const STORAGE_KEY = 'shadow-driver-v3-leaderboard';

interface StoredEntry {
  track: string;
  laps: number;
  time: number;
  bestLap: number;
  maxSpeed: number;
  driftScore: number;
  date: string;
  difficulty: string;
  playerCar: string;
  winner?: 'player' | 'ai';
  aiTime?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRaceTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${secs.toFixed(1)}s`;
}

function formatGap(seconds: number): string {
  return Math.abs(seconds).toFixed(1);
}

/** Map difficulty codes to friendly labels */
function difficultyLabel(difficulty: string): string {
  const map: Record<string, string> = {
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    autopilot: 'AI',
    'carla-autopilot': 'AI',
  };
  return map[difficulty.toLowerCase()] ?? difficulty;
}

interface TickerItem {
  text: string;
  type: 'win' | 'loss' | 'pb';
  key: string;
}

function buildTickerItems(entries: StoredEntry[]): TickerItem[] {
  // Sort by date descending, take most recent 8
  const sorted = [...entries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recent = sorted.slice(0, 8);

  // Track personal bests so we can identify PB entries
  const bestTimes = new Map<string, number>();
  // Process all entries chronologically to find PBs
  const chronological = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const pbDates = new Set<string>();
  for (const entry of chronological) {
    const key = `${entry.track}:${entry.laps}`;
    const prevBest = bestTimes.get(key);
    if (prevBest === undefined || entry.time < prevBest) {
      bestTimes.set(key, entry.time);
      pbDates.add(entry.date);
    }
  }

  const items: TickerItem[] = [];

  for (const entry of recent) {
    const diff = difficultyLabel(entry.difficulty);
    const track = entry.track;
    const ago = timeAgo(entry.date);
    const isPB = pbDates.has(entry.date);

    // If we have win/loss data, show the gap
    if (entry.winner && entry.aiTime != null && entry.aiTime > 0) {
      const gap = Math.abs(entry.time - entry.aiTime);
      if (entry.winner === 'player') {
        // Check if it's also a PB
        if (isPB) {
          items.push({
            text: `New PB: ${formatRaceTime(entry.time)} -- Beat ${diff} AI by ${formatGap(gap)}s on ${track} -- ${ago}`,
            type: 'pb',
            key: entry.date,
          });
        } else {
          items.push({
            text: `Beat ${diff} AI by ${formatGap(gap)}s on ${track} -- ${ago}`,
            type: 'win',
            key: entry.date,
          });
        }
      } else {
        items.push({
          text: `Lost to ${diff} AI by ${formatGap(gap)}s on ${track} -- ${ago}`,
          type: 'loss',
          key: entry.date,
        });
      }
    } else {
      // Legacy entries without winner/aiTime -- show time + PB status
      if (isPB) {
        items.push({
          text: `New PB: ${formatRaceTime(entry.time)} on ${track} -- ${ago}`,
          type: 'pb',
          key: entry.date,
        });
      } else {
        items.push({
          text: `Raced ${diff} AI on ${track} in ${formatRaceTime(entry.time)} -- ${ago}`,
          type: 'win',
          key: entry.date,
        });
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecentResultsTicker() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TickerItem[]>([]);
  const [isHovered, setIsHovered] = useState(false);

  // Read localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries: StoredEntry[] = JSON.parse(raw);
      if (!Array.isArray(entries) || entries.length === 0) return;
      setItems(buildTickerItems(entries));
    } catch {
      // localStorage unavailable or corrupt -- silently hide ticker
    }
  }, []);

  // Scroll animation
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

    let animationId: number;
    let pos = 0;

    function tick() {
      if (!isHovered && el) {
        pos -= 0.4; // pixels per frame
        const contentWidth = el.scrollWidth / 2; // content is duplicated
        if (contentWidth > 0 && Math.abs(pos) >= contentWidth) {
          pos = 0;
        }
        el.style.transform = `translateX(${pos}px)`;
      }
      animationId = requestAnimationFrame(tick);
    }

    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [items, isHovered]);

  if (items.length === 0) {
    return null;
  }

  // Duplicate for seamless looping
  const displayItems = [...items, ...items];

  const typeColor: Record<string, string> = {
    win: 'text-green-400/80',
    loss: 'text-red-400/60',
    pb: 'text-amber-400/80',
  };

  const typeDot: Record<string, string> = {
    win: 'bg-green-400',
    loss: 'bg-red-400/60',
    pb: 'bg-amber-400',
  };

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-white/[0.04] bg-white/[0.02] backdrop-blur-sm"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mb-0 pt-2.5 pb-1 text-center">
        <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/20">
          Your recent results
        </span>
      </div>
      <div className="relative">
        {/* Fade edges */}
        <div
          className="absolute left-0 top-0 bottom-0 w-20 z-10 pointer-events-none"
          style={{
            background: 'linear-gradient(to right, #030308, transparent)',
          }}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-20 z-10 pointer-events-none"
          style={{
            background: 'linear-gradient(to left, #030308, transparent)',
          }}
        />

        <div
          ref={scrollRef}
          className="inline-flex items-center py-2.5 pb-3"
          style={{ willChange: 'transform' }}
        >
          {displayItems.map((item, i) => (
            <span
              key={`${item.key}-${i}`}
              className="inline-flex items-center gap-2 whitespace-nowrap px-5"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${typeDot[item.type]}`} />
              <span
                className={`font-mono text-xs tracking-wide ${typeColor[item.type]}`}
              >
                {item.text}
              </span>
              {i < displayItems.length - 1 && (
                <span className="text-white/10 ml-3">/</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
