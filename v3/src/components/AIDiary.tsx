/**
 * AIDiary.tsx - Modal displaying the AI's diary entries
 *
 * Styled as an old journal/notebook with handwriting-style entries.
 * Shows entries chronologically with mood indicators.
 *
 * Wild Idea #45 from TODO.md
 */
import { useMemo } from 'react';
import type { DiaryEntry, DiaryMood } from '../hooks/useAIDiary.ts';

interface AIDiaryProps {
  entries: DiaryEntry[];
  onClose: () => void;
}

const MOOD_CONFIG: Record<DiaryMood, { emoji: string; label: string; color: string }> = {
  triumphant:    { emoji: '\uD83D\uDC51', label: 'Triumphant',    color: 'text-yellow-400' },
  frustrated:    { emoji: '\uD83E\uDD26', label: 'Frustrated',    color: 'text-orange-400' },
  philosophical: { emoji: '\uD83E\uDD14', label: 'Philosophical', color: 'text-blue-400' },
  angry:         { emoji: '\uD83D\uDE21', label: 'Angry',         color: 'text-red-400' },
  melancholy:    { emoji: '\uD83C\uDF27\uFE0F', label: 'Melancholy',   color: 'text-slate-400' },
  excited:       { emoji: '\uD83E\uDD29', label: 'Excited',       color: 'text-green-400' },
};

function formatDiaryDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoDate;
  }
}

export function AIDiary({ entries, onClose }: AIDiaryProps) {
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [entries],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative max-w-lg w-full rounded-xl border border-amber-800/40 shadow-2xl overflow-hidden bg-gradient-to-b from-amber-950/90 via-stone-900 to-stone-950">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-amber-800/30">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-amber-200 text-lg font-bold flex items-center gap-2">
                {'\uD83D\uDD12'} AI's Private Diary
              </h2>
              <p className="text-amber-700/80 text-xs mt-0.5 italic">
                DO NOT READ (you're reading it anyway)
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/70 transition-colors p-1"
              aria-label="Close diary"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {entries.length > 0 && (
            <div className="text-amber-800/60 text-[10px] font-mono mt-2">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </div>
          )}
        </div>

        {/* Entry list */}
        <div className="max-h-96 overflow-y-auto px-6 py-4 space-y-3">
          {sortedEntries.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-amber-800/50 text-3xl mb-3">{'\uD83D\uDCD3'}</div>
              <p className="text-amber-700/60 text-sm italic">
                The AI hasn't written anything yet.
              </p>
              <p className="text-amber-800/40 text-xs mt-1">
                Race to give it something to write about.
              </p>
            </div>
          ) : (
            sortedEntries.map((entry) => {
              const moodCfg = MOOD_CONFIG[entry.mood] ?? MOOD_CONFIG.philosophical;
              return (
                <div
                  key={entry.id}
                  className="rounded-lg border border-amber-800/20 bg-stone-900/60 p-4 transition-colors hover:bg-stone-900/80"
                >
                  {/* Entry header: mood + date + track */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base" role="img" aria-label={moodCfg.label}>
                        {moodCfg.emoji}
                      </span>
                      <span className={`text-[10px] font-mono uppercase tracking-wider ${moodCfg.color}`}>
                        {moodCfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-amber-800/50 text-[10px] font-mono">
                        {entry.track}
                      </span>
                      <span className="text-amber-800/30 text-[10px]">|</span>
                      <span className="text-amber-800/50 text-[10px] font-mono">
                        {formatDiaryDate(entry.date)}
                      </span>
                    </div>
                  </div>

                  {/* Entry text */}
                  <p className="text-amber-200/80 text-sm italic leading-relaxed">
                    {entry.entry}
                  </p>

                  {/* Win/loss badge */}
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                        entry.playerWon
                          ? 'text-red-400/70 border-red-500/30 bg-red-500/10'
                          : 'text-green-400/70 border-green-500/30 bg-green-500/10'
                      }`}
                    >
                      {entry.playerWon ? 'Lost to Human' : 'AI Victory'}
                    </span>
                    {entry.collisions > 0 && (
                      <span className="text-[9px] font-mono text-amber-800/40">
                        {entry.collisions} collision{entry.collisions !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-amber-800/20">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-amber-800/30 bg-amber-950/40 text-amber-200/70 text-sm font-medium hover:bg-amber-950/60 hover:text-amber-200 transition-colors"
          >
            Close (I saw nothing)
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIDiary;
