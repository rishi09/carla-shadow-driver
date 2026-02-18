import type { RaceFinished } from '../types/index.ts';

interface RaceResultsProps {
  result: RaceFinished;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

export function RaceResults({ result, onPlayAgain, onMainMenu }: RaceResultsProps) {
  const playerWon = result.winner === 'player';

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-8 text-center">
        {/* Winner banner */}
        <div className={`text-6xl mb-4 ${playerWon ? 'text-accent' : 'text-ai'}`}>
          {playerWon ? '🏆' : '🤖'}
        </div>
        <h2 className={`text-3xl font-bold mb-2 ${playerWon ? 'text-accent' : 'text-ai'}`}>
          {playerWon ? 'You Win!' : 'AI Wins!'}
        </h2>
        <p className="text-white/50 mb-8">
          {playerWon ? 'You beat the neural network!' : 'The AI was faster this time.'}
        </p>

        {/* Times comparison */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className={`rounded-lg p-4 border ${playerWon ? 'bg-player/10 border-player/30' : 'bg-dark-400 border-white/10'}`}>
            <div className="text-white/50 text-xs font-mono uppercase mb-1">Your Time</div>
            <div className="text-white text-2xl font-bold font-mono">
              {formatRaceTime(result.player_time)}
            </div>
            {result.player_laps.length > 0 && (
              <div className="text-white/30 text-xs font-mono mt-2">
                Best lap: {formatRaceTime(Math.min(...result.player_laps))}
              </div>
            )}
          </div>
          <div className={`rounded-lg p-4 border ${!playerWon ? 'bg-ai/10 border-ai/30' : 'bg-dark-400 border-white/10'}`}>
            <div className="text-white/50 text-xs font-mono uppercase mb-1">AI Time</div>
            <div className="text-white text-2xl font-bold font-mono">
              {formatRaceTime(result.ai_time)}
            </div>
            {result.ai_laps.length > 0 && (
              <div className="text-white/30 text-xs font-mono mt-2">
                Best lap: {formatRaceTime(Math.min(...result.ai_laps))}
              </div>
            )}
          </div>
        </div>

        {/* Lap breakdown */}
        {result.player_laps.length > 0 && (
          <div className="bg-dark-400/50 rounded-lg p-4 mb-8 text-left">
            <div className="text-white/40 text-xs font-mono uppercase mb-2">Lap Times</div>
            <div className="grid grid-cols-3 gap-1 text-xs font-mono">
              <div className="text-white/30">Lap</div>
              <div className="text-player/70">You</div>
              <div className="text-ai/70">AI</div>
              {result.player_laps.map((lap, i) => (
                <div key={i} className="contents">
                  <div className="text-white/30">{i + 1}</div>
                  <div className="text-white/70">{formatRaceTime(lap)}</div>
                  <div className="text-white/70">{result.ai_laps[i] ? formatRaceTime(result.ai_laps[i]) : '--'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onPlayAgain}
            className="flex-1 py-3 px-6 bg-gradient-to-r from-player to-ai rounded-lg text-white font-bold hover:opacity-90 transition-opacity"
          >
            Race Again
          </button>
          <button
            onClick={onMainMenu}
            className="flex-1 py-3 px-6 bg-dark-400 border border-white/10 rounded-lg text-white/70 font-medium hover:text-white hover:border-white/20 transition-colors"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRaceTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}
