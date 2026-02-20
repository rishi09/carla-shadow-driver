import { useState, useCallback, useRef, useEffect } from 'react';

interface PhotoModeProps {
  /** Reference to the video canvas element for screenshot capture */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Called when the user exits photo mode */
  onExit: () => void;
}

interface PhotoSettings {
  zoom: number;       // 0.5 - 3.0
  brightness: number; // -50 to +50
  contrast: number;   // -50 to +50
  saturation: number; // 0 - 200
  blur: number;       // 0 - 10
}

const DEFAULT_SETTINGS: PhotoSettings = {
  zoom: 1.0,
  brightness: 0,
  contrast: 0,
  saturation: 100,
  blur: 0,
};

export function PhotoMode({ canvasRef, onExit }: PhotoModeProps) {
  const [settings, setSettings] = useState<PhotoSettings>({ ...DEFAULT_SETTINGS });
  const [showSaved, setShowSaved] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pan state: offset in pixels, applied as CSS translate on the zoomed frame
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  const updateSetting = useCallback(<K extends keyof PhotoSettings>(key: K, value: PhotoSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    setPanX(0);
    setPanY(0);
  }, []);

  // Build CSS filter string from current settings
  const filterStyle = buildFilterStyle(settings);
  const transformStyle = `scale(${settings.zoom}) translate(${panX}px, ${panY}px)`;

  // Capture screenshot
  const handleCapture = useCallback(async () => {
    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas) return;

    // Create an offscreen canvas to apply filters and render the final image
    const offscreen = document.createElement('canvas');
    offscreen.width = sourceCanvas.width;
    offscreen.height = sourceCanvas.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    // Apply CSS-equivalent filters via canvas context
    ctx.filter = filterStyle;

    // Apply zoom: calculate the visible region (center crop at zoom level)
    const zoomFactor = settings.zoom;
    const srcW = sourceCanvas.width / zoomFactor;
    const srcH = sourceCanvas.height / zoomFactor;
    const srcX = (sourceCanvas.width - srcW) / 2 - panX * (sourceCanvas.width / window.innerWidth);
    const srcY = (sourceCanvas.height - srcH) / 2 - panY * (sourceCanvas.height / window.innerHeight);

    ctx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, 0, 0, offscreen.width, offscreen.height);

    // Apply edge blur (bokeh) as a radial gradient mask
    if (settings.blur > 0) {
      // Create a blurred version
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = offscreen.width;
      blurCanvas.height = offscreen.height;
      const blurCtx = blurCanvas.getContext('2d');
      if (blurCtx) {
        blurCtx.filter = `${filterStyle} blur(${settings.blur}px)`;
        blurCtx.drawImage(sourceCanvas, srcX, srcY, srcW, srcH, 0, 0, blurCanvas.width, blurCanvas.height);

        // Create radial gradient mask: clear center, opaque edges
        const cx = offscreen.width / 2;
        const cy = offscreen.height / 2;
        const r = Math.min(cx, cy) * 0.6;
        const gradient = ctx.createRadialGradient(cx, cy, r, cx, cy, Math.max(cx, cy) * 1.2);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,1)');

        // Draw blur layer masked by gradient
        ctx.globalCompositeOperation = 'destination-over';
        ctx.filter = 'none';
        ctx.drawImage(blurCanvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Export as PNG
    offscreen.toBlob((blob) => {
      if (!blob) return;

      // Try Web Share API on mobile first
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], `shadow-driver-${Date.now()}.png`, { type: 'image/png' });
        const shareData = { files: [file], title: 'Shadow Driver - Photo Mode' };
        if (navigator.canShare(shareData)) {
          navigator.share(shareData).catch(() => {
            // Fallback to download if share is cancelled
            downloadBlob(blob);
          });
          return;
        }
      }

      // Fallback: download
      downloadBlob(blob);
    }, 'image/png');

    // Show confirmation
    setShowSaved(true);
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
  }, [canvasRef, settings, filterStyle, panX, panY]);

  // Mouse drag for panning when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (settings.zoom <= 1.0) return;
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
  }, [settings.zoom, panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = (e.clientX - panStartRef.current.x) / settings.zoom;
    const dy = (e.clientY - panStartRef.current.y) / settings.zoom;
    setPanX(panStartRef.current.panX + dx);
    setPanY(panStartRef.current.panY + dy);
  }, [settings.zoom]);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // Keyboard shortcut: Escape to exit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onExit]);

  return (
    <div
      className="absolute inset-0 z-50"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: settings.zoom > 1 ? 'grab' : 'default' }}
    >
      {/* Filtered frame preview - applies CSS filters directly to the video underneath */}
      <style>{`
        .photo-mode-frame {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        @keyframes photo-saved-pop {
          0% { transform: scale(0.8); opacity: 0; }
          30% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes photo-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Filter overlay - sits on top of everything to apply CSS filters */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          filter: filterStyle,
          transform: transformStyle,
          transformOrigin: 'center center',
          mixBlendMode: 'normal',
        }}
      />

      {/* Edge blur overlay using CSS mask */}
      {settings.blur > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backdropFilter: `blur(${settings.blur}px)`,
            WebkitBackdropFilter: `blur(${settings.blur}px)`,
            maskImage: 'radial-gradient(ellipse 50% 50% at center, transparent 40%, black 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 50% 50% at center, transparent 40%, black 100%)',
          }}
        />
      )}

      {/* Dark border vignette for cinematic feel */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      {/* "PHOTO MODE" label - top left */}
      <div
        className="absolute top-4 left-4 z-50 flex items-center gap-2"
        style={{ animation: 'photo-fade-in 0.3s ease-out' }}
      >
        <div className="bg-black/70 backdrop-blur-md rounded-lg px-4 py-2 border border-white/20 flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-white/90 text-sm font-mono font-bold tracking-widest uppercase">Photo Mode</span>
        </div>
      </div>

      {/* Controls hint - top center */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 z-50"
        style={{ animation: 'photo-fade-in 0.3s ease-out 0.1s both' }}
      >
        <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-1.5 border border-white/10 text-white/40 text-xs font-mono">
          P or Esc to exit {settings.zoom > 1 ? ' | Drag to pan' : ''}
        </div>
      </div>

      {/* Right side panel: sliders */}
      <div
        className="absolute top-4 right-4 bottom-4 z-50 flex flex-col"
        style={{ animation: 'photo-fade-in 0.3s ease-out 0.15s both', width: panelCollapsed ? 'auto' : '240px' }}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setPanelCollapsed(prev => !prev)}
          className="self-end mb-2 bg-black/70 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-white/20 text-white/60 hover:text-white text-xs font-mono transition-colors pointer-events-auto"
        >
          {panelCollapsed ? 'Show Controls' : 'Hide'}
        </button>

        {!panelCollapsed && (
          <div className="flex-1 bg-black/70 backdrop-blur-md rounded-xl border border-white/15 overflow-y-auto pointer-events-auto">
            <div className="p-4 space-y-5">
              {/* Zoom */}
              <SliderControl
                label="Zoom"
                value={settings.zoom}
                min={0.5}
                max={3}
                step={0.05}
                displayValue={`${settings.zoom.toFixed(1)}x`}
                onChange={(v) => updateSetting('zoom', v)}
              />

              {/* Brightness */}
              <SliderControl
                label="Brightness"
                value={settings.brightness}
                min={-50}
                max={50}
                step={1}
                displayValue={`${settings.brightness > 0 ? '+' : ''}${settings.brightness}`}
                onChange={(v) => updateSetting('brightness', v)}
              />

              {/* Contrast */}
              <SliderControl
                label="Contrast"
                value={settings.contrast}
                min={-50}
                max={50}
                step={1}
                displayValue={`${settings.contrast > 0 ? '+' : ''}${settings.contrast}`}
                onChange={(v) => updateSetting('contrast', v)}
              />

              {/* Saturation */}
              <SliderControl
                label="Saturation"
                value={settings.saturation}
                min={0}
                max={200}
                step={1}
                displayValue={`${settings.saturation}%`}
                onChange={(v) => updateSetting('saturation', v)}
              />

              {/* Blur / Bokeh */}
              <SliderControl
                label="Bokeh"
                value={settings.blur}
                min={0}
                max={10}
                step={0.5}
                displayValue={`${settings.blur.toFixed(1)}px`}
                onChange={(v) => updateSetting('blur', v)}
              />

              {/* Divider */}
              <div className="border-t border-white/10" />

              {/* Reset button */}
              <button
                onClick={resetSettings}
                className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 text-xs font-mono uppercase tracking-wider transition-colors"
              >
                Reset All
              </button>
            </div>
          </div>
        )}

        {/* Bottom buttons: Capture + Exit */}
        <div className="mt-3 space-y-2 pointer-events-auto">
          {/* Capture button */}
          <button
            onClick={handleCapture}
            className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/40 text-white font-bold text-sm font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Capture
          </button>

          {/* Exit button */}
          <button
            onClick={onExit}
            className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 font-bold text-xs font-mono uppercase tracking-wider transition-all"
          >
            Exit Photo Mode
          </button>
        </div>
      </div>

      {/* "Saved!" confirmation toast */}
      {showSaved && (
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50"
          style={{ animation: 'photo-saved-pop 0.3s ease-out' }}
        >
          <div className="bg-green-500/20 backdrop-blur-md rounded-xl px-6 py-3 border border-green-400/40 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-green-400 font-bold text-sm font-mono">Photo Saved!</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Individual slider control with label, value, and styled range input */
function SliderControl({ label, value, min, max, step, displayValue, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-white/60 text-xs font-mono uppercase tracking-wider">{label}</span>
        <span className="text-white/80 text-xs font-mono font-bold">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer photo-slider"
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.3) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) 100%)`,
        }}
      />
      <style>{`
        .photo-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(255,255,255,0.4);
          box-shadow: 0 0 6px rgba(0,0,0,0.5);
          cursor: pointer;
        }
        .photo-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: white;
          border: 2px solid rgba(255,255,255,0.4);
          box-shadow: 0 0 6px rgba(0,0,0,0.5);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

/** Build a CSS filter string from photo settings */
function buildFilterStyle(settings: PhotoSettings): string {
  const parts: string[] = [];

  if (settings.brightness !== 0) {
    // brightness(-50 to +50) maps to CSS brightness(0.5 to 1.5)
    parts.push(`brightness(${1 + settings.brightness / 100})`);
  }

  if (settings.contrast !== 0) {
    // contrast(-50 to +50) maps to CSS contrast(0.5 to 1.5)
    parts.push(`contrast(${1 + settings.contrast / 100})`);
  }

  if (settings.saturation !== 100) {
    // saturation(0 to 200) maps to CSS saturate(0 to 2)
    parts.push(`saturate(${settings.saturation / 100})`);
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

/** Download a blob as a file */
function downloadBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shadow-driver-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
