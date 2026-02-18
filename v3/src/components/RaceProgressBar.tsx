interface RaceProgressBarProps {
  playerLap: number;
  playerCheckpoint: number;
  aiLap: number;
  aiCheckpoint: number;
  totalLaps: number;
  totalCheckpoints?: number;
}

export function RaceProgressBar({
  playerLap,
  playerCheckpoint,
  aiLap,
  aiCheckpoint,
  totalLaps,
  totalCheckpoints = 10,
}: RaceProgressBarProps) {
  const totalSegments = totalLaps * totalCheckpoints;

  // Calculate progress as a fraction [0, 1]
  const playerProgress = Math.min(
    1,
    Math.max(0, (playerLap * totalCheckpoints + playerCheckpoint) / totalSegments)
  );
  const aiProgress = Math.min(
    1,
    Math.max(0, (aiLap * totalCheckpoints + aiCheckpoint) / totalSegments)
  );

  // Lap marker positions (between laps, so totalLaps - 1 markers)
  const lapMarkers: number[] = [];
  for (let i = 1; i < totalLaps; i++) {
    lapMarkers.push(i / totalLaps);
  }

  return (
    <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2.5 border border-white/10">
      {/* Labels */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-player inline-block" />
          <span className="text-white/50 text-[10px] font-mono uppercase">You</span>
        </div>
        <span className="text-white/30 text-[10px] font-mono uppercase tracking-wider">Race Progress</span>
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-[10px] font-mono uppercase">AI</span>
          <span className="w-2 h-2 rounded-full bg-ai inline-block" />
        </div>
      </div>

      {/* Track bar */}
      <div className="relative h-[6px] bg-white/10 rounded-full">
        {/* Lap markers */}
        {lapMarkers.map((pos, i) => (
          <div
            key={i}
            className="absolute top-0 h-full w-px bg-white/25"
            style={{ left: `${pos * 100}%` }}
          />
        ))}

        {/* Player dot (green) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-player shadow-[0_0_6px_rgba(76,175,80,0.8)] border border-player-light transition-[left] duration-300 ease-out z-10"
          style={{ left: `calc(${playerProgress * 100}% - 5px)` }}
        />

        {/* AI dot (blue) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-ai shadow-[0_0_6px_rgba(33,150,243,0.8)] border border-ai-light transition-[left] duration-300 ease-out z-10"
          style={{ left: `calc(${aiProgress * 100}% - 5px)` }}
        />

        {/* Checkered flag at end */}
        <div
          className="absolute top-1/2 -translate-y-1/2 right-[-14px] text-sm leading-none"
          title="Finish"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className="opacity-60"
          >
            {/* Simplified checkered flag pattern */}
            <rect x="0" y="0" width="3.5" height="3.5" fill="white" />
            <rect x="3.5" y="0" width="3.5" height="3.5" fill="#333" />
            <rect x="7" y="0" width="3.5" height="3.5" fill="white" />
            <rect x="10.5" y="0" width="3.5" height="3.5" fill="#333" />
            <rect x="0" y="3.5" width="3.5" height="3.5" fill="#333" />
            <rect x="3.5" y="3.5" width="3.5" height="3.5" fill="white" />
            <rect x="7" y="3.5" width="3.5" height="3.5" fill="#333" />
            <rect x="10.5" y="3.5" width="3.5" height="3.5" fill="white" />
            <rect x="0" y="7" width="3.5" height="3.5" fill="white" />
            <rect x="3.5" y="7" width="3.5" height="3.5" fill="#333" />
            <rect x="7" y="7" width="3.5" height="3.5" fill="white" />
            <rect x="10.5" y="7" width="3.5" height="3.5" fill="#333" />
            <rect x="0" y="10.5" width="3.5" height="3.5" fill="#333" />
            <rect x="3.5" y="10.5" width="3.5" height="3.5" fill="white" />
            <rect x="7" y="10.5" width="3.5" height="3.5" fill="#333" />
            <rect x="10.5" y="10.5" width="3.5" height="3.5" fill="white" />
          </svg>
        </div>
      </div>

      {/* Lap labels below the bar */}
      {totalLaps > 1 && (
        <div className="relative mt-1 h-3">
          {Array.from({ length: totalLaps }, (_, i) => {
            const start = i / totalLaps;
            const width = 1 / totalLaps;
            return (
              <span
                key={i}
                className="absolute text-white/20 text-[9px] font-mono text-center"
                style={{
                  left: `${start * 100}%`,
                  width: `${width * 100}%`,
                }}
              >
                L{i + 1}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
