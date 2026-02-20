import { useRef, useEffect, useCallback, useState, type RefObject } from 'react';

interface WebGLCanvasProps {
  onBinaryFrame: (handler: ((data: Blob) => void) | null) => void;
  className?: string;
  speedKmh?: number;
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

// ---------- helpers ----------

// Hash for film grain
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Sample with crossfade: blend between previous and current frame
vec4 sampleBlended(vec2 uv) {
  return mix(texture(u_prevFrame, uv), texture(u_frame, uv), u_blend);
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

  // --- 1. Barrel distortion ---
  // Shift UV so center = (0,0)
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  float distortStrength = mix(0.05, 0.20, t);
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

  // --- 3. Chromatic aberration ---
  float edgeDist = length(uv - 0.5) * 2.0; // 0 at center, ~1.4 at corners
  vec2 caDir = normalize(uv - 0.5 + 0.0001); // direction from center

  // Base CA scales with barrel distortion intensity
  float caBase = mix(0.001, 0.004, t) * edgeDist;
  // Speed-based CA: radial shift from center, 0.003 at full intensity
  float caSpeed = u_chromatic * 0.003;
  // Combine: base edge-dependent + uniform speed-based
  float caAmount = caBase + caSpeed;

  // Sample R and B channels with CA offset, using radial blur when active
  vec3 color;
  if (u_radialBlur > 0.0) {
    float r = sampleRadialBlurBlended(clamp(uv + caDir * caAmount, 0.0, 1.0), u_radialBlur).r;
    float g = blurredColor.g;
    float b = sampleRadialBlurBlended(clamp(uv - caDir * caAmount, 0.0, 1.0), u_radialBlur).b;
    color = vec3(r, g, b);
  } else {
    float r = sampleBlended(clamp(uv + caDir * caAmount, 0.0, 1.0)).r;
    float g = sampleBlended(uv).g;
    float b = sampleBlended(clamp(uv - caDir * caAmount, 0.0, 1.0)).b;
    color = vec3(r, g, b);
  }

  // --- 3. Color grading (cinematic warm) ---
  // Lift (shadows): warm push
  vec3 lift = vec3(0.02, 0.01, -0.01) * mix(0.5, 1.0, t);
  // Gain (highlights): cool tint
  vec3 gain = vec3(0.98, 1.0, 1.04);
  // Gamma (midtones): slight warm
  vec3 gamma = vec3(0.98, 1.0, 1.02);

  color = pow(max(color, 0.0), gamma) * gain + lift;

  // Contrast boost (centered around 0.5)
  float contrast = mix(1.05, 1.15, t);
  color = (color - 0.5) * contrast + 0.5;

  // Saturation boost
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float saturation = mix(1.05, 1.15, t);
  color = mix(vec3(luma), color, saturation);

  // --- 4. Vignette ---
  float vignetteRadius = mix(0.85, 0.55, t);
  float vignetteSoft = 0.45;
  float vignette = smoothstep(vignetteRadius, vignetteRadius + vignetteSoft, edgeDist);
  color *= 1.0 - vignette * mix(0.3, 0.7, t);

  // --- 5. Film grain ---
  float grainStrength = mix(0.02, 0.06, t);
  float grain = hash(uv * 1000.0 + u_time * 60.0) - 0.5;
  color += grain * grainStrength;

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

export function WebGLCanvas({ onBinaryFrame, className = '', speedKmh = 0, externalCanvasRef }: WebGLCanvasProps) {
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
  }>({ time: null, intensity: null, chromatic: null, radialBlur: null, blend: null });
  const pendingFrameRef = useRef<ImageBitmap | null>(null);
  const rafIdRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const speedRef = useRef<number>(0);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const firstFrameReceivedRef = useRef(false);
  const textureInitializedRef = useRef(false);
  const prevTexInitRef = useRef(false);
  const blendFrameRef = useRef(false);
  const hasUploadedAnyFrameRef = useRef(false);

  // Keep speed ref in sync without triggering effect re-runs
  speedRef.current = speedKmh;

  const initGL = useCallback((canvas: HTMLCanvasElement): boolean => {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false });
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
        console.log(`[WebGLCanvas] FPS: ${frameCountRef.current}`);
      }
      frameCountRef.current = 0;
    }, 1000);

    // Render loop
    const renderLoop = () => {
      const gl = glRef.current;
      if (!gl) { rafIdRef.current = requestAnimationFrame(renderLoop); return; }

      const pending = pendingFrameRef.current;
      if (pending) {
        pendingFrameRef.current = null;

        // Resize canvas to match frame if needed
        const canvas2 = canvasRef.current;
        if (canvas2 && (canvas2.width !== pending.width || canvas2.height !== pending.height)) {
          canvas2.width = pending.width;
          canvas2.height = pending.height;
          gl.viewport(0, 0, pending.width, pending.height);
        }

        // Copy current texture -> previous texture before uploading new frame
        if (textureInitializedRef.current && hasUploadedAnyFrameRef.current) {
          // Use a framebuffer to read the current texture and copy to prev
          // Simpler approach: re-upload via copyTexImage2D using an FBO
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureRef.current, 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, prevTextureRef.current);
          if (!prevTexInitRef.current) {
            gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, pending.width, pending.height, 0);
            prevTexInitRef.current = true;
          } else {
            gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, pending.width, pending.height);
          }

          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fbo);
        }

        // Upload new frame to current texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRef.current);
        if (!textureInitializedRef.current) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pending);
          textureInitializedRef.current = true;

          // Initialize prev texture with same frame (no blend on first frame)
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, prevTextureRef.current);
          // Can't re-use pending (already consumed), so use copyTexImage2D via FBO
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureRef.current, 0);
          gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, pending.width, pending.height, 0);
          prevTexInitRef.current = true;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.deleteFramebuffer(fbo);
        } else {
          // texSubImage2D is faster if dimensions match; fall back to texImage2D on size change
          try {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pending);
          } catch {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pending);
          }
        }
        pending.close();
        hasUploadedAnyFrameRef.current = true;

        // Set blend flag: next render tick will show 50/50 crossfade
        blendFrameRef.current = true;
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

        // Chromatic aberration: ramp from 0 at <=120 to 1 at >=300 km/h
        const chromatic = Math.min(1.0, Math.max(0.0, (speed - 120) / 180));
        gl.uniform1f(uniformsRef.current.chromatic, chromatic);

        // Radial motion blur: ramp from 0 at rest to 1 at >=200 km/h
        const radialBlur = Math.min(1.0, Math.max(0.0, speed / 200));
        gl.uniform1f(uniformsRef.current.radialBlur, radialBlur);

        // Crossfade blend: 0.5 on first tick after new frame, 1.0 otherwise
        if (blendFrameRef.current) {
          gl.uniform1f(uniformsRef.current.blend, 0.5);
          blendFrameRef.current = false;
        } else {
          gl.uniform1f(uniformsRef.current.blend, 1.0);
        }

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        frameCountRef.current++;
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };
    rafIdRef.current = requestAnimationFrame(renderLoop);

    // Frame handler
    let decoding = false;

    const handler = (blob: Blob) => {
      if (decoding) return;
      decoding = true;

      createImageBitmap(blob)
        .then((bitmap) => {
          // Close previous pending if exists (drop frame)
          const prev = pendingFrameRef.current;
          if (prev) prev.close();
          pendingFrameRef.current = bitmap;
          decoding = false;

          if (!firstFrameReceivedRef.current) {
            firstFrameReceivedRef.current = true;
            setHasFirstFrame(true);
          }
        })
        .catch(() => {
          decoding = false;
        });
    };

    onBinaryFrame(handler);

    return () => {
      onBinaryFrame(null);
      cancelAnimationFrame(rafIdRef.current);
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
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
      blendFrameRef.current = false;
      hasUploadedAnyFrameRef.current = false;
    };
  }, [onBinaryFrame, initGL]);

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
        <div className="absolute inset-0 flex items-center justify-center bg-dark-500">
          <span className="text-white/40 text-lg font-mono animate-pulse">
            Waiting for video feed...
          </span>
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
