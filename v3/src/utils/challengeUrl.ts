/**
 * challengeUrl.ts - Bet-Your-Laptime challenge URL encoding/decoding
 *
 * Encodes a player's race result (track, laps, time, name) into a URL-safe
 * base64 string that can be shared as a challenge link. Friends click the
 * link and see "Can you beat [name]'s 1:23.456?" before racing.
 *
 * No cryptographic signing needed -- the time is visible anyway, and there's
 * nothing to gain from tampering (you're just challenging a friend).
 *
 * URL format: /race?challenge=<base64url>
 */

export interface ChallengeData {
  /** CARLA map name (e.g. 'Town03') */
  track: string;
  /** Number of laps */
  laps: number;
  /** Race time in seconds (e.g. 83.456) */
  time: number;
  /** Player display name */
  playerName: string;
  /** Timestamp when challenge was created */
  created: number;
  /** Weather preset (optional) */
  weather?: string;
  /** AI difficulty model (optional) */
  model?: string;
  /** Time of day preset (optional) */
  timeOfDay?: string;
}

/**
 * Create a challenge URL from race results.
 * Returns the full URL string ready for clipboard / sharing.
 */
export function createChallengeUrl(data: {
  track: string;
  laps: number;
  time: number;
  playerName: string;
  weather?: string;
  model?: string;
  timeOfDay?: string;
}): string {
  const payload: ChallengeData = {
    track: data.track,
    laps: data.laps,
    time: Math.round(data.time * 1000) / 1000, // 3 decimal places
    playerName: data.playerName || 'Anonymous',
    created: Date.now(),
    weather: data.weather,
    model: data.model,
    timeOfDay: data.timeOfDay,
  };

  const encoded = encodeChallenge(payload);

  // Build URL, preserving ?ws= param if present (for dev/testing)
  const currentParams = new URLSearchParams(window.location.search);
  const wsUrl = currentParams.get('ws');

  const params = new URLSearchParams();
  params.set('challenge', encoded);
  if (wsUrl) params.set('ws', wsUrl);

  const baseUrl = window.location.origin + '/race';
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Encode challenge data into a URL-safe base64 string.
 */
export function encodeChallenge(data: ChallengeData): string {
  const json = JSON.stringify(data);
  // TextEncoder -> base64url
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a challenge string back into ChallengeData.
 * Returns null if decoding fails or data is malformed.
 */
export function decodeChallenge(encoded: string): ChallengeData | null {
  try {
    // base64url -> base64
    let base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json);

    // Validate required fields
    if (
      typeof data.track !== 'string' ||
      typeof data.laps !== 'number' ||
      typeof data.time !== 'number' ||
      typeof data.playerName !== 'string'
    ) {
      return null;
    }

    // Validate ranges
    if (data.laps < 1 || data.laps > 99) return null;
    if (data.time <= 0 || data.time > 99999) return null;

    return data as ChallengeData;
  } catch {
    return null;
  }
}

/**
 * Format a race time in seconds to mm:ss.sss format.
 */
export function formatChallengeTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}
