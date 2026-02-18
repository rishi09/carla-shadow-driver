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
}

export interface RacerState {
  speed_kmh: number;
  lap: number;
  total_laps: number;
  checkpoint: number;
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
}

/** Race finished message from server */
export interface RaceFinished {
  type: 'race_finished';
  winner: 'player' | 'ai';
  player_time: number | null;
  ai_time: number | null;
  player_laps: number[];
  ai_laps: number[];
}

/** Handshake ack from server */
export interface HandshakeAck {
  type: 'handshake_ack';
  server: string;
  models: string[];
}

/** Any JSON message from the server */
export type ServerMessage = RaceState | RaceFinished | HandshakeAck | {
  type: 'pong';
  timestamp: number;
} | {
  type: 'model_switched';
  model: string;
  success: boolean;
} | {
  type: 'error';
  message: string;
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
