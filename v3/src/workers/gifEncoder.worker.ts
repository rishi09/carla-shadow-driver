/**
 * gifEncoder.worker.ts - Web Worker for off-main-thread GIF encoding
 *
 * Implements a minimal GIF89a encoder with:
 * - 256-color palette per frame (popularity-based quantization)
 * - LZW compression
 * - Animation support with configurable frame delay
 *
 * Input: Array of RGBA pixel data (Uint8ClampedArray) + dimensions
 * Output: GIF89a Blob
 */

// --- Types for worker messages ---
interface EncodeRequest {
  type: 'encode';
  frames: ArrayBuffer[];
  width: number;
  height: number;
  frameDelay: number; // in centiseconds (e.g., 10 = 100ms)
}

interface EncodeResponse {
  type: 'done';
  blob: Blob;
}

interface ProgressResponse {
  type: 'progress';
  percent: number;
}

interface ErrorResponse {
  type: 'error';
  message: string;
}

// --- Color quantization ---

/** Quantize RGBA image data to a 256-color palette using popularity-based method */
function quantize(rgba: Uint8ClampedArray, width: number, height: number): {
  palette: Uint8Array; // 256 * 3 bytes (RGB)
  indices: Uint8Array; // width * height bytes
} {
  const pixelCount = width * height;

  // Sample pixels: for performance, sample at most ~10000 pixels
  const sampleStep = Math.max(1, Math.floor(pixelCount / 10000));

  // Count color popularity using 15-bit color key (5 bits per channel)
  const colorCounts = new Map<number, number>();
  const colorRGB = new Map<number, [number, number, number]>();

  for (let i = 0; i < pixelCount; i += sampleStep) {
    const offset = i * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];

    // 5-5-5 quantization for color key
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    if (!colorRGB.has(key)) {
      colorRGB.set(key, [r, g, b]);
    }
  }

  // Sort by popularity and take top 256
  const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  const paletteSize = 256;
  const paletteColors: [number, number, number][] = [];

  for (let i = 0; i < Math.min(paletteSize, sorted.length); i++) {
    const rgb = colorRGB.get(sorted[i][0])!;
    paletteColors.push(rgb);
  }

  // Pad palette to 256 entries if needed
  while (paletteColors.length < paletteSize) {
    paletteColors.push([0, 0, 0]);
  }

  // Build flat palette array
  const palette = new Uint8Array(paletteSize * 3);
  for (let i = 0; i < paletteSize; i++) {
    palette[i * 3] = paletteColors[i][0];
    palette[i * 3 + 1] = paletteColors[i][1];
    palette[i * 3 + 2] = paletteColors[i][2];
  }

  // Map each pixel to nearest palette entry
  const indices = new Uint8Array(pixelCount);

  // Build a quick lookup cache: 15-bit color key -> palette index
  const lookupCache = new Map<number, number>();

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

    if (lookupCache.has(key)) {
      indices[i] = lookupCache.get(key)!;
      continue;
    }

    // Find nearest palette color (Manhattan distance for speed)
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < paletteSize; j++) {
      const dr = Math.abs(r - paletteColors[j][0]);
      const dg = Math.abs(g - paletteColors[j][1]);
      const db = Math.abs(b - paletteColors[j][2]);
      const dist = dr + dg + db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
        if (dist === 0) break;
      }
    }

    indices[i] = bestIdx;
    lookupCache.set(key, bestIdx);
  }

  return { palette, indices };
}

