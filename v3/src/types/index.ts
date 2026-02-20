/** Shared types for Shadow Driver v3 */

/** Re-export GhostFrame from the recorder hook for convenience */
export type { GhostFrame } from '../hooks/useGhostRecorder.ts';

/** A challenge ghost decoded from a URL, ready for rendering on the minimap */
export interface ChallengeGhost {
  /** The decoded ghost frames from the URL */
  frames: import('../hooks/useGhostRecorder.ts').GhostFrame[];
  /** Timestamp (performance.now()) when the race started, used to compute elapsed time */
  startTime: number;
}

/** Player keyboard state sent to server */
export interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
}

/** Analog gamepad controls sent alongside (or instead of) keyboard keys */
export interface GamepadControls {
  /** Analog steering: -1.0 (full left) to 1.0 (full right) */
  steer: number;
  /** Analog throttle: 0.0 to 1.0 */
  throttle: number;
  /** Analog brake: 0.0 to 1.0 */
  brake: number;
  /** Handbrake on/off */
  handbrake: boolean;
}

/** AI emotional state sent from server */
export interface AIEmotion {
  /** Internal state name: 'calm' | 'aggressive' | 'nervous' | 'frustrated' | 'confident' | 'desperate' | 'respectful' */
  state: string;
  /** Unicode emoji character */
  emoji: string;
  /** Short uppercase label (e.g. 'AGGRESSIVE') */
  label: string;
  /** Hex color string (e.g. '#f44336') */
  color: string;
  /** Current blended speed factor (1.0 = normal) */
  speed_factor: number;
  /** Current blended aggression level (0.0-1.0) */
  aggression: number;
}

/** Race state received from server */
export interface RaceState {
  type: 'race_state';
  player: RacerState;
  ai: RacerState;
  model: string;
  race_status: 'countdown' | 'racing' | 'finishing' | 'finished';
  fps: number;
  winner?: string | null;
  countdown?: number | null;
  jpeg_quality?: number;
  checkpoints?: Array<{ x: number; y: number }>;
  collisions?: Array<{ intensity: number }>;
  camera_mode?: string;
  ghost?: { x: number; y: number; yaw: number };
  drift?: {
    active: boolean;
    score: number;
    angle: number;
    chain: number;
  };
  total_drift_score?: number;
  ai_emotion?: AIEmotion;
  weather_mood?: {
    mood: 'CALM' | 'BUILDING' | 'TENSE' | 'DRAMATIC' | 'EPIC' | 'FINALE' | 'NIGHT_TENSE';
    intensity: number;
    precipitation: number;
    fog_density: number;
    wind_intensity: number;
    cloudiness: number;
    wetness?: number;
  };
}

export interface RacerState {
  speed_kmh: number;
  lap: number;
  total_laps: number;
  checkpoint: number;
  total_checkpoints?: number;
  lap_time: number;
  best_lap: number | null;
  position: number;
  finished: boolean;
  gear?: number;
  rpm?: number;
  throttle?: number;
  brake?: number;
  steer?: number;
  gap_seconds?: number | null;
  x?: number;
  y?: number;
  yaw?: number;
  next_checkpoint_x?: number;
  next_checkpoint_y?: number;
}

/** Race finished message from server */
export interface RaceFinished {
  type: 'race_finished';
  winner: 'player' | 'ai';
  player_time: number | null;
  ai_time: number | null;
  player_laps: number[];
  ai_laps: number[];
  player_path?: Array<[number, number]>;
  ai_path?: Array<[number, number]>;
  /** Ideal racing line (checkpoint polyline) for post-race comparison */
  racing_line?: Array<{ x: number; y: number }>;
  player_max_speed?: number;
  ai_max_speed?: number;
  player_distance?: number;
  ai_distance?: number;
  player_collisions?: number;
  total_drift_score?: number;
  best_single_drift?: number;
  drift_count?: number;
  /** Number of training data frames recorded during this race (for AI clone) */
  training_frames?: number;
  /** Heuristic coaching tips generated from sector analysis (3-5 tips) */
  coaching_tips?: CoachingTip[];
  /** Per-sector times for player and AI (averaged across all laps) */
  sector_times?: { player: number[]; ai: number[] };
}

/** A single coaching tip from the AI driving coach */
export interface CoachingTip {
  /** Sector number (1-indexed), or 0 for general (non-sector-specific) tips */
  sector: number;
  /** Time delta in seconds (positive = player slower than AI) */
  delta: number;
  /** The coaching tip text */
  tip: string;
  /** Severity: 'critical' | 'major' | 'minor' */
  severity: 'critical' | 'major' | 'minor';
}

/** Handshake ack from server */
export interface HandshakeAck {
  type: 'handshake_ack';
  server: string;
  models: string[];
}

/** Performance stats from server (sent every ~3 seconds) */
export interface PerfStats {
  type: 'perf_stats';
  avg_encode_ms: number;
  avg_frame_size_kb: number;
  quality: number;
  resolution: string;
  speed_downscaled: boolean;
  auto_reduced: boolean;
  samples: number;
  fps: number;
  frames_sent: number;
}

/** Drift end event from server */
export interface DriftEndEvent {
  type: 'drift_end';
  score: number;
  combo: number;
  multiplier: string;
  total_score: number;
}

/** AI trash talk message from server */
export interface AIChatMessage {
  type: 'ai_chat';
  text: string;
}

/** Codec configuration for H.264 WebCodecs decoding */
export interface CodecConfig {
  type: 'codec_config';
  codec: string;     // e.g. 'avc1.42C01E'
  width: number;
  height: number;
}

/** Any JSON message from the server */
export type ServerMessage = RaceState | RaceFinished | HandshakeAck | PerfStats | DriftEndEvent | AIChatMessage | CodecConfig | {
  type: 'pong';
  timestamp: number;
} | {
  type: 'model_switched';
  model: string;
  success: boolean;
} | {
  type: 'respawn_ack';
} | {
  type: 'camera_mode_changed';
  mode: string;
} | {
  type: 'commentary';
  text: string;
  category: string;
} | {
  type: 'error';
  message: string;
} | {
  type: 'webrtc_answer';
  sdp: string;
  sdpType: RTCSdpType;
} | {
  type: 'dc_answer';
  sdp: string;
  sdpType: RTCSdpType;
} | {
  type: 'restart_ack';
} | {
  type: 'no_change';
} | {
  type: 'server_shutdown';
  reason: string;
  message: string;
};

/** GPU provisioning states */
export type GPUProvisioningState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** Client-to-server message types */
export type ClientMessageType =
  | 'handshake'
  | 'control'
  | 'start_race'
  | 'switch_model'
  | 'ping'
  | 'respawn'
  | 'camera_mode'
  | 'restart_race'
  | 'latency_report'
  | 'webrtc_offer'
  | 'dc_offer'
  | 'dc_ice_candidate'
  | 'pause'
  | 'resume'
  | 'codec_negotiate';

/** WebSocket connection states */
export type WebSocketConnectionState = 'disconnected' | 'connecting' | 'connected';

/** GPU instance data */
export interface GPUInstanceData {
  instance_id: string | null;
  offer_id: string | null;
  gpu_name: string | null;
  price_per_hour: number | null;
  tunnel_url: string | null;
  cost_so_far: number;
  uptime_seconds: number;
  setup_status: string | null;
  setup_message: string | null;
}

/** Error info */
export interface GPUError {
  message: string;
  code?: string;
}
