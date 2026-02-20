/**
 * useStockWeather.ts - Weather controlled by fake stock market
 *
 * Simulates a weather derivatives market where "stocks" represent
 * weather conditions. Prices fluctuate randomly, and the dominant
 * stock determines the weather. Creates emergent, unpredictable
 * weather patterns that feel organic.
 *
 * Wild Idea #42 from TODO.md
 */
import { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherStock {
  name: string;
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  history: number[];
}

export interface StockWeather {
  sunAltitude: number;
  cloudiness: number;
  rain: number;
  fog: number;
}

export type MarketStatus = 'bull' | 'bear' | 'volatile' | 'stable';

export interface UseStockWeatherOptions {
  enabled: boolean;
  tickIntervalMs?: number;
}

export interface UseStockWeatherReturn {
  stocks: WeatherStock[];
  dominantStock: WeatherStock;
  weather: StockWeather;
  marketStatus: MarketStatus;
  lastEvent: string | null;
  totalMarketCap: number;
}

// ---------------------------------------------------------------------------
// Stock definitions
// ---------------------------------------------------------------------------

interface StockDefinition {
  name: string;
  ticker: string;
  baseVolatility: number;
}

const STOCK_DEFINITIONS: StockDefinition[] = [
  { name: 'Sunshine Corp', ticker: 'SUN', baseVolatility: 0.03 },
  { name: 'RainCloud Holdings', ticker: 'RAIN', baseVolatility: 0.04 },
  { name: 'Fog Industries', ticker: 'FOG', baseVolatility: 0.035 },
  { name: 'Thunder & Storm LLC', ticker: 'STRM', baseVolatility: 0.05 },
];

// ---------------------------------------------------------------------------
// Weather targets per dominant stock
// ---------------------------------------------------------------------------

const WEATHER_TARGETS: Record<string, StockWeather> = {
  SUN:  { sunAltitude: 90, cloudiness: 0,   rain: 0,   fog: 0 },
  RAIN: { sunAltitude: 45, cloudiness: 80,  rain: 80,  fog: 20 },
  FOG:  { sunAltitude: 30, cloudiness: 60,  rain: 10,  fog: 90 },
  STRM: { sunAltitude: 20, cloudiness: 100, rain: 100, fog: 30 },
};

const HISTORY_LENGTH = 20;
const INITIAL_PRICE = 100;
const PRICE_MIN = 10;
const PRICE_MAX = 500;

const CRASH_CHANCE = 0.02;
const CRASH_MIN = 0.15;
const CRASH_MAX = 0.30;

const RALLY_CHANCE = 0.01;
const RALLY_MIN = 0.10;
const RALLY_MAX = 0.20;

const LERP_RATE = 0.1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createInitialStock(def: StockDefinition): WeatherStock {
  return {
    name: def.name,
    ticker: def.ticker,
    price: INITIAL_PRICE,
    change: 0,
    changePercent: 0,
    history: [INITIAL_PRICE],
  };
}

function createInitialStocks(): WeatherStock[] {
  return STOCK_DEFINITIONS.map(createInitialStock);
}

function getDefaultWeather(): StockWeather {
  return { sunAltitude: 90, cloudiness: 0, rain: 0, fog: 0 };
}

function findDominant(stocks: WeatherStock[]): WeatherStock {
  let best = stocks[0];
  for (let i = 1; i < stocks.length; i++) {
    if (stocks[i].price > best.price) best = stocks[i];
  }
  return best;
}

function computeMarketStatus(stocks: WeatherStock[]): MarketStatus {
  let positiveCount = 0;
  let negativeCount = 0;
  let totalAbsChange = 0;

  for (const stock of stocks) {
    if (stock.change > 0) positiveCount++;
    else if (stock.change < 0) negativeCount++;
    totalAbsChange += Math.abs(stock.changePercent);
  }

  const avgAbsChange = totalAbsChange / stocks.length;

  // High average absolute change means volatile
  if (avgAbsChange > 5) return 'volatile';
  // All or most going up
  if (positiveCount >= 3) return 'bull';
  // All or most going down
  if (negativeCount >= 3) return 'bear';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStockWeather(options: UseStockWeatherOptions): UseStockWeatherReturn {
  const { enabled, tickIntervalMs = 3000 } = options;

  const [stocks, setStocks] = useState<WeatherStock[]>(createInitialStocks);
  const [weather, setWeather] = useState<StockWeather>(getDefaultWeather);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep mutable copies for the tick function to avoid stale closures
  const stocksRef = useRef<WeatherStock[]>(stocks);
  const weatherRef = useRef<StockWeather>(weather);

  // Sync refs on every render
  stocksRef.current = stocks;
  weatherRef.current = weather;

  const tick = useCallback(() => {
    const current = stocksRef.current;
    let event: string | null = null;

    // Determine if a crash or rally hits this tick (on a random stock)
    let crashIndex = -1;
    let rallyIndex = -1;
    let crashMagnitude = 0;
    let rallyMagnitude = 0;

    if (Math.random() < CRASH_CHANCE) {
      crashIndex = Math.floor(Math.random() * current.length);
      crashMagnitude = CRASH_MIN + Math.random() * (CRASH_MAX - CRASH_MIN);
    }
    if (Math.random() < RALLY_CHANCE) {
      rallyIndex = Math.floor(Math.random() * current.length);
      rallyMagnitude = RALLY_MIN + Math.random() * (RALLY_MAX - RALLY_MIN);
    }

    const updated = current.map((stock, i) => {
      const def = STOCK_DEFINITIONS[i];

      // Base price movement: slight downward bias (0.48) for mean reversion
      let volatility = def.baseVolatility;
      let drift = (Math.random() - 0.48) * volatility;

      // Momentum: if last 3 changes are in the same direction, boost by 1.5x
      const hist = stock.history;
      if (hist.length >= 3) {
        const last3 = hist.slice(-3);
        const allUp = last3.every((_, idx) =>
          idx === 0 ? true : last3[idx] > last3[idx - 1]
        );
        const allDown = last3.every((_, idx) =>
          idx === 0 ? true : last3[idx] < last3[idx - 1]
        );
        if (allUp || allDown) {
          drift *= 1.5;
        }
      }

      let newPrice = stock.price * (1 + drift);

      // Flash crash
      if (i === crashIndex) {
        newPrice = stock.price * (1 - crashMagnitude);
        const pct = Math.round(crashMagnitude * 100);
        event = `FLASH CRASH: ${stock.ticker} -${pct}%!`;
      }

      // Rally
      if (i === rallyIndex) {
        newPrice = stock.price * (1 + rallyMagnitude);
        const pct = Math.round(rallyMagnitude * 100);
        // If both crash and rally happen on the same stock in the same tick,
        // rally wins (last write). If on different stocks, both events fire
        // but we only show the rally string (more exciting).
        event = `RALLY: ${stock.ticker} +${pct}%!`;
      }

      newPrice = clamp(newPrice, PRICE_MIN, PRICE_MAX);

      const change = newPrice - stock.price;
      const changePercent = stock.price > 0 ? (change / stock.price) * 100 : 0;

      const newHistory = [...stock.history, newPrice];
      if (newHistory.length > HISTORY_LENGTH) {
        newHistory.splice(0, newHistory.length - HISTORY_LENGTH);
      }

      return {
        ...stock,
        price: Math.round(newPrice * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        history: newHistory,
      };
    });

    // Determine dominant stock and target weather
    const dominant = findDominant(updated);
    const target = WEATHER_TARGETS[dominant.ticker] ?? getDefaultWeather();

    // Smooth lerp toward target weather
    const currentWeather = weatherRef.current;
    const newWeather: StockWeather = {
      sunAltitude: lerp(currentWeather.sunAltitude, target.sunAltitude, LERP_RATE),
      cloudiness: lerp(currentWeather.cloudiness, target.cloudiness, LERP_RATE),
      rain: lerp(currentWeather.rain, target.rain, LERP_RATE),
      fog: lerp(currentWeather.fog, target.fog, LERP_RATE),
    };

    setStocks(updated);
    setWeather(newWeather);

    if (event) {
      setLastEvent(event);
      // Clear event after 4 seconds
      if (eventTimeoutRef.current) clearTimeout(eventTimeoutRef.current);
      eventTimeoutRef.current = setTimeout(() => {
        setLastEvent(null);
      }, 4000);
    }
  }, []);

  // Start / stop the ticker based on `enabled`
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Run immediately on enable, then every tickIntervalMs
    tick();
    intervalRef.current = setInterval(tick, tickIntervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, tickIntervalMs, tick]);

  // Cleanup event timeout on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (eventTimeoutRef.current) {
        clearTimeout(eventTimeoutRef.current);
        eventTimeoutRef.current = null;
      }
    };
  }, []);

  // Derived values
  const dominantStock = findDominant(stocks);
  const marketStatus = computeMarketStatus(stocks);
  const totalMarketCap = stocks.reduce((sum, s) => sum + s.price, 0);

  return {
    stocks,
    dominantStock,
    weather,
    marketStatus,
    lastEvent,
    totalMarketCap,
  };
}

export default useStockWeather;
