import { useState, useEffect, useRef } from 'react';
import { LeaderboardPanel } from './LeaderboardPanel.tsx';
import { usePersonalBests } from '../hooks/usePersonalBests.ts';
import { useAdaptiveDifficulty } from '../hooks/useAdaptiveDifficulty.ts';
import { getDailyChallenge, getDailyBest } from '../hooks/useDailyChallenge.ts';
import type { ChallengeData } from '../utils/challengeUrl.ts';
import { usePlayerName } from '../hooks/usePlayerName.ts';
import { useStreak } from '../hooks/useStreak.ts';
import { useSocialPresence } from '../hooks/useSocialPresence.ts';

const MEDAL_ICONS: Record<string, string> = {
  gold: '\uD83E\uDD47',
  silver: '\uD83E\uDD48',
  bronze: '\uD83E\uDD49',
};

interface TrackOption {
  id: string;
  name: string;
  description: string;
}

const TRACKS: TrackOption[] = [
  { id: 'Town05', name: 'Town05', description: 'Urban grid - wide multilane roads, many intersections' },
  { id: 'Town03', name: 'Town03', description: 'Mixed town - suburban streets and highway' },
  { id: 'Town04', name: 'Town04', description: 'Highway circuit - long straights with a small town section' },
  { id: 'Town01', name: 'Town01', description: 'Small town - river crossings, bridges, moderate intersections' },
  { id: 'Town02', name: 'Town02', description: 'Residential - narrow winding streets, tight corners (Hard)' },
  { id: 'Town10HD', name: 'Town10HD', description: 'Downtown city - dense skyscraper blocks, tight turns (Hard)' },
  { id: 'Town07', name: 'Town07', description: 'Rural highway loop - requires additional CARLA maps package' },
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

const LAP_OPTIONS = [1, 2, 3, 5];

interface ModelOption {
  id: string;
  name: string;
  difficulty: string;
  diffColor: string;
  description: string;
}

const AI_MODELS: ModelOption[] = [
  { id: 'carla_pilotnet', name: 'Sunday Driver', difficulty: 'Easy', diffColor: 'text-green-400 border-green-500/40 bg-green-500/20', description: 'Rule-based AI that follows traffic. Drives cautiously at the speed limit.' },
  { id: 'pilotnet', name: 'Neural Network', difficulty: 'Medium', diffColor: 'text-amber-400 border-amber-500/40 bg-amber-500/20', description: 'AI-powered PilotNet neural network. Makes human-like mistakes at corners.' },
  { id: 'alpamayo', name: 'Speed Demon', difficulty: 'Hard', diffColor: 'text-red-400 border-red-500/40 bg-red-500/20', description: 'Aggressive rule-based AI. Ignores all traffic rules, 50% over speed limit.' },
];

interface CarOption {
  id: string;
  name: string;
}

const CAR_OPTIONS: CarOption[] = [
  { id: 'vehicle.tesla.model3', name: 'Tesla Model 3' },
  { id: 'vehicle.ford.mustang', name: 'Ford Mustang' },
  { id: 'vehicle.dodge.charger_2020', name: 'Dodge Charger' },
  { id: 'vehicle.audi.tt', name: 'Audi TT' },
  { id: 'vehicle.mini.cooper_s_2021', name: 'Mini Cooper' },
  { id: 'vehicle.chevrolet.impala', name: 'Chevrolet Impala' },
];

interface TimeOfDayOption {
  id: string;
  label: string;
  color: string;
  borderColor: string;
}

const TIME_OF_DAY_OPTIONS: TimeOfDayOption[] = [
  { id: 'morning', label: 'Morning', color: 'text-amber-400', borderColor: 'border-amber-500/50' },
  { id: 'noon', label: 'Noon', color: 'text-yellow-300', borderColor: 'border-yellow-400/50' },
  { id: 'sunset', label: 'Sunset', color: 'text-orange-400', borderColor: 'border-orange-500/50' },
  { id: 'night', label: 'Night', color: 'text-indigo-400', borderColor: 'border-indigo-500/50' },
  { id: 'storm', label: 'Storm', color: 'text-gray-400', borderColor: 'border-gray-500/50' },
];

// Sensible defaults for the best first impression
const DEFAULT_TRACK = 'Town05';
const DEFAULT_LAPS = 2;
const DEFAULT_WEATHER = 'clear';
const DEFAULT_MODEL = 'carla_pilotnet';
const DEFAULT_CAR = 'vehicle.tesla.model3';
const DEFAULT_TIME_OF_DAY = 'noon';

interface RaceSetupProps {
  onStartRace: (track: string, laps: number, weather: string, model?: string, playerCar?: string, timeOfDay?: string) => void;
  onBack: () => void;
  onStartDailyChallenge?: () => void;
  quickstart?: boolean;
  isConnected?: boolean;
  urlSettings?: {
    track?: string;
    laps?: number;
    weather?: string;
    model?: string;
    playerCar?: string;
    timeOfDay?: string;
  };
  /** Dare challenge time in seconds (from ?dare=X.XXX query param) */
  dareTime?: number | null;
  /** Bet-Your-Laptime challenge data (from ?challenge= URL param) */
  challengeData?: ChallengeData | null;
  /** Whether fragile cargo mode is enabled */
  isCargoMode?: boolean;
  /** Toggle cargo mode on/off */
  onToggleCargoMode?: (on: boolean) => void;
  /** Whether blindfold mode is enabled */
  isBlindfoldMode?: boolean;
  /** Toggle blindfold mode on/off */
  onToggleBlindfoldMode?: (on: boolean) => void;
  /** Whether voice commands are supported in this browser */
  voiceCommandsSupported?: boolean;
  /** Whether voice commands are currently enabled */
  voiceCommandsEnabled?: boolean;
  /** Toggle voice commands on/off */
  onToggleVoiceCommands?: (on: boolean) => void;
  /** Whether ambient light (webcam brightness) is supported */
  ambientLightSupported?: boolean;
  /** Whether ambient light is currently enabled */
  ambientLightEnabled?: boolean;
  /** Toggle ambient light on/off */
  onToggleAmbientLight?: (on: boolean) => void;
  /** Whether head tracking (FaceDetector API) is supported in this browser */
  headTrackingSupported?: boolean;
  /** Whether head tracking is currently enabled */
  headTrackingEnabled?: boolean;
  /** Toggle head tracking on/off */
  onToggleHeadTracking?: (on: boolean) => void;
  /** Current Twitch channel name (null if not in Twitch mode) */
  twitchChannel?: string | null;
  /** Callback to set Twitch channel name */
  onSetTwitchChannel?: (channel: string | null) => void;
  /** Whether phone gyroscope steering is supported (touch device with DeviceOrientationEvent) */
  phoneSteeringSupported?: boolean;
  /** Whether phone steering is currently active */
  phoneSteeringEnabled?: boolean;
  /** Toggle phone steering on/off (triggers iOS permission request if needed) */
  onTogglePhoneSteering?: (on: boolean) => void;
  /** Whether synthwave aesthetic mode is enabled */
  synthwaveEnabled?: boolean;
  /** Toggle synthwave mode on/off */
  onToggleSynthwave?: () => void;
  /** Whether time-zone racing (match local time) is enabled */
  timeZoneEnabled?: boolean;
  /** Current time-of-day label from useTimeZoneRacing (e.g. "Golden Hour", "Deep Night") */
  timeZoneLabel?: string;
  /** Toggle time-zone racing on/off */
  onToggleTimeZone?: (on: boolean) => void;
  /** Whether drunk AI mode is enabled */
  drunkAIEnabled?: boolean;
  /** Toggle drunk AI mode on/off */
  onToggleDrunkAI?: (on: boolean) => void;
  /** AI grudge mood label (e.g. "NEUTRAL", "HOSTILE", "ADMIRING") -- always on, display only */
  aiGrudgeMood?: string;
  /** AI grudge mood message (e.g. "May the best driver win.") */
  aiGrudgeMessage?: string;
  /** Whether binaural 3D audio is enabled */
  binauralEnabled?: boolean;
  /** Toggle binaural 3D audio on/off */
  onToggleBinaural?: (on: boolean) => void;
  /** Current AI nemesis name (display only) */
  aiNemesisName?: string;
  /** Pre-race taunt from current nemesis */
  aiNemesisTaunt?: string;
  /** Whether stock market weather is enabled */
  stockWeatherEnabled?: boolean;
  /** Toggle stock market weather on/off */
  onToggleStockWeather?: (on: boolean) => void;
  /** Stock market mood label (e.g. "Bull Run", "Bear Territory") */
  stockMarketMood?: string;
  /** Whether AI copycat mode is enabled */
  copycatEnabled?: boolean;
  /** Toggle AI copycat mode on/off */
  onToggleCopycat?: (on: boolean) => void;
  backseatEnabled?: boolean;
  onToggleBackseat?: (on: boolean) => void;
  narrationEnabled?: boolean;
  onToggleNarration?: (on: boolean) => void;
  spectatorsEnabled?: boolean;
  onToggleSpectators?: (on: boolean) => void;
  reverseRaceEnabled?: boolean;
  onToggleReverseRace?: (on: boolean) => void;
  aiEvolutionGen?: number;
  evolutionEnabled?: boolean;
  onToggleEvolution?: (on: boolean) => void;
  totalRaces?: number;
  // Batch 8: Game modes + utility hooks
  floorIsLavaEnabled?: boolean;
  onToggleFloorIsLava?: (on: boolean) => void;
  wrongWayChickenEnabled?: boolean;
  onToggleWrongWayChicken?: (on: boolean) => void;
  shrinkingTrackEnabled?: boolean;
  onToggleShrinkingTrack?: (on: boolean) => void;
  tagModeEnabled?: boolean;
  onToggleTagMode?: (on: boolean) => void;
  copsEnabled?: boolean;
  onToggleCops?: (on: boolean) => void;
  musicalChairsEnabled?: boolean;
  onToggleMusicalChairs?: (on: boolean) => void;
  photoRallyEnabled?: boolean;
  onTogglePhotoRally?: (on: boolean) => void;
  webcamReactionsEnabled?: boolean;
  onToggleWebcamReactions?: (on: boolean) => void;
  speedrunEnabled?: boolean;
  onToggleSpeedrun?: (on: boolean) => void;
  infiniteEnabled?: boolean;
  onToggleInfinite?: (on: boolean) => void;
  eyeTrackingEnabled?: boolean;
  onToggleEyeTracking?: (on: boolean) => void;
}

export function RaceSetup({ onStartRace, onBack, onStartDailyChallenge, quickstart, isConnected, urlSettings, dareTime, challengeData, isCargoMode, onToggleCargoMode, isBlindfoldMode, onToggleBlindfoldMode, voiceCommandsSupported, voiceCommandsEnabled, onToggleVoiceCommands, ambientLightSupported, ambientLightEnabled, onToggleAmbientLight, headTrackingSupported, headTrackingEnabled, onToggleHeadTracking, twitchChannel, onSetTwitchChannel, phoneSteeringSupported, phoneSteeringEnabled, onTogglePhoneSteering, synthwaveEnabled, onToggleSynthwave, timeZoneEnabled, timeZoneLabel, onToggleTimeZone, drunkAIEnabled, onToggleDrunkAI, aiGrudgeMood, aiGrudgeMessage, binauralEnabled, onToggleBinaural, aiNemesisName, aiNemesisTaunt, stockWeatherEnabled, onToggleStockWeather, stockMarketMood, copycatEnabled, onToggleCopycat, backseatEnabled, onToggleBackseat, narrationEnabled, onToggleNarration, spectatorsEnabled, onToggleSpectators, reverseRaceEnabled, onToggleReverseRace, aiEvolutionGen, evolutionEnabled, onToggleEvolution, totalRaces, floorIsLavaEnabled, onToggleFloorIsLava, wrongWayChickenEnabled, onToggleWrongWayChicken, shrinkingTrackEnabled, onToggleShrinkingTrack, tagModeEnabled, onToggleTagMode, copsEnabled, onToggleCops, musicalChairsEnabled, onToggleMusicalChairs, photoRallyEnabled, onTogglePhotoRally, webcamReactionsEnabled, onToggleWebcamReactions, speedrunEnabled, onToggleSpeedrun, infiniteEnabled, onToggleInfinite, eyeTrackingEnabled, onToggleEyeTracking }: RaceSetupProps) {
  const [selectedTrack, setSelectedTrack] = useState(urlSettings?.track || DEFAULT_TRACK);
  const [selectedWeather, setSelectedWeather] = useState(urlSettings?.weather || DEFAULT_WEATHER);
  const [selectedLaps, setSelectedLaps] = useState(urlSettings?.laps || DEFAULT_LAPS);
  const [selectedModel, setSelectedModel] = useState(urlSettings?.model || DEFAULT_MODEL);
  const [selectedCar, setSelectedCar] = useState(urlSettings?.playerCar || DEFAULT_CAR);
  const [selectedTimeOfDay, setSelectedTimeOfDay] = useState(urlSettings?.timeOfDay || DEFAULT_TIME_OF_DAY);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(urlSettings?.playerCar || urlSettings?.timeOfDay || urlSettings?.model)
  );

  // Quickstart auto-start: when quickstart is true and connected, start after a brief delay
  const quickstartFiredRef = useRef(false);
  useEffect(() => {
    if (quickstart && isConnected && !quickstartFiredRef.current) {
      quickstartFiredRef.current = true;
      const timer = setTimeout(() => {
        onStartRace(
          urlSettings?.track || DEFAULT_TRACK,
          urlSettings?.laps || DEFAULT_LAPS,
          urlSettings?.weather || DEFAULT_WEATHER,
          urlSettings?.model || DEFAULT_MODEL,
          urlSettings?.playerCar || DEFAULT_CAR,
          urlSettings?.timeOfDay || DEFAULT_TIME_OF_DAY,
        );
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [quickstart, isConnected, onStartRace, urlSettings]);

  const playerName = usePlayerName();
  const streak = useStreak();
  const social = useSocialPresence();

  const personalBests = usePersonalBests();
  const adaptiveDifficulty = useAdaptiveDifficulty();
  const currentTrack = TRACKS.find(t => t.id === selectedTrack);
  const currentBest = personalBests.getBest(selectedTrack, selectedLaps);
  const currentMedal = currentBest ? personalBests.getMedal(selectedTrack, selectedLaps, currentBest.time) : null;

  // Daily Challenge
  const dailyChallenge = getDailyChallenge();
  const dailyBest = getDailyBest(dailyChallenge.daySeed);
  const dailyTrackName = TRACKS.find(t => t.id === dailyChallenge.track)?.name ?? dailyChallenge.track;
  const dailyWeatherIcon = WEATHER_OPTIONS.find(w => w.id === dailyChallenge.weather)?.icon ?? '';

  const handleDailyChallenge = () => {
    if (onStartDailyChallenge) {
      onStartDailyChallenge();
    } else {
      // Fallback: apply daily settings and start
      onStartRace(
        dailyChallenge.track,
        dailyChallenge.laps,
        dailyChallenge.weather,
        dailyChallenge.model,
        selectedCar,
        dailyChallenge.timeOfDay,
      );
    }
  };

  // If quickstart mode and connected, show a minimal "launching" UI
  if (quickstart && isConnected) {
    return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-green-400" style={{ animation: 'spin 0.8s linear infinite' }} />
          <span className="text-white text-xl font-bold">Starting race...</span>
          <span className="text-white/40 text-sm">Loading Town05 with defaults</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark-300 rounded-xl border border-white/10 max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Race Setup</h2>
          <button
            onClick={onBack}
            className="text-white/40 hover:text-white text-sm border border-white/10 rounded-lg px-3 py-1 transition-colors"
          >
            Back
          </button>
        </div>

        {/* Live player count */}
        {!social.loading && social.activePlayers > 0 && (
          <div className="mb-4 flex justify-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/20 bg-green-500/[0.06]">
              <span
                className="w-1.5 h-1.5 rounded-full bg-green-400"
                style={{ animation: 'live-pulse 2s ease-in-out infinite' }}
              />
              <span className="text-green-400/80 text-[11px] font-medium">
                {social.activePlayers} racing now
              </span>
            </div>
            <style>{`
              @keyframes live-pulse {
                0%,100% { opacity:1; }
                50% { opacity:0.4; }
              }
            `}</style>
          </div>
        )}

        {/* Player Name + Streak Row */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1">
            <input
              type="text"
              value={playerName.name}
              onChange={(e) => playerName.setName(e.target.value)}
              placeholder="Enter your name"
              maxLength={20}
              className="w-full bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
            />
          </div>
          {streak.streak > 0 && (
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-orange-500/30 bg-orange-500/10"
                style={{ animation: 'streak-glow 2s ease-in-out infinite' }}
              >
                <span className="text-orange-400 text-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M12 23c-3.6 0-7-2.4-7-7 0-3.1 2.1-5.7 4-7.6l.7-.8c.4-.4 1-.4 1.3.1L13 11l2.5-6.5c.2-.4.6-.6 1-.5.4.1.7.5.7.9V9c2.3 2 4 4.7 4 7.5 0 4.3-3.4 6.5-7 6.5h-2.2z"/>
                  </svg>
                </span>
                <span className="text-orange-400 text-xs font-bold">{streak.streak}-day streak!</span>
              </div>
              {streak.bestStreak > streak.streak && (
                <span className="text-white/30 text-[10px] font-mono">Best: {streak.bestStreak} days</span>
              )}
            </div>
          )}
        </div>
        <style>{`
          @keyframes streak-glow {
            0%, 100% { box-shadow: 0 0 8px rgba(249, 115, 22, 0.15); }
            50% { box-shadow: 0 0 16px rgba(249, 115, 22, 0.3); }
          }
        `}</style>

        {/* Dare Challenge Banner -- shown when ?dare=X or ?challenge= param is present */}
        {dareTime != null && dareTime > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-purple-500/40 bg-gradient-to-r from-purple-600/15 to-cyan-600/15 relative overflow-hidden">
            <style>{`
              @keyframes dare-pulse {
                0%, 100% { box-shadow: 0 0 12px rgba(168, 85, 247, 0.2); }
                50% { box-shadow: 0 0 24px rgba(168, 85, 247, 0.4); }
              }
              @keyframes dare-text-glow {
                0%, 100% { text-shadow: 0 0 10px rgba(168, 85, 247, 0.3); }
                50% { text-shadow: 0 0 25px rgba(168, 85, 247, 0.6), 0 0 50px rgba(168, 85, 247, 0.2); }
              }
            `}</style>
            <div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{ animation: 'dare-pulse 2s ease-in-out infinite' }}
            />
            <div className="flex items-center gap-2 mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                {challengeData ? (
                  // Trophy icon for Bet-Your-Laptime challenge
                  <>
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                    <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                  </>
                ) : (
                  // Layers icon for generic dare
                  <>
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </>
                )}
              </svg>
              <span className="text-purple-400 font-black text-sm uppercase tracking-wider">
                {challengeData ? `${challengeData.playerName}'s Challenge` : "Friend's Dare"}
              </span>
            </div>
            <div
              className="text-white text-xl font-black tracking-wide"
              style={{ animation: 'dare-text-glow 2s ease-in-out infinite' }}
            >
              Can you beat {formatSetupTime(dareTime)}?
            </div>
            <div className="text-white/40 text-xs mt-1">
              {challengeData
                ? `Track and settings locked to match ${challengeData.playerName}'s race. Prove you're faster!`
                : 'Track and settings locked to match the dare. Race to prove yourself!'}
            </div>
          </div>
        )}

        {/* Daily Challenge Card */}
        <button
          onClick={handleDailyChallenge}
          className="w-full mb-6 p-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold text-sm uppercase tracking-wider">Daily Challenge</span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400">
                {dailyChallenge.dateLabel}
              </span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/60 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/50">
            <span>{dailyTrackName}</span>
            <span className="text-white/20">|</span>
            <span>{dailyWeatherIcon} {dailyChallenge.weather}</span>
            <span className="text-white/20">|</span>
            <span>{dailyChallenge.laps} Laps</span>
            <span className="text-white/20">|</span>
            <span className="text-amber-400/70">{dailyChallenge.difficulty}</span>
          </div>
          {dailyBest && (
            <div className="mt-2 text-xs font-mono text-amber-400/60">
              Today's best: {formatSetupTime(dailyBest.time)}
            </div>
          )}
        </button>

        {/* Track Selector - front and center */}
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
            <div className="flex items-center justify-between mt-1.5 pl-1">
              <p className="text-white/40 text-xs">{currentTrack.description}</p>
              {currentBest && (
                <span className="text-cyan-400/80 text-xs font-mono whitespace-nowrap ml-2 flex items-center gap-1">
                  {currentMedal && MEDAL_ICONS[currentMedal]}
                  {formatSetupTime(currentBest.time)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* AI Opponent - front and center */}
        <div className="mb-5">
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
          {adaptiveDifficulty.isAdjusted && (
            <div className="mt-1.5 pl-1">
              <span className="text-white/25 text-[10px] font-mono">
                AI Adjusted {adaptiveDifficulty.speedFactor > 1.0 ? '+' : ''}{Math.round((adaptiveDifficulty.speedFactor - 1.0) * 100)}%
              </span>
            </div>
          )}
          {/* AI Grudge Indicator (always on, display only) */}
          {aiGrudgeMood && aiGrudgeMessage && (
            <div className="mt-2 pl-1 flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-white/40">
                {aiGrudgeMood === 'FURIOUS' ? '\uD83D\uDE21' :
                 aiGrudgeMood === 'HOSTILE' ? '\uD83D\uDE20' :
                 aiGrudgeMood === 'ANNOYED' ? '\uD83D\uDE12' :
                 aiGrudgeMood === 'NEUTRAL' ? '\uD83D\uDE10' :
                 aiGrudgeMood === 'RESPECTFUL' ? '\uD83E\uDD1D' :
                 aiGrudgeMood === 'FRIENDLY' ? '\uD83D\uDE04' :
                 aiGrudgeMood === 'ADMIRING' ? '\uD83E\uDD29' :
                 '\uD83D\uDE10'} {aiGrudgeMood}
              </span>
              <span className="text-white/30 text-[10px] italic">{aiGrudgeMessage}</span>
            </div>
          )}
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

        {/* Game Mode: Fragile Cargo */}
        {onToggleCargoMode && (
          <div className="mb-6">
            <label className="block text-white/60 text-sm font-medium mb-2">Game Mode</label>
            <button
              onClick={() => onToggleCargoMode(!isCargoMode)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                isCargoMode
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Crate icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isCargoMode ? '#FFC107' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isCargoMode ? 'text-amber-400' : 'text-white'}`}>
                    Fragile Cargo
                  </span>
                  {isCargoMode && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Deliver fragile cargo. Collisions and hard braking reduce your cargo integrity. Score combines speed AND handling.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${isCargoMode ? 'bg-amber-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    isCargoMode ? 'left-[22px] bg-amber-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Blindfold Mode */}
        {onToggleBlindfoldMode && (
          <div className="mb-6">
            <button
              onClick={() => onToggleBlindfoldMode(!isBlindfoldMode)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                isBlindfoldMode
                  ? 'bg-red-500/10 border-red-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Skull icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isBlindfoldMode ? '#ef4444' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="12" r="1" />
                  <circle cx="15" cy="12" r="1" />
                  <path d="M8 20v-4" />
                  <path d="M12 20v-4" />
                  <path d="M16 20v-4" />
                  <path d="M2 12c0-5.5 4.5-10 10-10s10 4.5 10 10-2 6-2 6H4s-2-.5-2-6z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isBlindfoldMode ? 'text-red-400' : 'text-white'}`}>
                    Blindfold Mode
                  </span>
                  {isBlindfoldMode && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/20 text-red-400">
                      ON
                    </span>
                  )}
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-400/70">
                    EXTREME CHALLENGE
                  </span>
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Screen goes dark every 3 seconds. Drive from memory.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${isBlindfoldMode ? 'bg-red-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    isBlindfoldMode ? 'left-[22px] bg-red-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Voice Commands (Web Speech API, Chrome/Edge only) */}
        {voiceCommandsSupported && onToggleVoiceCommands && (
          <div className="mb-6">
            <button
              onClick={() => onToggleVoiceCommands(!voiceCommandsEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                voiceCommandsEnabled
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Speech bubble icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={voiceCommandsEnabled ? '#22c55e' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${voiceCommandsEnabled ? 'text-emerald-400' : 'text-white'}`}>
                    Voice Commands
                  </span>
                  {voiceCommandsEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/20 text-emerald-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Say &quot;go&quot;, &quot;brake&quot;, &quot;left&quot;, &quot;right&quot; to control your car with your voice. Chrome/Edge only.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${voiceCommandsEnabled ? 'bg-emerald-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    voiceCommandsEnabled ? 'left-[22px] bg-emerald-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Phone Steering (gyroscope, touch devices only) */}
        {phoneSteeringSupported && onTogglePhoneSteering && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && (
          <div className="mb-6">
            <button
              onClick={() => onTogglePhoneSteering(!phoneSteeringEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                phoneSteeringEnabled
                  ? 'bg-indigo-500/10 border-indigo-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Steering wheel icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={phoneSteeringEnabled ? '#818cf8' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="9" x2="12" y2="3" />
                  <line x1="9" y1="12" x2="3" y2="12" />
                  <line x1="15" y1="12" x2="21" y2="12" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${phoneSteeringEnabled ? 'text-indigo-400' : 'text-white'}`}>
                    Phone Steering
                  </span>
                  {phoneSteeringEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/20 text-indigo-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Hold your phone sideways as a steering wheel. Tilt left/right to steer, forward for gas, back for brake. Vibrates on collisions.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${phoneSteeringEnabled ? 'bg-indigo-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    phoneSteeringEnabled ? 'left-[22px] bg-indigo-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Ambient Light Racing (webcam brightness -> weather) */}
        {ambientLightSupported && onToggleAmbientLight && (
          <div className="mb-6">
            <button
              onClick={() => onToggleAmbientLight(!ambientLightEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                ambientLightEnabled
                  ? 'bg-sky-500/10 border-sky-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Sun icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ambientLightEnabled ? '#38bdf8' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${ambientLightEnabled ? 'text-sky-400' : 'text-white'}`}>
                    Ambient Light
                  </span>
                  {ambientLightEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/20 text-sky-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Your room lighting controls the weather. Dark room = night race. Bright room = sunny day.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${ambientLightEnabled ? 'bg-sky-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    ambientLightEnabled ? 'left-[22px] bg-sky-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Head Tracking (FaceDetector API, Chrome 94+ only) */}
        {headTrackingSupported && onToggleHeadTracking && (
          <div className="mb-6">
            <button
              onClick={() => onToggleHeadTracking(!headTrackingEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                headTrackingEnabled
                  ? 'bg-cyan-500/10 border-cyan-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Face/camera icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={headTrackingEnabled ? '#22d3ee' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0" />
                  <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2" />
                  <path d="M2 12h2" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${headTrackingEnabled ? 'text-cyan-400' : 'text-white'}`}>
                    Head Tracking
                  </span>
                  {headTrackingEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/20 text-cyan-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Lean to look around corners. Your webcam tracks head position to shift the camera view. Chrome 94+ only.
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${headTrackingEnabled ? 'bg-cyan-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    headTrackingEnabled ? 'left-[22px] bg-cyan-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Twitch Plays Mode */}
        {onSetTwitchChannel && (
          <div className="mb-6">
            <button
              onClick={() => onSetTwitchChannel(twitchChannel ? null : '')}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                twitchChannel != null
                  ? 'bg-[#9146ff]/10 border-[#9146ff]/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Twitch icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill={twitchChannel != null ? '#9146ff' : 'rgba(255,255,255,0.4)'}>
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${twitchChannel != null ? 'text-[#9146ff]' : 'text-white'}`}>
                    Twitch Plays
                  </span>
                  {twitchChannel != null && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-[#9146ff]/40 bg-[#9146ff]/20 text-[#9146ff]">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Let Twitch chat vote on controls every 500ms. The most popular command drives the car!
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${twitchChannel != null ? 'bg-[#9146ff]/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    twitchChannel != null ? 'left-[22px] bg-[#9146ff]' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
            {/* Channel input (shown when Twitch mode is enabled) */}
            {twitchChannel != null && (
              <div className="mt-2 pl-1">
                <input
                  type="text"
                  value={twitchChannel}
                  onChange={(e) => onSetTwitchChannel(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="Enter Twitch channel name"
                  maxLength={25}
                  className="w-full bg-black/60 backdrop-blur-sm border border-[#9146ff]/30 rounded-lg px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#9146ff]/60 transition-colors"
                  style={{ caretColor: '#9146ff' }}
                />
                <p className="text-white/30 text-[10px] mt-1 pl-1">
                  Viewers type LEFT, RIGHT, GAS, BRAKE, DRIFT, or BOOST in chat
                </p>
              </div>
            )}
          </div>
        )}

        {/* Synthwave Aesthetic Mode */}
        {onToggleSynthwave && (
          <div className="mb-6">
            <button
              onClick={onToggleSynthwave}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                synthwaveEnabled
                  ? 'bg-fuchsia-500/10 border-fuchsia-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
              style={synthwaveEnabled ? {
                boxShadow: '0 0 20px rgba(255,0,255,0.1), inset 0 0 20px rgba(255,0,255,0.05)',
              } : undefined}
            >
              {/* Retro sun/grid icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={synthwaveEnabled ? '#ff00ff' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="14" x2="22" y2="14" />
                  <path d="M6 14 A6 6 0 0 1 18 14" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                  <line x1="6" y1="20" x2="18" y2="20" />
                  <line x1="12" y1="14" x2="12" y2="22" />
                  <line x1="8" y1="14" x2="6" y2="22" />
                  <line x1="16" y1="14" x2="18" y2="22" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${synthwaveEnabled ? '' : 'text-white'}`}
                    style={synthwaveEnabled ? {
                      color: '#ff00ff',
                      textShadow: '0 0 8px rgba(255,0,255,0.5)',
                    } : undefined}
                  >
                    Synthwave Mode
                  </span>
                  {synthwaveEnabled && (
                    <span
                      className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border"
                      style={{
                        color: '#00ffff',
                        borderColor: 'rgba(0,255,255,0.4)',
                        backgroundColor: 'rgba(0,255,255,0.1)',
                        textShadow: '0 0 6px rgba(0,255,255,0.5)',
                      }}
                    >
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Outrun aesthetic -- CRT scanlines, neon colors, retro vibes. Forces nighttime for maximum effect.
                </p>
              </div>
              {/* Toggle indicator */}
              <div
                className="w-10 h-5 rounded-full relative transition-colors"
                style={{
                  backgroundColor: synthwaveEnabled ? 'rgba(255,0,255,0.4)' : 'rgba(255,255,255,0.1)',
                  boxShadow: synthwaveEnabled ? '0 0 8px rgba(255,0,255,0.3)' : 'none',
                }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                  style={{
                    left: synthwaveEnabled ? '22px' : '2px',
                    backgroundColor: synthwaveEnabled ? '#ff00ff' : 'rgba(255,255,255,0.4)',
                    boxShadow: synthwaveEnabled ? '0 0 6px rgba(255,0,255,0.6)' : 'none',
                  }}
                />
              </div>
            </button>
          </div>
        )}

        {/* Drunk AI Mode */}
        {onToggleDrunkAI && (
          <div className="mb-6">
            <button
              onClick={() => onToggleDrunkAI(!drunkAIEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                drunkAIEnabled
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Beer mug icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={drunkAIEnabled ? '#f59e0b' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 11h1a3 3 0 0 1 0 6h-1" />
                  <path d="M5 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
                  <path d="M5 8h12" />
                  <path d="M7 4c0 0 0.5-1 2.5-1s2.5 1 2.5 1" />
                  <path d="M10 4c0 0 0.5-1 2.5-1s2.5 1 2.5 1" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${drunkAIEnabled ? 'text-amber-400' : 'text-white'}`}>
                    {'\uD83C\uDF7A'} Drunk AI
                  </span>
                  {drunkAIEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400">
                      ON
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  AI gets progressively drunker each lap
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${drunkAIEnabled ? 'bg-amber-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    drunkAIEnabled ? 'left-[22px] bg-amber-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Time-Zone Racing */}
        {onToggleTimeZone && (
          <div className="mb-6">
            <button
              onClick={() => onToggleTimeZone(!timeZoneEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                timeZoneEnabled
                  ? 'bg-sky-500/10 border-sky-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Globe/clock icon */}
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={timeZoneEnabled ? '#38bdf8' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${timeZoneEnabled ? 'text-sky-400' : 'text-white'}`}>
                    {'\uD83C\uDF0D'} Time-Zone Racing
                  </span>
                  {timeZoneEnabled && (
                    <>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/20 text-sky-400">
                        ON
                      </span>
                      {timeZoneLabel && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400/70">
                          {timeZoneLabel}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Weather matches your local time
                </p>
              </div>
              {/* Toggle indicator */}
              <div className={`w-10 h-5 rounded-full relative transition-colors ${timeZoneEnabled ? 'bg-sky-500/40' : 'bg-white/10'}`}>
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    timeZoneEnabled ? 'left-[22px] bg-sky-400' : 'left-0.5 bg-white/40'
                  }`}
                />
              </div>
            </button>
          </div>
        )}

        {/* Binaural 3D Audio */}
        {onToggleBinaural && (
          <div className="mb-6">
            <button
              onClick={() => onToggleBinaural(!binauralEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                binauralEnabled
                  ? 'bg-violet-500/10 border-violet-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={binauralEnabled ? '#a78bfa' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${binauralEnabled ? 'text-violet-400' : 'text-white'}`}>
                    {'\uD83C\uDFA7'} 3D Spatial Audio
                  </span>
                  {binauralEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/20 text-violet-400">ON</span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  Hear AI car position in 3D with headphones
                </p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${binauralEnabled ? 'bg-violet-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${binauralEnabled ? 'left-[22px] bg-violet-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* Stock Market Weather */}
        {onToggleStockWeather && (
          <div className="mb-6">
            <button
              onClick={() => onToggleStockWeather(!stockWeatherEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                stockWeatherEnabled
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stockWeatherEnabled ? '#34d399' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                  <polyline points="16 7 22 7 22 13" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${stockWeatherEnabled ? 'text-emerald-400' : 'text-white'}`}>
                    {'\uD83D\uDCC8'} Stock Market Weather
                  </span>
                  {stockWeatherEnabled && stockMarketMood && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400/70">
                      {stockMarketMood}
                    </span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  S&P 500 drives the weather: up = sunny, down = storm
                </p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${stockWeatherEnabled ? 'bg-emerald-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${stockWeatherEnabled ? 'left-[22px] bg-emerald-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* AI Copycat Mode */}
        {onToggleCopycat && (
          <div className="mb-6">
            <button
              onClick={() => onToggleCopycat(!copycatEnabled)}
              className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${
                copycatEnabled
                  ? 'bg-pink-500/10 border-pink-500/40'
                  : 'bg-black/60 border-white/10 hover:border-white/20'
              }`}
            >
              <div className="shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={copycatEnabled ? '#f472b6' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${copycatEnabled ? 'text-pink-400' : 'text-white'}`}>
                    {'\uD83D\uDE48'} AI Copycat
                  </span>
                  {copycatEnabled && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-pink-500/40 bg-pink-500/20 text-pink-400">ON</span>
                  )}
                </div>
                <p className="text-white/40 text-xs mt-0.5">
                  AI copies your crashes 30 seconds later
                </p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${copycatEnabled ? 'bg-pink-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${copycatEnabled ? 'left-[22px] bg-pink-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* AI Nemesis display */}
        {aiNemesisName && (
          <div className="mb-6 bg-black/60 border border-red-500/30 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-red-400 text-sm font-bold">{'\u2694\uFE0F'} Nemesis: {aiNemesisName}</span>
            </div>
            {aiNemesisTaunt && (
              <p className="text-white/50 text-xs italic">&ldquo;{aiNemesisTaunt}&rdquo;</p>
            )}
          </div>
        )}

        {/* Backseat Driver toggle */}
        {onToggleBackseat && (
          <div className="mb-4">
            <button onClick={() => onToggleBackseat(!backseatEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${backseatEnabled ? 'bg-orange-500/10 border-orange-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${backseatEnabled ? 'text-orange-400' : 'text-white'}`}>Backseat Driver</span>
                  {backseatEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-orange-500/40 bg-orange-500/20 text-orange-400">ON</span>}
                </div>
                <p className="text-white/40 text-xs mt-0.5">A passenger critiques your every move</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${backseatEnabled ? 'bg-orange-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${backseatEnabled ? 'left-[22px] bg-orange-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* AI Inner Monologue toggle */}
        {onToggleNarration && (
          <div className="mb-4">
            <button onClick={() => onToggleNarration(!narrationEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${narrationEnabled ? 'bg-purple-500/10 border-purple-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${narrationEnabled ? 'text-purple-400' : 'text-white'}`}>AI Inner Monologue</span>
                  {narrationEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/20 text-purple-400">ON</span>}
                </div>
                <p className="text-white/40 text-xs mt-0.5">See what the AI is thinking during the race</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${narrationEnabled ? 'bg-purple-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${narrationEnabled ? 'left-[22px] bg-purple-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* NPC Spectators toggle */}
        {onToggleSpectators && (
          <div className="mb-4">
            <button onClick={() => onToggleSpectators(!spectatorsEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${spectatorsEnabled ? 'bg-teal-500/10 border-teal-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${spectatorsEnabled ? 'text-teal-400' : 'text-white'}`}>NPC Spectators</span>
                  {spectatorsEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-teal-500/40 bg-teal-500/20 text-teal-400">ON</span>}
                </div>
                <p className="text-white/40 text-xs mt-0.5">Virtual crowd reacts during the race</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${spectatorsEnabled ? 'bg-teal-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${spectatorsEnabled ? 'left-[22px] bg-teal-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* Reverse Race toggle */}
        {onToggleReverseRace && (
          <div className="mb-4">
            <button onClick={() => onToggleReverseRace(!reverseRaceEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${reverseRaceEnabled ? 'bg-rose-500/10 border-rose-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${reverseRaceEnabled ? 'text-rose-400' : 'text-white'}`}>Reverse Race</span>
                  {reverseRaceEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-rose-500/40 bg-rose-500/20 text-rose-400">ON</span>}
                </div>
                <p className="text-white/40 text-xs mt-0.5">Run the track backwards</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${reverseRaceEnabled ? 'bg-rose-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${reverseRaceEnabled ? 'left-[22px] bg-rose-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* AI Evolution toggle */}
        {onToggleEvolution && (
          <div className="mb-4">
            <button onClick={() => onToggleEvolution(!evolutionEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${evolutionEnabled ? 'bg-lime-500/10 border-lime-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${evolutionEnabled ? 'text-lime-400' : 'text-white'}`}>AI Evolution</span>
                  {evolutionEnabled && aiEvolutionGen != null && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-lime-500/30 bg-lime-500/10 text-lime-400/70">Gen {aiEvolutionGen}</span>}
                </div>
                <p className="text-white/40 text-xs mt-0.5">AI evolves each race via genetic algorithm</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${evolutionEnabled ? 'bg-lime-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${evolutionEnabled ? 'left-[22px] bg-lime-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* Race memory count */}
        {totalRaces != null && totalRaces > 0 && (
          <div className="mb-4 flex justify-center">
            <span className="text-white/25 text-[10px] font-mono">{totalRaces} race{totalRaces !== 1 ? 's' : ''} in memory</span>
          </div>
        )}

        {/* Batch 8: Game Mode Toggles */}
        {onToggleFloorIsLava && (
          <div className="mb-2">
            <button onClick={() => onToggleFloorIsLava(!floorIsLavaEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${floorIsLavaEnabled ? 'bg-red-500/10 border-red-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${floorIsLavaEnabled ? 'text-red-400' : 'text-white'}`}>Floor Is Lava</span>
                  {floorIsLavaEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/20 text-red-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Slow zones appear — stay on the racing line!</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${floorIsLavaEnabled ? 'bg-red-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${floorIsLavaEnabled ? 'left-[22px] bg-red-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleWrongWayChicken && (
          <div className="mb-2">
            <button onClick={() => onToggleWrongWayChicken(!wrongWayChickenEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${wrongWayChickenEnabled ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${wrongWayChickenEnabled ? 'text-yellow-400' : 'text-white'}`}>Wrong-Way Chicken</span>
                  {wrongWayChickenEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-yellow-500/40 bg-yellow-500/20 text-yellow-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Drive toward AI head-on — who swerves first?</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${wrongWayChickenEnabled ? 'bg-yellow-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${wrongWayChickenEnabled ? 'left-[22px] bg-yellow-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleShrinkingTrack && (
          <div className="mb-2">
            <button onClick={() => onToggleShrinkingTrack(!shrinkingTrackEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${shrinkingTrackEnabled ? 'bg-amber-500/10 border-amber-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${shrinkingTrackEnabled ? 'text-amber-400' : 'text-white'}`}>Shrinking Track</span>
                  {shrinkingTrackEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Safe zone shrinks each lap — stay inside!</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${shrinkingTrackEnabled ? 'bg-amber-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${shrinkingTrackEnabled ? 'left-[22px] bg-amber-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleTagMode && (
          <div className="mb-2">
            <button onClick={() => onToggleTagMode(!tagModeEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${tagModeEnabled ? 'bg-cyan-500/10 border-cyan-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${tagModeEnabled ? 'text-cyan-400' : 'text-white'}`}>Tag Mode</span>
                  {tagModeEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/20 text-cyan-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">You're it! Tag the AI car to swap roles</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${tagModeEnabled ? 'bg-cyan-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${tagModeEnabled ? 'left-[22px] bg-cyan-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleCops && (
          <div className="mb-2">
            <button onClick={() => onToggleCops(!copsEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${copsEnabled ? 'bg-blue-500/10 border-blue-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${copsEnabled ? 'text-blue-400' : 'text-white'}`}>Cops & Robbers</span>
                  {copsEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/20 text-blue-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Chase or flee — one car is the law</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${copsEnabled ? 'bg-blue-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${copsEnabled ? 'left-[22px] bg-blue-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleMusicalChairs && (
          <div className="mb-2">
            <button onClick={() => onToggleMusicalChairs(!musicalChairsEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${musicalChairsEnabled ? 'bg-pink-500/10 border-pink-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${musicalChairsEnabled ? 'text-pink-400' : 'text-white'}`}>Musical Chairs</span>
                  {musicalChairsEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-pink-500/40 bg-pink-500/20 text-pink-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Music stops — reach the zone first!</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${musicalChairsEnabled ? 'bg-pink-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${musicalChairsEnabled ? 'left-[22px] bg-pink-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onTogglePhotoRally && (
          <div className="mb-2">
            <button onClick={() => onTogglePhotoRally(!photoRallyEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${photoRallyEnabled ? 'bg-green-500/10 border-green-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${photoRallyEnabled ? 'text-green-400' : 'text-white'}`}>Photography Rally</span>
                  {photoRallyEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-green-500/40 bg-green-500/20 text-green-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Find photo spots and capture them (press P)</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${photoRallyEnabled ? 'bg-green-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${photoRallyEnabled ? 'left-[22px] bg-green-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleWebcamReactions && (
          <div className="mb-2">
            <button onClick={() => onToggleWebcamReactions(!webcamReactionsEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${webcamReactionsEnabled ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${webcamReactionsEnabled ? 'text-indigo-400' : 'text-white'}`}>Webcam Reactions</span>
                  {webcamReactionsEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/20 text-indigo-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">AI reads your facial expressions via webcam</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${webcamReactionsEnabled ? 'bg-indigo-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${webcamReactionsEnabled ? 'left-[22px] bg-indigo-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleSpeedrun && (
          <div className="mb-2">
            <button onClick={() => onToggleSpeedrun(!speedrunEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${speedrunEnabled ? 'bg-violet-500/10 border-violet-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${speedrunEnabled ? 'text-violet-400' : 'text-white'}`}>Speedrun Internet</span>
                  {speedrunEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/20 text-violet-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Collect Wi-Fi pickups to keep your connection alive</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${speedrunEnabled ? 'bg-violet-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${speedrunEnabled ? 'left-[22px] bg-violet-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleInfinite && (
          <div className="mb-2">
            <button onClick={() => onToggleInfinite(!infiniteEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${infiniteEnabled ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${infiniteEnabled ? 'text-emerald-400' : 'text-white'}`}>Infinite Highway</span>
                  {infiniteEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/20 text-emerald-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Endless mode — survive as long as possible</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${infiniteEnabled ? 'bg-emerald-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${infiniteEnabled ? 'left-[22px] bg-emerald-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}
        {onToggleEyeTracking && (
          <div className="mb-2">
            <button onClick={() => onToggleEyeTracking(!eyeTrackingEnabled)} className={`w-full flex items-center gap-3 py-3 px-4 rounded-lg border text-left transition-all ${eyeTrackingEnabled ? 'bg-fuchsia-500/10 border-fuchsia-500/40' : 'bg-black/60 border-white/10 hover:border-white/20'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${eyeTrackingEnabled ? 'text-fuchsia-400' : 'text-white'}`}>Eye Tracking Steering</span>
                  {eyeTrackingEnabled && <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/20 text-fuchsia-400">ON</span>}
                </div>
                <p className="text-[11px] text-white/30 mt-0.5">Steer with your eyes via webcam gaze detection</p>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${eyeTrackingEnabled ? 'bg-fuchsia-500/40' : 'bg-white/10'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${eyeTrackingEnabled ? 'left-[22px] bg-fuchsia-400' : 'left-0.5 bg-white/40'}`} />
              </div>
            </button>
          </div>
        )}

        {/* Advanced Settings - collapsible */}
        <div className="mb-6">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-white/40 hover:text-white/60 text-sm font-medium transition-colors w-full"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>Advanced Settings</span>
            <span className="flex-1 h-px bg-white/10 ml-2" />
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-5 pl-1 animate-in">
              <style>{`
                .animate-in {
                  animation: slideDown 0.2s ease-out;
                }
                @keyframes slideDown {
                  from { opacity: 0; transform: translateY(-8px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>

              {/* Weather Selector */}
              <div>
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

              {/* Time of Day Selector */}
              <div>
                <label className="block text-white/60 text-sm font-medium mb-2">Time of Day</label>
                <div className="grid grid-cols-5 gap-2">
                  {TIME_OF_DAY_OPTIONS.map((tod) => (
                    <button
                      key={tod.id}
                      onClick={() => setSelectedTimeOfDay(tod.id)}
                      className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border text-xs transition-all ${
                        selectedTimeOfDay === tod.id
                          ? `bg-white/10 ${tod.borderColor} ${tod.color}`
                          : 'bg-black/60 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                      }`}
                    >
                      <span className="font-medium">{tod.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Car Selector */}
              <div>
                <label className="block text-white/60 text-sm font-medium mb-2">Your Car</label>
                <div className="grid grid-cols-3 gap-2">
                  {CAR_OPTIONS.map((car) => (
                    <button
                      key={car.id}
                      onClick={() => setSelectedCar(car.id)}
                      className={`flex flex-col items-center gap-1 py-3 px-2 rounded-lg border text-sm transition-all ${
                        selectedCar === car.id
                          ? 'bg-white/10 border-player/50 text-white'
                          : 'bg-black/60 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                      }`}
                    >
                      <span className="text-xs text-center font-medium leading-tight">{car.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Personal Records / Leaderboard */}
        <div className="mb-6">
          <LeaderboardPanel selectedTrack={selectedTrack} selectedLaps={selectedLaps} />
        </div>

        {/* Start Race Button - big and prominent */}
        <button
          onClick={() => onStartRace(selectedTrack, selectedLaps, selectedWeather, selectedModel, selectedCar, selectedTimeOfDay)}
          className="w-full py-5 px-6 rounded-xl text-white font-black text-xl tracking-wide transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
            boxShadow: '0 0 25px rgba(34,197,94,0.3), 0 0 60px rgba(34,197,94,0.08)',
          }}
        >
          Start Race
        </button>
      </div>
    </div>
  );
}

function formatSetupTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}
