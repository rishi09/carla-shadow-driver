import { useState } from 'react';

interface TrackOption {
  id: string;
  name: string;
  description: string;
}

const TRACKS: TrackOption[] = [
  { id: 'Town01', name: 'Town01', description: 'Small town with river and bridges' },
  { id: 'Town02', name: 'Town02', description: 'Residential area with narrow streets' },
  { id: 'Town03', name: 'Town03', description: 'Simple town with highway' },
  { id: 'Town04', name: 'Town04', description: 'Infinite loop highway with small town' },
  { id: 'Town05', name: 'Town05', description: 'Urban grid with multilane roads' },
  { id: 'Town07', name: 'Town07', description: 'Rural countryside with farmland' },
  { id: 'Town10HD', name: 'Town10HD', description: 'Downtown city with skyscrapers' },
];

interface WeatherOption {
  id: string;
  label: string;
  icon: string;
}

const WEATHER_OPTIONS: WeatherOption[] = [
  { id: 'clear', label: 'Clear', icon: '\u2600' },
  { id: 'cloudy', label: 'Cloudy', icon: '\u2601' },
  { id: 'rain', label: 'Rain', icon: '\uD83C\uDF27' },
  { id: 'storm', label: 'Storm', icon: '\u26C8' },
  { id: 'sunset', label: 'Sunset', icon: '\uD83C\uDF05' },
  { id: 'night', label: 'Night', icon: '\uD83C\uDF19' },
];

const LAP_OPTIONS = [1, 3, 5];

interface ModelOption {
  id: string;
  name: string;
  difficulty: string;
  diffColor: string;
  description: string;
}

const AI_MODELS: ModelOption[] = [
  { id: 'carla_pilotnet', name: 'Steady Driver', difficulty: 'Easy', diffColor: 'text-green-400 border-green-500/40 bg-green-500/20', description: 'Follows the road steadily. Good for learning the track.' },
  { id: 'pilotnet', name: 'Weekend Racer', difficulty: 'Medium', diffColor: 'text-amber-400 border-amber-500/40 bg-amber-500/20', description: 'More aggressive cornering, occasionally misjudges turns.' },
  { id: 'alpamayo', name: 'Pro Racer', difficulty: 'Hard', diffColor: 'text-red-400 border-red-500/40 bg-red-500/20', description: 'Alpamayo vision model. Pushes the limits.' },
];

interface RaceSetupProps {
  onStartRace: (track: string, laps: number, weather: string, model?: string) => void;
  onBack: () => void;
}

export function RaceSetup({ onStartRace, onBack }: RaceSetupProps) {
  const [selectedTrack, setSelectedTrack] = useState('Town03');
  const [selectedWeather, setSelectedWeather] = useState('clear');
  const [selectedLaps, setSelectedLaps] = useState(3);
  const [selectedModel, setSelectedModel] = useState('carla_pilotnet');

  const currentTrack = TRACKS.find(t => t.id === selectedTrack);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-6 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Race Setup</h2>
          <button
            onClick={onBack}
            className="text-white/40 hover:text-white text-sm border border-white/10 rounded-lg px-3 py-1 transition-colors"
          >
            Back
          </button>
        </div>

        {/* Track Selector */}
        <div className="mb-5">
          <label className="block text-white/60 text-sm font-medium mb-2">Track</label>
          <select
            value={selectedTrack}
            onChange={(e) => setSelectedTrack(e.target.value)}
            className="w-full bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-3 text-white text-sm appearance-none cursor-pointer focus:outline-none focus:border-white/30 transition-colors"
          >
            {TRACKS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name} - {track.description}
              </option>
            ))}
          </select>
          {currentTrack && (
            <p className="text-white/40 text-xs mt-1.5 pl-1">{currentTrack.description}</p>
          )}
        </div>

        {/* Weather Selector */}
        <div className="mb-5">
          <label className="block text-white/60 text-sm font-medium mb-2">Weather</label>
          <div className="grid grid-cols-3 gap-2">
            {WEATHER_OPTIONS.map((weather) => (
              <button
                key={weather.id}
                onClick={() => setSelectedWeather(weather.id)}
                className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg border text-sm transition-all ${
                  selectedWeather === weather.id
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-black/60 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                }`}
              >
                <span className="text-lg">{weather.icon}</span>
                <span>{weather.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lap Count Selector */}
        <div className="mb-6">
          <label className="block text-white/60 text-sm font-medium mb-2">Laps</label>
          <div className="flex gap-2">
            {LAP_OPTIONS.map((laps) => (
              <button
                key={laps}
                onClick={() => setSelectedLaps(laps)}
                className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-all ${
                  selectedLaps === laps
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-black/60 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                }`}
              >
                {laps} {laps === 1 ? 'Lap' : 'Laps'}
              </button>
            ))}
          </div>
        </div>

        {/* AI Opponent */}
        <div className="mb-6">
          <label className="block text-white/60 text-sm font-medium mb-2">AI Opponent</label>
          <div className="space-y-2">
            {AI_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                  selectedModel === model.id
                    ? 'bg-white/10 border-white/30'
                    : 'bg-black/60 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{model.name}</span>
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${model.diffColor}`}>
                      {model.difficulty}
                    </span>
                  </div>
                  <p className="text-white/40 text-xs mt-0.5">{model.description}</p>
                </div>
                {selectedModel === model.id && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Start Race Button */}
        <button
          onClick={() => onStartRace(selectedTrack, selectedLaps, selectedWeather, selectedModel)}
          className="w-full py-3 px-6 bg-gradient-to-r from-player to-ai rounded-lg text-white font-bold text-lg hover:opacity-90 transition-opacity animate-glow"
        >
          Start Race
        </button>
      </div>
    </div>
  );
}
