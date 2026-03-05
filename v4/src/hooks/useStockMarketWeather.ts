/**
 * useStockMarketWeather.ts - Stock Market Weather (Wild Idea #42)
 *
 * Maps real-time S&P 500 market data to CARLA weather parameters.
 * Bull markets bring sunshine; bear markets bring storms.
 *
 * Market-to-weather mapping:
 *   changePercent > 1%    → Clear sunny   (sun 70, clouds 0)
 *   0% to 1%              → Partly cloudy (sun 50, clouds 30)
 *   -1% to 0%             → Overcast      (sun 30, clouds 70)
 *   changePercent < -1%   → Stormy        (sun 20, clouds 90, rain 80)
 *   High volatility       → Fog
 *
 * Falls back to deterministic time-based sine wave weather when the API
 * is unavailable, so the feature always produces usable weather params.
 *
 * @module useStockMarketWeather
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw market data extracted from the Yahoo Finance response */
export interface MarketData {
  /** Current S&P 500 price */
  price: number;
  /** Previous close price */
  previousClose: number;
  /** Absolute change from previous close */
  change: number;
  /** Percentage change from previous close */
  changePercent: number;
  /** Intraday high */
  high: number;
  /** Intraday low */
  low: number;
  /** Intraday volatility as a percentage of price: (high - low) / previousClose * 100 */
  volatility: number;
  /** ISO-8601 timestamp of the data point */
  timestamp: string;
}

/** CARLA-compatible weather parameters */
export interface WeatherParams {
  /** Sun altitude angle in degrees (0-90) */
  sunAltitude: number;
  /** Cloudiness percentage (0-100) */
  cloudiness: number;
  /** Rain intensity percentage (0-100) */
  rain: number;
  /** Fog density percentage (0-100) */
  fog: number;
  /** Wind intensity percentage (0-100) */
  windIntensity: number;
}

/** Human-readable market mood label */
export type MarketMood =
  | 'Bull Run'
  | 'Steady Gains'
  | 'Flat'
  | 'Bear Territory'
  | 'Market Crash';

