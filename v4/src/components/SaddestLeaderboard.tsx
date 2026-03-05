/**
 * SaddestLeaderboard.tsx - "Wall of Shame" leaderboard display
 *
 * A modal component that displays the worst race performance records
 * for a given track. Dark humor styling with red/orange accents.
 */
import { useMemo } from 'react';
import { useSaddestLeaderboard } from '../hooks/useSaddestLeaderboard.ts';

interface SaddestLeaderboardProps {
  /** Track name to display worst records for */
  track: string;
  /** Close handler */
  onClose: () => void;
}

/** Format milliseconds as M:SS.mmm */
function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

/** Generate a funny caption for each record category */
function getRecordCaption(
  category: 'time' | 'collisions' | 'reverse' | 'topSpeed',
  value: number,
): string {
  switch (category) {
    case 'time': {
      if (value > 600000) return 'Geologic time scale achieved.';
      if (value > 300000) return 'Were you napping mid-race?';
      if (value > 120000) return 'Taking the scenic route, eh?';
      return 'Slow and... just slow.';
    }
    case 'collisions': {
      if (value > 30) return 'You treated every object like a checkpoint.';
      if (value > 15) return 'Demolition derby champion.';
      if (value > 5) return 'The guardrails remember you.';
      if (value > 0) return 'At least it was only a few bumps.';
      return 'Surprisingly clean. Suspiciously clean.';
    }
    case 'reverse': {
      if (value > 30) return 'You spent more time going backwards than some people spend going forwards.';
      if (value > 15) return 'Wrong way! Wrong way! WRONG WAY!';
      if (value > 5) return 'Rear-view mirror: your primary navigation tool.';
      return 'A brief detour through reverse.';
    }
    case 'topSpeed': {
      if (value < 30) return 'Pedestrians were honking at you.';
      if (value < 60) return 'You were outpaced by a mobility scooter.';
      if (value < 100) return 'Sunday driver energy.';
      return 'Not terrible, but not great either.';
    }
  }
}

export function SaddestLeaderboard({ track, onClose }: SaddestLeaderboardProps) {
  const { getWorstTimes, getShameMessage } = useSaddestLeaderboard();

  const records = useMemo(() => getWorstTimes(track), [getWorstTimes, track]);
  const shameMessage = useMemo(() => getShameMessage(track), [getShameMessage, track]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        // Close when clicking backdrop
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal */}
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-red-900/60 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 p-6 shadow-2xl shadow-red-900/20">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mb-1 text-3xl">
            {/* Skull crossbones in text form */}
            <span className="text-red-500" aria-hidden="true">&#9760;</span>
          </div>
          <h2 className="text-2xl font-black tracking-widest text-red-500 uppercase">
            Wall of Shame
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Track: <span className="text-gray-400">{track}</span>
          </p>
        </div>

        {!records ? (
          /* No records state */
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-12 text-center">
            <p className="text-lg text-gray-400">No shameful records yet.</p>
            <p className="mt-2 text-sm text-gray-600">Keep trying!</p>
          </div>
        ) : (
          <>
            {/* Shame message banner */}
            <div className="mb-5 rounded-lg border border-orange-900/40 bg-orange-950/30 px-4 py-3 text-center">
              <p className="text-sm leading-relaxed text-orange-300/90 italic">
                &ldquo;{shameMessage}&rdquo;
              </p>
            </div>

            {/* Records grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Slowest Time */}
              <RecordCard
                label="Slowest Time"
                value={formatTime(records.worstTime)}
                caption={getRecordCaption('time', records.worstTime)}
                date={records.worstDate}
                accentColor="red"
              />

              {/* Most Collisions */}
              <RecordCard
                label="Most Collisions"
                value={String(records.totalCollisions)}
                caption={getRecordCaption('collisions', records.totalCollisions)}
                accentColor="orange"
              />

              {/* Most Time in Reverse */}
              <RecordCard
                label="Most Time in Reverse"
                value={`${records.mostReversing.toFixed(1)}s`}
                caption={getRecordCaption('reverse', records.mostReversing)}
                accentColor="amber"
              />

              {/* Slowest Top Speed */}
              <RecordCard
                label="Slowest Top Speed"
                value={`${Math.round(records.slowestTopSpeed)} km/h`}
                caption={getRecordCaption('topSpeed', records.slowestTopSpeed)}
                accentColor="yellow"
              />
            </div>

            {/* Date footer */}
            <p className="mt-4 text-center text-xs text-gray-600">
              Worst time recorded on{' '}
              {new Date(records.worstDate).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </>
        )}

        {/* Close button at bottom */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 bg-gray-800 px-6 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white"
          >
            Hide My Shame
          </button>
        </div>
      </div>
    </div>
  );
}

/** A single record display card */
function RecordCard({
  label,
  value,
  caption,
  date,
  accentColor,
}: {
  label: string;
  value: string;
  caption: string;
  date?: string;
  accentColor: 'red' | 'orange' | 'amber' | 'yellow';
}) {
  const colorMap = {
    red: {
      border: 'border-red-900/40',
      bg: 'bg-red-950/20',
      label: 'text-red-400/80',
      value: 'text-red-300',
    },
    orange: {
      border: 'border-orange-900/40',
      bg: 'bg-orange-950/20',
      label: 'text-orange-400/80',
      value: 'text-orange-300',
    },
    amber: {
      border: 'border-amber-900/40',
      bg: 'bg-amber-950/20',
      label: 'text-amber-400/80',
      value: 'text-amber-300',
    },
    yellow: {
      border: 'border-yellow-900/40',
      bg: 'bg-yellow-950/20',
      label: 'text-yellow-400/80',
      value: 'text-yellow-300',
    },
  };

  const colors = colorMap[accentColor];

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4`}>
      <p className={`text-xs font-semibold tracking-wide uppercase ${colors.label}`}>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${colors.value}`}>
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-gray-500 italic">
        {caption}
      </p>
      {date && (
        <p className="mt-1 text-[10px] text-gray-700">
          {new Date(date).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

export default SaddestLeaderboard;