// --- LZW Compression for GIF ---

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const output: number[] = [];
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCode = 4096; // GIF LZW max

  // Initialize code table as a trie using Map<string, number>
  // For performance, use a prefix+suffix approach
  let table = new Map<string, number>();

  function resetTable() {
    table = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) {
      table.set(String(i), i);
    }
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }

  // Bit packing
  let bitBuffer = 0;
  let bitCount = 0;

  function writeBits(code: number, bits: number) {
    bitBuffer |= code << bitCount;
    bitCount += bits;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  // Start with clear code
  resetTable();
  writeBits(clearCode, codeSize);

  if (indices.length === 0) {
    writeBits(eoiCode, codeSize);
    if (bitCount > 0) output.push(bitBuffer & 0xff);
    return new Uint8Array(output);
  }

  let prefix = String(indices[0]);

  for (let i = 1; i < indices.length; i++) {
    const suffix = String(indices[i]);
    const combined = prefix + ',' + suffix;

    if (table.has(combined)) {
      prefix = combined;
    } else {
      writeBits(table.get(prefix)!, codeSize);

      if (nextCode < maxCode) {
        table.set(combined, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        // Table full, emit clear code and reset
        writeBits(clearCode, codeSize);
        resetTable();
      }

      prefix = suffix;
    }
  }

  // Write remaining prefix
  writeBits(table.get(prefix)!, codeSize);
  writeBits(eoiCode, codeSize);

  // Flush remaining bits
  if (bitCount > 0) {
    output.push(bitBuffer & 0xff);
  }

  return new Uint8Array(output);
}

// --- GIF89a file builder ---

function buildGif(
  frames: { palette: Uint8Array; indices: Uint8Array }[],
  width: number,
  height: number,
  frameDelay: number, // centiseconds
): Uint8Array {
  const parts: Uint8Array[] = [];

  function writeBytes(...bytes: number[]) {
    parts.push(new Uint8Array(bytes));
  }

  function writeString(s: string) {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      bytes[i] = s.charCodeAt(i);
    }
    parts.push(bytes);
  }

  function writeLe16(value: number) {
    writeBytes(value & 0xff, (value >> 8) & 0xff);
  }

  // --- Header ---
  writeString('GIF89a');

  // --- Logical Screen Descriptor ---
  writeLe16(width);
  writeLe16(height);
  // Global color table flag=1, color resolution=7, sort=0, size=7 (256 colors)
  writeBytes(0xf7); // packed: 1_111_0_111
  writeBytes(0); // background color index
  writeBytes(0); // pixel aspect ratio

  // --- Global Color Table (use first frame's palette) ---
  parts.push(frames[0].palette);

  // --- Netscape Application Extension (for looping) ---
  writeBytes(0x21, 0xff); // Extension + Application label
  writeBytes(0x0b); // Block size: 11
  writeString('NETSCAPE2.0');
  writeBytes(0x03); // Sub-block size: 3
  writeBytes(0x01); // Sub-block ID
  writeLe16(0); // Loop count: 0 = infinite
  writeBytes(0x00); // Block terminator

  // --- Frames ---
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];

    // Graphic Control Extension
    writeBytes(0x21, 0xf9); // Extension + GCE label
    writeBytes(0x04); // Block size: 4
    writeBytes(0x00); // Packed: disposal=0, user input=0, transparent=0
    writeLe16(frameDelay); // Delay time (centiseconds)
    writeBytes(0x00); // Transparent color index
    writeBytes(0x00); // Block terminator

    // Use local color table for subsequent frames (if palette differs from global)
    if (f === 0) {
      // Image Descriptor (use global color table)
      writeBytes(0x2c); // Image separator
      writeLe16(0); // Left
      writeLe16(0); // Top
      writeLe16(width);
      writeLe16(height);
      writeBytes(0x00); // Packed: no local color table, not interlaced
    } else {
      // Image Descriptor with local color table
      writeBytes(0x2c); // Image separator
      writeLe16(0); // Left
      writeLe16(0); // Top
      writeLe16(width);
      writeLe16(height);
      // Local color table flag=1, interlace=0, sort=0, size=7 (256 colors)
      writeBytes(0x87); // packed: 1_0_0_0_0111
      parts.push(frame.palette);
    }

    // LZW Image Data
    const minCodeSize = 8; // 256 colors = 8 bits
    writeBytes(minCodeSize);

    const lzwData = lzwEncode(frame.indices, minCodeSize);

    // Write sub-blocks (max 255 bytes each)
    let offset = 0;
    while (offset < lzwData.length) {
      const chunkSize = Math.min(255, lzwData.length - offset);
      writeBytes(chunkSize);
      parts.push(lzwData.slice(offset, offset + chunkSize));
      offset += chunkSize;
    }
    writeBytes(0x00); // Block terminator
  }

  // --- Trailer ---
  writeBytes(0x3b);

  // Concatenate all parts
  let totalLength = 0;
  for (const part of parts) totalLength += part.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }

  return result;
}

// --- Worker message handler ---

self.onmessage = (e: MessageEvent<EncodeRequest>) => {
  const { type, frames, width, height, frameDelay } = e.data;

  if (type !== 'encode') return;

  try {
    const totalFrames = frames.length;
    if (totalFrames === 0) {
      (self as unknown as Worker).postMessage({
        type: 'error',
        message: 'No frames to encode',
      } satisfies ErrorResponse);
      return;
    }

    const quantizedFrames: { palette: Uint8Array; indices: Uint8Array }[] = [];

    for (let i = 0; i < totalFrames; i++) {
      const rgba = new Uint8ClampedArray(frames[i]);
      const { palette, indices } = quantize(rgba, width, height);
      quantizedFrames.push({ palette, indices });

      // Report progress
      (self as unknown as Worker).postMessage({
        type: 'progress',
        percent: Math.round(((i + 1) / totalFrames) * 80), // quantization = 80% of work
      } satisfies ProgressResponse);
    }

    // Build GIF
    const gifData = buildGif(quantizedFrames, width, height, frameDelay);

    (self as unknown as Worker).postMessage({
      type: 'progress',
      percent: 100,
    } satisfies ProgressResponse);

    const blob = new Blob([gifData as Uint8Array<ArrayBuffer>], { type: 'image/gif' });

    (self as unknown as Worker).postMessage({
      type: 'done',
      blob,
    } satisfies EncodeResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown encoding error',
    } satisfies ErrorResponse);
  }
};
