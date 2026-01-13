import { useMemo, useEffect, useRef } from 'react';
import { Button } from '../common/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { useLeaderboard, type LeaderboardEntry } from '../../hooks/useLeaderboard';

export interface RaceResult {
  totalTime: number;
  lapTimes: number[];
  crashes: number;
  crashPenalty: number; // Total penalty time from crashes
  perfectLaps: number;
  perfectBonus: number; // Total bonus time from perfect laps
  playerName: string;
}

interface ResultsScreenProps {
  mode: 'head-to-head' | 'time-trial';
  trackId: string;
  playerResult: RaceResult;
  aiResult?: RaceResult; // Only in head-to-head
  parTime: number;
  goldTime: number;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

type Medal = 'gold' | 'silver' | 'bronze' | null;

function formatTime(ms: number): string {
  const totalSeconds = Math.abs(ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds % 1) * 1000);
  const sign = ms < 0 ? '-' : '';
  return `${sign}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function getMedal(time: number, parTime: number, goldTime: number): Medal {
  if (time <= goldTime) return 'gold';
  if (time <= parTime) return 'silver';
  return 'bronze';
}

function getMedalEmoji(medal: Medal): string {
  switch (medal) {
    case 'gold':
      return '(Gold)';
    case 'silver':
      return '(Silver)';
    case 'bronze':
      return '(Bronze)';
    default:
      return '';
  }
}

function getMedalLabel(medal: Medal): string {
  switch (medal) {
    case 'gold':
      return 'GOLD - You beat the gold time!';
    case 'silver':
      return 'SILVER - You beat par!';
    case 'bronze':
      return 'BRONZE - Race completed!';
    default:
      return '';
  }
}

function getMedalColor(medal: Medal): string {
  switch (medal) {
    case 'gold':
      return 'text-accent';
    case 'silver':
      return 'text-gray-300';
    case 'bronze':
      return 'text-orange-400';
    default:
      return 'text-white';
  }
}

interface ResultCardProps {
  title: string;
  result: RaceResult;
  variant: 'human' | 'ai';
  isWinner?: boolean;
}

function ResultCard({ title, result, variant, isWinner }: ResultCardProps) {
  const bestLapIndex = result.lapTimes.length > 0
    ? result.lapTimes.indexOf(Math.min(...result.lapTimes))
    : -1;

  return (
    <Card variant={variant} className="flex-1 min-w-[280px]">
      <CardHeader>
        <CardTitle className={variant === 'human' ? 'text-human' : 'text-ai'}>
          {title}
          {isWinner && (
            <span className="ml-2 text-accent animate-pulse">(Winner)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Total Time */}
        <div className="text-4xl font-bold text-white mb-6 font-mono">
          {formatTime(result.totalTime)}
        </div>

        {/* Lap Breakdown */}
        <div className="space-y-2 mb-6">
          {result.lapTimes.map((lapTime, index) => (
            <div
              key={index}
              className={`flex justify-between text-sm ${
                index === bestLapIndex ? 'text-accent font-semibold' : 'text-white/70'
              }`}
            >
              <span>Lap {index + 1}:</span>
              <span className="font-mono">
                {formatTime(lapTime)}
                {index === bestLapIndex && ' (BEST)'}
              </span>
            </div>
          ))}
        </div>

        {/* Penalties & Bonuses */}
        <div className="space-y-1 text-sm border-t border-white/10 pt-4">
          {result.crashes > 0 && (
            <div className="flex justify-between text-warning">
              <span>Crashes: {result.crashes}</span>
              <span className="font-mono">+{formatTime(result.crashPenalty)}</span>
            </div>
          )}
          {result.perfectLaps > 0 && (
            <div className="flex justify-between text-human">
              <span>Perfect Laps: {result.perfectLaps}</span>
              <span className="font-mono">-{formatTime(result.perfectBonus)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface LeaderboardDisplayProps {
  entries: LeaderboardEntry[];
  currentTime: number;
  playerName: string;
  isNewRecord: boolean;
}

function LeaderboardDisplay({
  entries,
  currentTime,
  playerName,
  isNewRecord,
}: LeaderboardDisplayProps) {
  const displayEntries = entries.slice(0, 5);

  return (
    <Card variant="default" className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center">LEADERBOARD</CardTitle>
      </CardHeader>
      <CardContent>
        {displayEntries.length === 0 ? (
          <p className="text-center text-white/60">No entries yet</p>
        ) : (
          <div className="space-y-2">
            {displayEntries.map((entry, index) => {
              const isCurrentPlayer =
                entry.playerName === playerName && entry.time === currentTime;
              return (
                <div
                  key={entry.id}
                  className={`flex justify-between items-center py-2 px-3 rounded ${
                    isCurrentPlayer
                      ? 'bg-accent/20 border border-accent/50'
                      : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 text-center font-bold ${
                        index === 0
                          ? 'text-accent'
                          : index === 1
                            ? 'text-gray-300'
                            : index === 2
                              ? 'text-orange-400'
                              : 'text-white/60'
                      }`}
                    >
                      {index + 1}.
                    </span>
                    <span className="text-white">{entry.playerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white/80">
                      {formatTime(entry.time)}
                    </span>
                    {isCurrentPlayer && isNewRecord && (
                      <span className="text-accent text-xs font-semibold animate-pulse">
                        NEW!
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ResultsScreen({
  mode,
  trackId,
  playerResult,
  aiResult,
  parTime,
  goldTime,
  onPlayAgain,
  onMainMenu,
}: ResultsScreenProps) {
  const { entries, addEntry, getPlayerBest } = useLeaderboard(trackId);

  // Determine winner in head-to-head mode
  const playerWins = useMemo(() => {
    if (mode !== 'head-to-head' || !aiResult) return false;
    return playerResult.totalTime < aiResult.totalTime;
  }, [mode, playerResult, aiResult]);

  // Calculate medal for time trial
  const medal = useMemo(() => {
    if (mode !== 'time-trial') return null;
    return getMedal(playerResult.totalTime, parTime, goldTime);
  }, [mode, playerResult.totalTime, parTime, goldTime]);

  // Check if this is a new personal best
  const isNewRecord = useMemo(() => {
    const previousBest = getPlayerBest(playerResult.playerName);
    if (!previousBest) return true;
    return playerResult.totalTime < previousBest.time;
  }, [playerResult, getPlayerBest]);

  // Track if entry was already added to prevent duplicates
  const entryAddedRef = useRef(false);

  // Add entry to leaderboard on mount (only once)
  useEffect(() => {
    if (entryAddedRef.current) return;
    entryAddedRef.current = true;

    addEntry({
      playerName: playerResult.playerName,
      time: playerResult.totalTime,
      lapTimes: playerResult.lapTimes,
      crashes: playerResult.crashes,
      perfectLaps: playerResult.perfectLaps,
    });
  }, [addEntry, playerResult]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 bg-dark-400/50">
      {/* Header */}
      <div className="text-center mb-8">
        {mode === 'head-to-head' ? (
          <>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-2">
              <span className="text-accent">(Trophy)</span> WINNER!{' '}
              <span className="text-accent">(Trophy)</span>
            </h1>
            <p
              className={`text-2xl sm:text-3xl font-semibold ${
                playerWins ? 'text-human' : 'text-ai'
              }`}
            >
              {playerWins ? 'YOU' : 'AI'}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-2">
              RACE COMPLETE!
            </h1>
            <div className="text-5xl sm:text-6xl md:text-7xl font-bold font-mono text-white mb-4">
              {formatTime(playerResult.totalTime)}
            </div>
            {medal && (
              <div className={`text-xl sm:text-2xl font-semibold ${getMedalColor(medal)}`}>
                {getMedalEmoji(medal)} {getMedalLabel(medal)}
              </div>
            )}
            {isNewRecord && (
              <div className="mt-2 text-accent font-semibold animate-pulse text-lg">
                (Star) NEW PERSONAL BEST! (Star)
              </div>
            )}
          </>
        )}
      </div>

      {/* Results Cards */}
      {mode === 'head-to-head' && aiResult ? (
        <div className="flex flex-col md:flex-row gap-6 w-full max-w-4xl mb-8">
          <ResultCard
            title="YOUR TIME"
            result={playerResult}
            variant="human"
            isWinner={playerWins}
          />
          <ResultCard
            title="AI TIME"
            result={aiResult}
            variant="ai"
            isWinner={!playerWins}
          />
        </div>
      ) : (
        <div className="w-full max-w-2xl mb-8">
          {/* Time Trial Detailed Breakdown */}
          <Card variant="accent" className="mb-6">
            <CardHeader>
              <CardTitle>Lap Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {playerResult.lapTimes.length === 0 ? (
                  <p className="text-white/60 text-center py-4">No lap data available</p>
                ) : (
                  playerResult.lapTimes.map((lapTime, index) => {
                    const minLapTime = Math.min(...playerResult.lapTimes);
                    const isBest = lapTime === minLapTime;
                    return (
                      <div
                        key={index}
                        className={`flex justify-between items-center py-2 px-4 rounded ${
                          isBest ? 'bg-accent/20' : 'bg-white/5'
                        }`}
                      >
                        <span className="text-white/80">Lap {index + 1}:</span>
                        <span
                          className={`font-mono text-lg ${
                            isBest ? 'text-accent font-bold' : 'text-white'
                          }`}
                        >
                          {formatTime(lapTime)}
                          {isBest && (
                            <span className="ml-2 text-sm">(Star) BEST</span>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Penalties & Bonuses */}
              <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                {playerResult.crashes > 0 && (
                  <div className="flex justify-between text-warning">
                    <span>
                      Penalties: +{formatTime(playerResult.crashPenalty)} (
                      {playerResult.crashes} crashes)
                    </span>
                  </div>
                )}
                {playerResult.perfectLaps > 0 && (
                  <div className="flex justify-between text-human">
                    <span>
                      Bonuses: -{formatTime(playerResult.perfectBonus)} (
                      {playerResult.perfectLaps} perfect laps)
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <LeaderboardDisplay
            entries={entries}
            currentTime={playerResult.totalTime}
            playerName={playerResult.playerName}
            isNewRecord={isNewRecord}
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <Button variant="primary" size="lg" fullWidth onClick={onPlayAgain}>
          RACE AGAIN
        </Button>
        <Button variant="ghost" size="lg" fullWidth onClick={onMainMenu}>
          MAIN MENU
        </Button>
      </div>
    </div>
  );
}
