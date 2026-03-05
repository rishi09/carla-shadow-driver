import { useRef, useEffect, useCallback, useState, type RefObject } from 'react';
import type { CodecConfig } from '../types/index.ts';

interface WebGLCanvasProps {
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  /** H.264 frame handler registration (for WebCodecs decoding) */
  onH264Frame?: (handler: ((isKeyframe: boolean, data: ArrayBuffer) => void) | null) => void;
  /** Codec config handler registration (for WebCodecs decoder configuration) */
  onCodecConfig?: (handler: ((config: CodecConfig) => void) | null) => void;
  className?: string;
  speedKmh?: number;
  /** Current steering value: -1 (full left) to 1 (full right) */
  steer?: number;
  /** Optional external ref to access the underlying canvas element (e.g. for replay recording) */
  externalCanvasRef?: RefObject<HTMLCanvasElement | null>;
}

// ---------- GLSL shaders ----------

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_frame;
uniform sampler2D u_prevFrame;
uniform float u_blend;      // 0.5 = crossfade, 1.0 = current only
uniform float u_time;       // seconds since start
uniform float u_intensity;  // 0..1 speed-based effect intensity
uniform float u_chromatic;  // 0..1 chromatic aberration intensity (120-300 km/h)
uniform float u_radialBlur; // 0..1 radial motion blur intensity (speed-based)
uniform vec2 u_motionVector; // velocity-based pixel shift for motion-compensated interpolation

// ---------- helpers ----------

// Hash for film grain
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Sample with motion-compensated crossfade: shift prev/cur frames by motion vector
vec4 sampleBlended(vec2 uv) {
  // When blending (u_blend ~0.5), shift each frame by half the motion vector
  // so the intermediate result approximates where objects would be between frames.
  // When u_blend = 1.0 (current-only), motionVector is zero so this is a no-op.
  vec2 prevUV = clamp(uv + u_motionVector * 0.5, 0.0, 1.0);
  vec2 curUV  = clamp(uv - u_motionVector * 0.5, 0.0, 1.0);
  return mix(texture(u_prevFrame, prevUV), texture(u_frame, curUV), u_blend);
}

// Radial blur: samples along direction from center, weighted by distance
// Returns blurred color at uv. Blur = 0 at center, max at edges.
vec3 sampleRadialBlur(sampler2D tex, vec2 uv, float blurAmount) {
  vec2 dir = uv - 0.5;
  float dist = length(dir); // 0 at center, ~0.707 at corners

  // Per-pixel blur strength: proportional to distance from center
  float strength = dist * blurAmount * 0.04;

  // 7 samples along the radial direction, centered on current pixel
  vec3 sum = vec3(0.0);
  float totalWeight = 0.0;
  for (int i = -3; i <= 3; i++) {
    float offset = float(i) / 3.0; // -1 to 1
    vec2 sampleUV = clamp(uv - dir * strength * offset, 0.0, 1.0);
    // Gaussian-ish weight: center samples weigh more
    float w = 1.0 - abs(offset) * 0.4;
    sum += texture(tex, sampleUV).rgb * w;
    totalWeight += w;
  }
  return sum / totalWeight;
}

// Radial blur with crossfade blending between prev and current frames
vec3 sampleRadialBlurBlended(vec2 uv, float blurAmount) {
  vec2 dir = uv - 0.5;
  float dist = length(dir);
  float strength = dist * blurAmount * 0.04;

  vec3 sum = vec3(0.0);
  float totalWeight = 0.0;
  for (int i = -3; i <= 3; i++) {
    float offset = float(i) / 3.0;
    vec2 sampleUV = clamp(uv - dir * strength * offset, 0.0, 1.0);
    float w = 1.0 - abs(offset) * 0.4;
    sum += sampleBlended(sampleUV).rgb * w;
    totalWeight += w;
  }
  return sum / totalWeight;
}

