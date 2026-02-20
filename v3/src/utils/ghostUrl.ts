/**
 * ghostUrl.ts - Compress/decompress ghost replay data for URL sharing
 *
 * Pipeline:
 *   encode: GhostFrame[] -> quantize (x10 for 0.1m precision) -> delta-encode
 *           -> pack to binary (Int16Array) -> gzip via CompressionStream -> base64url
 *
 *   decode: base64url -> gunzip via DecompressionStream -> Int16Array
 *           -> delta-decode -> dequantize -> GhostFrame[]
 *
 * Typically produces <5KB for a 60-120s race at 10Hz (600-1200 frames).
 */
import type { GhostFrame } from '../hooks/useGhostRecorder.ts';

/**
 * Number of Int16 values per frame:
 *   t (delta centiseconds), x (delta 0.1m), y (delta 0.1m), yaw (delta 0.1deg), speed (delta 0.1km/h)
 */
const FIELDS_PER_FRAME = 5;

/** Maximum encoded size in characters for the ghost URL parameter. */
const MAX_URL_GHOST_CHARS = 8000;

/**
 * Encode ghost frames into a URL-safe compressed string.
 * Returns null if encoding fails or frames are empty.
 */
export async function encodeGhostForUrl(frames: GhostFrame[]): Promise<string | null> {
  if (frames.length === 0) return null;

  try {
    // Try with all frames first; subsample if too large
    let currentFrames = frames;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await encodeFramesBinary(currentFrames);
      if (result !== null && result.length <= MAX_URL_GHOST_CHARS) {
        return result;
      }
      // Subsample to ~60% of current count
      const targetCount = Math.max(20, Math.floor(currentFrames.length * 0.6));
      currentFrames = subsample(currentFrames, targetCount);
    }

    // Last resort: very aggressive subsampling
    currentFrames = subsample(frames, 20);
    return await encodeFramesBinary(currentFrames);
  } catch {
    return null;
  }
}

/**
 * Decode a URL-safe compressed string back into ghost frames.
 * Returns null if decoding fails.
 */
export async function decodeGhostFromUrl(encoded: string): Promise<GhostFrame[] | null> {
  try {
    // Step 1: Base64url decode
    const compressed = base64UrlToUint8Array(encoded);

    // Step 2: Decompress gzip
    const decompressed = await decompressGzip(compressed);

    // Step 3: Parse header (4 x Int32 = 16 bytes)
    if (decompressed.byteLength < 16) return null;
    const headerView = new DataView(decompressed.buffer, decompressed.byteOffset, 16);
    const absX = headerView.getInt32(0, true);
    const absY = headerView.getInt32(4, true);
    const absYaw = headerView.getInt32(8, true);
    const frameCount = headerView.getInt32(12, true);

    if (frameCount <= 0 || frameCount > 100000) return null;

    // Step 4: Parse delta-encoded Int16 data
    const expectedDeltaBytes = frameCount * FIELDS_PER_FRAME * 2;
    if (decompressed.byteLength < 16 + expectedDeltaBytes) return null;

    const deltaBytes = decompressed.slice(16);
    const deltaEncoded = new Int16Array(
      deltaBytes.buffer,
      deltaBytes.byteOffset,
      frameCount * FIELDS_PER_FRAME,
    );

    // Step 5: Delta-decode and dequantize
    const frames: GhostFrame[] = [];
    let runT = 0;
    let runX = absX;
    let runY = absY;
    let runYaw = absYaw;
    let runSpeed = 0;

    for (let i = 0; i < frameCount; i++) {
      const offset = i * FIELDS_PER_FRAME;

      if (i === 0) {
        runT = deltaEncoded[offset + 0];
        // x/y/yaw come from header (absolute values)
        runSpeed = deltaEncoded[offset + 4];
      } else {
        runT += deltaEncoded[offset + 0];
        runX += deltaEncoded[offset + 1];
        runY += deltaEncoded[offset + 2];
        runYaw += deltaEncoded[offset + 3];
        runSpeed += deltaEncoded[offset + 4];
      }

      frames.push({
        t: runT / 100,       // centiseconds -> seconds
        x: runX / 10,        // dequantize 0.1m
        y: runY / 10,
        yaw: runYaw / 10,    // dequantize 0.1deg
        speed: runSpeed / 10, // dequantize 0.1km/h
      });
    }

    return frames;
  } catch {
    return null;
  }
}