/** Return value of the useStockMarketWeather hook */
export interface StockMarketWeatherState {
  /** Raw market numbers (null until first successful fetch or fallback) */
  marketData: MarketData | null;
  /** CARLA weather parameters derived from market data */
  weather: WeatherParams;
  /** Short mood label for display in the HUD */
  marketMood: MarketMood;
  /** One-line human-readable description of the weather */
  weatherDescription: string;
  /** True while the initial fetch is in-flight */
  isLoading: boolean;
  /** Error message from the most recent failed fetch, or null */
  error: string | null;
  /** Whether stock-market weather is turned on */
  enabled: boolean;
  /** Toggle the feature on/off */
  setEnabled: (enabled: boolean) => void;
  /** Force an immediate refetch */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YAHOO_FINANCE_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/^GSPC?range=1d&interval=5m';

/** Minimum milliseconds between API calls */
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Auto-refresh interval (matches cache TTL) */
const REFRESH_INTERVAL_MS = CACHE_TTL_MS;

/** Default (neutral) weather when no data is available yet */
const DEFAULT_WEATHER: WeatherParams = {
  sunAltitude: 45,
  cloudiness: 40,
  rain: 0,
  fog: 0,
  windIntensity: 20,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number between min and max (inclusive).
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Derive a MarketMood from the percentage change.
 */
function moodFromChange(changePercent: number): MarketMood {
  if (changePercent > 2) return 'Bull Run';
  if (changePercent > 0.5) return 'Steady Gains';
  if (changePercent > -0.5) return 'Flat';
  if (changePercent > -2) return 'Bear Territory';
  return 'Market Crash';
}

/**
 * Map MarketData to CARLA WeatherParams.
 */
function marketToWeather(data: MarketData): WeatherParams {
  const pct = data.changePercent;
  const vol = data.volatility;

  let sunAltitude: number;
  let cloudiness: number;
  let rain: number;
  let windIntensity: number;

  if (pct > 1) {
    // Clear sunny
    sunAltitude = 70;
    cloudiness = 0;
    rain = 0;
    windIntensity = clamp(10 + vol * 5, 0, 40);
  } else if (pct >= 0) {
    // Partly cloudy — linearly interpolate within the band
    const t = pct; // 0..1
    sunAltitude = 50 + t * 20; // 50-70
    cloudiness = 30 - t * 30; // 30-0
    rain = 0;
    windIntensity = clamp(15 + vol * 8, 0, 50);
  } else if (pct >= -1) {
    // Overcast
    const t = -pct; // 0..1
    sunAltitude = 30 + (1 - t) * 20; // 30-50
    cloudiness = 70 - (1 - t) * 40; // 30-70
    rain = clamp(t * 20, 0, 20); // light drizzle at most
    windIntensity = clamp(25 + vol * 10, 0, 60);
  } else {
    // Stormy
    const severity = clamp(-pct - 1, 0, 4) / 4; // 0..1 over -1% to -5%
    sunAltitude = 20 - severity * 10; // 20 down to 10
    cloudiness = 90 + severity * 10; // 90-100
    rain = 80 + severity * 20; // 80-100
    windIntensity = clamp(50 + severity * 50, 0, 100);
  }

  // High volatility → fog
  // Volatility is typically 0.5-3% for a normal day; above 2% is quite wild.
  const fog = vol > 1.5 ? clamp((vol - 1.5) * 40, 0, 100) : 0;

  return {
    sunAltitude: clamp(sunAltitude, 0, 90),
    cloudiness: clamp(cloudiness, 0, 100),
    rain: clamp(rain, 0, 100),
    fog: clamp(fog, 0, 100),
    windIntensity: clamp(windIntensity, 0, 100),
  };
}

/**
 * Build a human-readable one-liner for the current weather + mood.
 */
function describeWeather(weather: WeatherParams, mood: MarketMood): string {
  const parts: string[] = [];

  if (weather.cloudiness < 10) parts.push('Clear skies');
  else if (weather.cloudiness < 50) parts.push('Partly cloudy');
  else if (weather.cloudiness < 80) parts.push('Overcast');
  else parts.push('Heavy clouds');

  if (weather.rain > 60) parts.push('heavy rain');
  else if (weather.rain > 20) parts.push('light rain');

  if (weather.fog > 40) parts.push('dense fog');
  else if (weather.fog > 10) parts.push('light fog');

  if (weather.windIntensity > 60) parts.push('strong winds');

  return `${parts.join(', ')} (${mood})`;
}

/**
 * Deterministic time-based fallback weather using sine waves.
 *
 * Seeded by the current 5-minute epoch so repeated calls within the same
 * window always return identical values (no jitter between renders).
 */
function fallbackWeather(): { weather: WeatherParams; mood: MarketMood; marketData: MarketData } {
  // Quantize to 5-minute buckets for stability
  const bucket = Math.floor(Date.now() / CACHE_TTL_MS);
  // Use several prime-period sine waves seeded by the bucket index
  const s1 = Math.sin(bucket * 0.7);          // slow cycle  (~hours)
  const s2 = Math.sin(bucket * 1.3 + 2.1);    // medium cycle
  const s3 = Math.sin(bucket * 2.9 + 4.7);    // fast cycle

  // Map s1 to a fake changePercent in [-3, 3]
  const changePercent = s1 * 3;
  const volatility = Math.abs(s2) * 3;
  const price = 5000 + s3 * 200; // cosmetic

  const marketData: MarketData = {
    price,
    previousClose: price / (1 + changePercent / 100),
    change: price - price / (1 + changePercent / 100),
    changePercent,
    high: price + Math.abs(s2) * 50,
    low: price - Math.abs(s3) * 50,
    volatility,
    timestamp: new Date().toISOString(),
  };

  const weather = marketToWeather(marketData);
  const mood = moodFromChange(changePercent);
  return { weather, mood, marketData };
}

// ---------------------------------------------------------------------------
// In-memory cache (shared across all hook instances in the same page)
// ---------------------------------------------------------------------------

let cachedData: { marketData: MarketData; fetchedAt: number } | null = null;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook that fetches S&P 500 data and maps it to CARLA weather params.
 *
 * @example
 * ```tsx
 * const { weather, marketMood, weatherDescription, enabled, setEnabled } = useStockMarketWeather();
 * // Pass weather.sunAltitude, weather.cloudiness, etc. to the race config
 * ```
 */
export function useStockMarketWeather(): StockMarketWeatherState {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [weather, setWeather] = useState<WeatherParams>(DEFAULT_WEATHER);
  const [marketMood, setMarketMood] = useState<MarketMood>('Flat');
  const [weatherDescription, setWeatherDescription] = useState<string>('Loading market data...');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ------------------------------------------------------------------
  // Core fetch logic
  // ------------------------------------------------------------------
  const fetchMarketData = useCallback(async () => {
    // Return cached data if still fresh
    if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL_MS) {
      const data = cachedData.marketData;
      const mood = moodFromChange(data.changePercent);
      const w = marketToWeather(data);
      setMarketData(data);
      setWeather(w);
      setMarketMood(mood);
      setWeatherDescription(describeWeather(w, mood));
      setIsLoading(false);
      setError(null);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(!cachedData); // only show spinner on first load

      const res = await fetch(YAHOO_FINANCE_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Yahoo Finance returned ${res.status}`);
      }

      const json = await res.json();

      // Drill into the Yahoo Finance v8 chart response
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('Unexpected Yahoo Finance response shape');

      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];
      const timestamps: number[] = result.timestamp ?? [];

      const currentPrice: number = meta?.regularMarketPrice ?? meta?.previousClose ?? 0;
      const previousClose: number = meta?.chartPreviousClose ?? meta?.previousClose ?? currentPrice;

      // Compute intraday high/low from the quote arrays if available
      let high = currentPrice;
      let low = currentPrice;
      if (quote?.high && quote?.low) {
        const highs: (number | null)[] = quote.high;
        const lows: (number | null)[] = quote.low;
        high = Math.max(...highs.filter((v: number | null): v is number => v != null));
        low = Math.min(...lows.filter((v: number | null): v is number => v != null));
      }

      const change = currentPrice - previousClose;
      const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;
      const volatility = previousClose !== 0 ? ((high - low) / previousClose) * 100 : 0;

      const lastTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : Date.now() / 1000;

      const data: MarketData = {
        price: currentPrice,
        previousClose,
        change,
        changePercent,
        high,
        low,
        volatility,
        timestamp: new Date(lastTimestamp * 1000).toISOString(),
      };

      // Update cache
      cachedData = { marketData: data, fetchedAt: Date.now() };

      const mood = moodFromChange(changePercent);
      const w = marketToWeather(data);

      setMarketData(data);
      setWeather(w);
      setMarketMood(mood);
      setWeatherDescription(describeWeather(w, mood));
      setIsLoading(false);
      setError(null);
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return; // ignore intentional aborts

      const message = err instanceof Error ? err.message : 'Unknown error fetching market data';
      console.warn('[StockMarketWeather] Fetch failed, using fallback:', message);
      setError(message);

      // Deterministic time-based fallback
      const fb = fallbackWeather();
      setMarketData(fb.marketData);
      setWeather(fb.weather);
      setMarketMood(fb.mood);
      setWeatherDescription(describeWeather(fb.weather, fb.mood) + ' (simulated)');
      setIsLoading(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Refetch (user-facing, clears cache to force fresh data)
  // ------------------------------------------------------------------
  const refetch = useCallback(() => {
    cachedData = null;
    fetchMarketData();
  }, [fetchMarketData]);

  // ------------------------------------------------------------------
  // Lifecycle: auto-fetch on mount + periodic refresh
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      // When disabled, reset to defaults
      setMarketData(null);
      setWeather(DEFAULT_WEATHER);
      setMarketMood('Flat');
      setWeatherDescription('Stock market weather disabled');
      setIsLoading(false);
      setError(null);
      return;
    }

    // Initial fetch
    fetchMarketData();

    // Periodic refresh
    intervalRef.current = setInterval(fetchMarketData, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [enabled, fetchMarketData]);

  return {
    marketData,
    weather,
    marketMood,
    weatherDescription,
    isLoading,
    error,
    enabled,
    setEnabled,
    refetch,
  };
}

export default useStockMarketWeather;