void main() {
  vec2 uv = v_uv;
  float t = u_intensity; // 0 = slow, 1 = fast

  // --- 1. Barrel distortion --- DISABLED for high-latency playability
  // Shift UV so center = (0,0)
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  float distortStrength = 0.0; // was: mix(0.05, 0.20, t)
  vec2 distorted = centered * (1.0 + distortStrength * r2);
  uv = distorted + 0.5;

  // Clamp to valid texture range
  uv = clamp(uv, vec2(0.0), vec2(1.0));

  // --- 2. Radial motion blur (applied before CA so aberration splits blurred image) ---
  vec3 blurredColor;
  if (u_radialBlur > 0.0) {
    blurredColor = sampleRadialBlurBlended(uv, u_radialBlur);
  } else {
    blurredColor = sampleBlended(uv).rgb;
  }

  // --- 3. Chromatic aberration --- DISABLED for clean video
  // Baseline rendering: stylization disabled (no color grading, ACES, sharpening, vignette).
  vec3 color = blurredColor;

  // Final clamp
  color = clamp(color, 0.0, 1.0);

  fragColor = vec4(color, 1.0);
}`;

// ---------- WebGL helpers ----------

function createShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[WebGLCanvas] Shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[WebGLCanvas] Program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  // Shaders can be detached after linking
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

// ---------- Component ----------

export function WebGLCanvas({ onBinaryFrame, onH264Frame, onCodecConfig, className = '', speedKmh = 0, steer = 0, externalCanvasRef }: WebGLCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sync external canvas ref with internal ref
  useEffect(() => {
    if (externalCanvasRef && 'current' in externalCanvasRef) {
      (externalCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvasRef.current;
    }
    return () => {
      if (externalCanvasRef && 'current' in externalCanvasRef) {
        (externalCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = null;
      }
    };
  }, [externalCanvasRef]);

  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const textureRef = useRef<WebGLTexture | null>(null);
  const prevTextureRef = useRef<WebGLTexture | null>(null);
  const uniformsRef = useRef<{
    time: WebGLUniformLocation | null;
    intensity: WebGLUniformLocation | null;
    chromatic: WebGLUniformLocation | null;
    radialBlur: WebGLUniformLocation | null;
    blend: WebGLUniformLocation | null;
    motionVector: WebGLUniformLocation | null;
  }>({ time: null, intensity: null, chromatic: null, radialBlur: null, blend: null, motionVector: null });
  // pendingFrameRef accepts both ImageBitmap (JPEG path) and VideoFrame (H.264 path)
  const pendingFrameRef = useRef<ImageBitmap | VideoFrame | null>(null);
  const rafIdRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const speedRef = useRef<number>(0);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [decoderReady, setDecoderReady] = useState(false);
  const [startupElapsedMs, setStartupElapsedMs] = useState(0);
  const firstFrameReceivedRef = useRef(false);
  const textureInitializedRef = useRef(false);
  const prevTexInitRef = useRef(false);
  const hasUploadedAnyFrameRef = useRef(false);
  const startupBeginRef = useRef<number>(Date.now());

  // WebCodecs H.264 decoder state
  const decoderRef = useRef<VideoDecoder | null>(null);
  const h264TimestampRef = useRef<number>(0);
  const usingH264Ref = useRef(false);

  // Keep speed/steer refs in sync without triggering effect re-runs
  speedRef.current = speedKmh;
  void steer;

  useEffect(() => {
    startupBeginRef.current = Date.now();
    setStartupElapsedMs(0);

    if (hasFirstFrame) return;

    const interval = setInterval(() => {
      if (firstFrameReceivedRef.current) {
        clearInterval(interval);
        return;
      }
      setStartupElapsedMs(Date.now() - startupBeginRef.current);
    }, 250);

    return () => clearInterval(interval);
  }, [hasFirstFrame]);

  const initGL = useCallback((canvas: HTMLCanvasElement): boolean => {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return false;

    const prog = createProgram(gl);
    if (!prog) return false;

    glRef.current = gl;
    programRef.current = prog;

    // Full-screen quad: positions + UVs
    // prettier-ignore
    const verts = new Float32Array([
      -1, -1,  0, 1,   // bottom-left  (flip Y: uv.y=1)
       1, -1,  1, 1,   // bottom-right
      -1,  1,  0, 0,   // top-left     (flip Y: uv.y=0)
       1,  1,  1, 0,   // top-right
    ]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aUv = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    gl.useProgram(prog);

    // Uniforms
    uniformsRef.current = {
      time: gl.getUniformLocation(prog, 'u_time'),
      intensity: gl.getUniformLocation(prog, 'u_intensity'),
      chromatic: gl.getUniformLocation(prog, 'u_chromatic'),
      radialBlur: gl.getUniformLocation(prog, 'u_radialBlur'),
      blend: gl.getUniformLocation(prog, 'u_blend'),
      motionVector: gl.getUniformLocation(prog, 'u_motionVector'),
    };

    // Current frame texture (TEXTURE0)
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textureRef.current = tex;
    textureInitializedRef.current = false;

    // Previous frame texture (TEXTURE1)
    const prevTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    prevTextureRef.current = prevTex;
    prevTexInitRef.current = false;

    gl.uniform1i(gl.getUniformLocation(prog, 'u_frame'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_prevFrame'), 1);
    gl.uniform1f(uniformsRef.current.blend, 1.0); // Start with current-only

    return true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!initGL(canvas)) {
      console.error('[WebGLCanvas] Failed to initialize WebGL2');
      return;
    }

    startTimeRef.current = performance.now();

    // FPS logging
    frameCountRef.current = 0;
    fpsIntervalRef.current = setInterval(() => {
      if (frameCountRef.current > 0) {
        console.log(`[WebGLCanvas] FPS: ${frameCountRef.current}${usingH264Ref.current ? ' (H.264)' : ' (JPEG)'}`);
      }
      frameCountRef.current = 0;
    }, 1000);

    // Helper to close a pending frame (works for both ImageBitmap and VideoFrame)
    const closePending = (frame: ImageBitmap | VideoFrame | null) => {
      if (!frame) return;
      if ('close' in frame) frame.close();
    };

    // Helper to get frame dimensions (works for both ImageBitmap and VideoFrame)
    const getFrameSize = (frame: ImageBitmap | VideoFrame): { width: number; height: number } => {
      if (frame instanceof VideoFrame) {
        return { width: frame.displayWidth, height: frame.displayHeight };
      }
      return { width: frame.width, height: frame.height };
    };

    // Render loop
    const renderLoop = () => {
      const gl = glRef.current;
      if (!gl) { rafIdRef.current = requestAnimationFrame(renderLoop); return; }

      const pending = pendingFrameRef.current;
      if (pending) {
        pendingFrameRef.current = null;

        const { width, height } = getFrameSize(pending);

        // Resize canvas to match its CSS display size (not the frame size).
        // This ensures the WebGL viewport fills the entire visible area.
        // The texture will be stretched by the shader to fill the viewport.
        const canvas2 = canvasRef.current;
        if (canvas2) {
          const displayWidth = canvas2.clientWidth || canvas2.offsetWidth || 1280;
          const displayHeight = canvas2.clientHeight || canvas2.offsetHeight || 720;
          if (canvas2.width !== displayWidth || canvas2.height !== displayHeight) {
            canvas2.width = displayWidth;
            canvas2.height = displayHeight;
            gl.viewport(0, 0, displayWidth, displayHeight);
          }
        }

        // Copy current texture -> previous texture before uploading new frame
        if (textureInitializedRef.current && hasUploadedAnyFrameRef.current) {
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureRef.current, 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, prevTextureRef.current);
          if (!prevTexInitRef.current) {
            gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
            prevTexInitRef.current = true;
          } else {
            gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
          }

          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fbo);
        }

        // Upload new frame to current texture
        // WebGL2 texImage2D accepts both ImageBitmap and VideoFrame as TexImageSource
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
        if (!textureInitializedRef.current) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pending as TexImageSource);
          textureInitializedRef.current = true;

          // Initialize prev texture with same frame (no blend on first frame)
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, prevTextureRef.current);
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureRef.current, 0);
          gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
          prevTexInitRef.current = true;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fbo);
        } else {
          try {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pending as TexImageSource);
          } catch {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pending as TexImageSource);
          }
        }
        closePending(pending);
        hasUploadedAnyFrameRef.current = true;

      }

      // Only render if we have at least one frame uploaded
      if (hasUploadedAnyFrameRef.current) {
        // Update uniforms
        const elapsed = (performance.now() - startTimeRef.current) / 1000;
        gl.uniform1f(uniformsRef.current.time, elapsed);

        // Speed-based intensity: ramp from 0 at <=50 to 1 at >=150
        const speed = speedRef.current;
        const intensity = Math.min(1.0, Math.max(0.0, (speed - 50) / 100));
        gl.uniform1f(uniformsRef.current.intensity, intensity);

        // Chromatic aberration: DISABLED for high-latency playability
        // Re-enable when latency <100ms: Math.min(1.0, Math.max(0.0, (speed - 120) / 180))
        gl.uniform1f(uniformsRef.current.chromatic, 0.0);

        // Radial motion blur: DISABLED for high-latency playability
        // Re-enable when latency <100ms: Math.min(1.0, Math.max(0.0, speed / 200))
        gl.uniform1f(uniformsRef.current.radialBlur, 0.0);

        // Ghosting disabled: always render current frame only, no motion-compensated shift.
        gl.uniform1f(uniformsRef.current.blend, 1.0);
        gl.uniform2f(uniformsRef.current.motionVector, 0.0, 0.0);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        frameCountRef.current++;
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };
    rafIdRef.current = requestAnimationFrame(renderLoop);

    // --- JPEG fallback frame handler ---
    let jpegDecoding = false;

    const jpegHandler = (blob: Blob) => {
      // Skip JPEG decode when H.264 path is active
      if (usingH264Ref.current) return;
      if (jpegDecoding) return;
      jpegDecoding = true;

      createImageBitmap(blob)
        .then((bitmap) => {
          closePending(pendingFrameRef.current);
          pendingFrameRef.current = bitmap;
          jpegDecoding = false;

          if (!firstFrameReceivedRef.current) {
            firstFrameReceivedRef.current = true;
            setHasFirstFrame(true);
          }
        })
        .catch(() => {
          jpegDecoding = false;
        });
    };

    onBinaryFrame(jpegHandler);

    // --- WebCodecs H.264 decode handler ---
    const codecConfigHandler = (config: CodecConfig) => {
      // Close existing decoder if any
      if (decoderRef.current && decoderRef.current.state !== 'closed') {
        try { decoderRef.current.close(); } catch { /* ignore */ }
      }

      try {
        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            // Close previous pending frame
            closePending(pendingFrameRef.current);
            pendingFrameRef.current = frame;

            if (!firstFrameReceivedRef.current) {
              firstFrameReceivedRef.current = true;
              setHasFirstFrame(true);
            }
          },
          error: (err: DOMException) => {
            console.error('[WebGLCanvas] VideoDecoder error:', err.message);
            // Fall back to JPEG
            usingH264Ref.current = false;
            setDecoderReady(false);
            if (decoderRef.current && decoderRef.current.state !== 'closed') {
              try { decoderRef.current.close(); } catch { /* ignore */ }
            }
            decoderRef.current = null;
          },
        });

        decoder.configure({
          codec: config.codec,
          optimizeForLatency: true,
        });

        decoderRef.current = decoder;
        usingH264Ref.current = true;
        setDecoderReady(true);
        h264TimestampRef.current = 0;
        console.log(`[WebGLCanvas] VideoDecoder configured: ${config.codec} (H.264 hardware decode active)`);
      } catch (err) {
        console.warn('[WebGLCanvas] Failed to create VideoDecoder, using JPEG fallback:', err);
        usingH264Ref.current = false;
        setDecoderReady(false);
      }
    };

    const h264Handler = (isKeyframe: boolean, data: ArrayBuffer) => {
      const decoder = decoderRef.current;
      if (!decoder || decoder.state === 'closed') {
        // No decoder configured yet, skip
        return;
      }

      // Skip delta frames until we've seen a keyframe
      if (!isKeyframe && h264TimestampRef.current === 0) {
        return;
      }

      try {
        const chunk = new EncodedVideoChunk({
          type: isKeyframe ? 'key' : 'delta',
          timestamp: h264TimestampRef.current,
          data: data,
        });
        h264TimestampRef.current += 33333; // ~30fps in microseconds
        decoder.decode(chunk);
      } catch (err) {
        console.warn('[WebGLCanvas] H.264 decode error:', err);
      }
    };

    if (onH264Frame) onH264Frame(h264Handler);
    if (onCodecConfig) onCodecConfig(codecConfigHandler);

    return () => {
      onBinaryFrame(null);
      if (onH264Frame) onH264Frame(null);
      if (onCodecConfig) onCodecConfig(null);
      cancelAnimationFrame(rafIdRef.current);
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
      // Close VideoDecoder
      if (decoderRef.current && decoderRef.current.state !== 'closed') {
        try { decoderRef.current.close(); } catch { /* ignore */ }
      }
      decoderRef.current = null;
      usingH264Ref.current = false;
      // Close any pending VideoFrame
      closePending(pendingFrameRef.current);
      pendingFrameRef.current = null;
      // Clean up GL resources
      const gl = glRef.current;
      if (gl) {
        if (textureRef.current) gl.deleteTexture(textureRef.current);
        if (prevTextureRef.current) gl.deleteTexture(prevTextureRef.current);
        if (programRef.current) gl.deleteProgram(programRef.current);
      }
      glRef.current = null;
      programRef.current = null;
      textureRef.current = null;
      prevTextureRef.current = null;
      textureInitializedRef.current = false;
      prevTexInitRef.current = false;
      hasUploadedAnyFrameRef.current = false;
      setDecoderReady(false);
      setStartupElapsedMs(0);
    };
  }, [onBinaryFrame, onH264Frame, onCodecConfig, initGL]);

  const startupSeconds = Math.floor(startupElapsedMs / 1000);
  let startupTitle = 'Connecting to race server...';
  let startupHint = 'Initializing stream. This usually takes a second.';

  if (decoderReady) {
    startupTitle = 'Video decoder ready — waiting for first keyframe...';
    startupHint = 'Connection is alive. First frame should appear shortly.';
  } else if (startupSeconds >= 8) {
    startupTitle = 'Still waiting for first frame...';
    startupHint = 'If this takes over 15s, verify your ws URL or tunnel.';
  } else if (startupSeconds >= 3) {
    startupTitle = 'Starting video stream...';
    startupHint = 'Server is warming up. Please keep this tab open.';
  }

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="bg-dark-500 w-full h-full"
        style={{ objectFit: 'cover' }}
      />
      {!hasFirstFrame && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-500/95 backdrop-blur-sm">
          <div className="text-center px-6">
            <p className="text-white/90 text-base md:text-lg font-semibold animate-pulse">{startupTitle}</p>
            <p className="mt-2 text-white/55 text-sm">{startupHint}</p>
            <p className="mt-3 text-white/35 text-xs font-mono">startup {startupSeconds}s</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Feature-detect WebGL2 support */
export function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}
