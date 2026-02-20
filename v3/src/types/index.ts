/** Shared types for Shadow Driver v3 */

/** Player keyboard state sent to server */
export interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  space: boolean;
}

/** Race state received from server */
export interface RaceState {
  type: 'race_state';
  player: RacerState;
  ai: RacerState;
  model: string;
  race_status: 'countdown' | 'racing' | 'finished';
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
  player_max_speed?: number;
  ai_max_speed?: number;
  player_distance?: number;
  ai_distance?: number;
  player_collisions?: number;
  total_drift_score?: number;
  best_single_drift?: number;
  drift_count?: number;
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

/** Any JSON message from the server */
export type ServerMessage = RaceState | RaceFinished | HandshakeAck | PerfStats | {
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
  type: 'no_change';
};

/** GPU provisioning states */
export type GPUProvisioningState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

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