/**
 * Given a time offset (seconds since race start) and ghost frames,
 * interpolate the ghost position at that exact time.
 * Returns null if the time is outside the recorded range.
 */
export function interpolateGhostPosition(
  frames: GhostFrame[],
  time: number,
): { x: number; y: number; yaw: number; speed: number } | null {
  if (frames.length === 0) return null;
  if (time < frames[0].t) return null;
  if (time >= frames[frames.length - 1].t) {
    const last = frames[frames.length - 1];
    return { x: last.x, y: last.y, yaw: last.yaw, speed: last.speed };
  }

  // Binary search for the bracketing frames
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= time) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = frames[lo];
  const b = frames[hi];
  const dt = b.t - a.t;
  if (dt <= 0) return { x: a.x, y: a.y, yaw: a.yaw, speed: a.speed };

  const alpha = (time - a.t) / dt;

  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    speed: a.speed + (b.speed - a.speed) * alpha,
    // Shortest-angle interpolation for yaw
    yaw: (() => {
      let diff = b.yaw - a.yaw;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return a.yaw + diff * alpha;
    })(),
  };
}

// --- Internal helpers ---

async function encodeFramesBinary(frames: GhostFrame[]): Promise<string | null> {
  // Step 1: Quantize to integers
  const quantized = frames.map(f => ({
    t: Math.round(f.t * 100),       // centiseconds
    x: Math.round(f.x * 10),        // 0.1m
    y: Math.round(f.y * 10),        // 0.1m
    yaw: Math.round(f.yaw * 10),    // 0.1deg
    speed: Math.round(f.speed * 10), // 0.1km/h
  }));

  // Step 2: Delta-encode into Int16Array
  const deltaEncoded = new Int16Array(quantized.length * FIELDS_PER_FRAME);
  for (let i = 0; i < quantized.length; i++) {
    const curr = quantized[i];
    const offset = i * FIELDS_PER_FRAME;

    if (i === 0) {
      // First frame: store time and speed as absolute Int16
      // (x/y/yaw go in header since they can exceed Int16 range)
      deltaEncoded[offset + 0] = clampInt16(curr.t);
      deltaEncoded[offset + 1] = 0; // placeholder, x from header
      deltaEncoded[offset + 2] = 0; // placeholder, y from header
      deltaEncoded[offset + 3] = 0; // placeholder, yaw from header
      deltaEncoded[offset + 4] = clampInt16(curr.speed);
    } else {
      const prev = quantized[i - 1];
      deltaEncoded[offset + 0] = clampInt16(curr.t - prev.t);
      deltaEncoded[offset + 1] = clampInt16(curr.x - prev.x);
      deltaEncoded[offset + 2] = clampInt16(curr.y - prev.y);
      deltaEncoded[offset + 3] = clampInt16(curr.yaw - prev.yaw);
      deltaEncoded[offset + 4] = clampInt16(curr.speed - prev.speed);
    }
  }

  // Step 3: Build header with absolute first-frame values (4 x Int32 = 16 bytes)
  const firstFrame = quantized[0];
  const headerBuffer = new ArrayBuffer(16);
  const headerView = new DataView(headerBuffer);
  headerView.setInt32(0, firstFrame.x, true);
  headerView.setInt32(4, firstFrame.y, true);
  headerView.setInt32(8, firstFrame.yaw, true);
  headerView.setInt32(12, quantized.length, true);

  // Step 4: Combine header + delta data
  const deltaBytes = new Uint8Array(deltaEncoded.buffer);
  const combined = new Uint8Array(16 + deltaBytes.byteLength);
  combined.set(new Uint8Array(headerBuffer), 0);
  combined.set(deltaBytes, 16);

  // Step 5: Compress with gzip
  const compressed = await compressGzip(combined);

  // Step 6: Base64url encode
  return uint8ArrayToBase64Url(compressed);
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value));
}

function subsample<T>(arr: T[], maxCount: number): T[] {
  if (arr.length <= maxCount) return arr;
  const result: T[] = [arr[0]];
  const step = (arr.length - 1) / (maxCount - 1);
  for (let i = 1; i < maxCount - 1; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  result.push(arr[arr.length - 1]);
  return result;
}

async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function uint8ArrayToBase64Url(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  let base64 = base64url
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
  return bytes;
}
