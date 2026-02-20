/**
 * useAIEvolution.ts - Genetic algorithm for AI driving traits
 *
 * Simulates evolution of AI driving parameters across generations.
 *
 * Wild Idea #22 from TODO.md
 */
import { useState, useCallback, useRef, useEffect } from 'react';

interface AIGenome {
  id: string;
  generation: number;
  traits: {
    aggression: number;
    brakingDistance: number;
    corneringSpeed: number;
    riskTolerance: number;
    topSpeedFocus: number;
  };
  fitness: number;
  name: string;
}

interface EvolutionSnapshot {
  generation: number;
  bestFitness: number;
  avgFitness: number;
}

const STORAGE_KEY = 'shadow-driver-evolution';
const ADJECTIVES = ['Swift', 'Reckless', 'Precise', 'Savage', 'Silent', 'Iron', 'Shadow', 'Thunder', 'Crimson', 'Frost', 'Blazing', 'Phantom'];
const NOUNS = ['Falcon', 'Viper', 'Wolf', 'Hawk', 'Panther', 'Cobra', 'Stallion', 'Eagle', 'Tiger', 'Dragon', 'Phoenix', 'Shark'];

function randomName(): string {
  return `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
}

function computeFitness(traits: AIGenome['traits']): number {
  const base = traits.corneringSpeed * 30 + traits.topSpeedFocus * 25 + traits.aggression * 15 +
    traits.riskTolerance * 10 - (1 - traits.brakingDistance) * 20;
  return Math.max(0, base * (1 + (Math.random() - 0.5) * 0.2));
}

function createGenome(generation: number): AIGenome {
  const traits = {
    aggression: Math.random(),
    brakingDistance: Math.random(),
    corneringSpeed: Math.random(),
    riskTolerance: Math.random(),
    topSpeedFocus: Math.random(),
  };
  return {
    id: `gen${generation}-${Math.random().toString(36).slice(2, 8)}`,
    generation, traits, fitness: computeFitness(traits), name: randomName(),
  };
}

function tournamentSelect(pop: AIGenome[]): AIGenome {
  const c = [0, 0, 0].map(() => pop[Math.floor(Math.random() * pop.length)]);
  return c.reduce((a, b) => a.fitness > b.fitness ? a : b);
}

function crossover(a: AIGenome, b: AIGenome, gen: number): AIGenome {
  const traits = {
    aggression: Math.random() < 0.5 ? a.traits.aggression : b.traits.aggression,
    brakingDistance: Math.random() < 0.5 ? a.traits.brakingDistance : b.traits.brakingDistance,
    corneringSpeed: Math.random() < 0.5 ? a.traits.corneringSpeed : b.traits.corneringSpeed,
    riskTolerance: Math.random() < 0.5 ? a.traits.riskTolerance : b.traits.riskTolerance,
    topSpeedFocus: Math.random() < 0.5 ? a.traits.topSpeedFocus : b.traits.topSpeedFocus,
  };
  const keys = Object.keys(traits) as (keyof typeof traits)[];
  for (const key of keys) {
    if (Math.random() < 0.1) traits[key] = Math.max(0, Math.min(1, traits[key] + (Math.random() - 0.5) * 0.2));
  }
  return { id: `gen${gen}-${Math.random().toString(36).slice(2, 8)}`, generation: gen, traits, fitness: computeFitness(traits), name: randomName() };
}

function loadChampion(): AIGenome | null {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

function saveChampion(g: AIGenome): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

export function useAIEvolution(enabled: boolean, populationSize = 10) {
  const [generation, setGeneration] = useState(1);
  const [population, setPopulation] = useState<AIGenome[]>(() =>
    Array.from({ length: populationSize }, () => createGenome(1)),
  );
  const [allTimeChampion, setAllTimeChampion] = useState<AIGenome | null>(loadChampion);
  const [history, setHistory] = useState<EvolutionSnapshot[]>([]);
  const [autoEvolve, setAutoEvolve] = useState(false);
  const [isEvolving, setIsEvolving] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const champion = population.reduce((a, b) => a.fitness > b.fitness ? a : b);

  const evolve = useCallback(() => {
    setIsEvolving(true);
    setGeneration(prev => {
      const nextGen = prev + 1;
      setPopulation(currentPop => {
        const newPop: AIGenome[] = [];
        const sorted = [...currentPop].sort((a, b) => b.fitness - a.fitness);
        newPop.push({ ...sorted[0], generation: nextGen, fitness: computeFitness(sorted[0].traits) });
        newPop.push({ ...sorted[1], generation: nextGen, fitness: computeFitness(sorted[1].traits) });
        while (newPop.length < populationSize) {
          newPop.push(crossover(tournamentSelect(currentPop), tournamentSelect(currentPop), nextGen));
        }
        const best = newPop.reduce((a, b) => a.fitness > b.fitness ? a : b);
        setAllTimeChampion(p => {
          if (!p || best.fitness > p.fitness) { saveChampion(best); return best; }
          return p;
        });
        const avg = newPop.reduce((s, g) => s + g.fitness, 0) / newPop.length;
        setHistory(h => [...h, { generation: nextGen, bestFitness: best.fitness, avgFitness: avg }].slice(-50));
        return newPop;
      });
      return nextGen;
    });
    setTimeout(() => setIsEvolving(false), 100);
  }, [populationSize]);

  useEffect(() => {
    if (autoEvolve && enabled) {
      intervalRef.current = setInterval(evolve, 3000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [autoEvolve, enabled, evolve]);

  return {
    currentGeneration: generation, population, champion, allTimeChampion,
    evolve, autoEvolve, setAutoEvolve, evolutionHistory: history, isEvolving,
  };
}

export default useAIEvolution;
