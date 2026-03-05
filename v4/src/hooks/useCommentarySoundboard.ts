/**
 * useCommentarySoundboard.ts - Spectator sound effects via Web Audio API
 *
 * A soundboard of racing sound effects generated via oscillators.
 *
 * Wild Idea #14 from TODO.md
 */
import { useState, useCallback, useRef } from 'react';

interface SoundEffect {
  id: string;
  label: string;
  emoji: string;
  category: 'reaction' | 'commentary' | 'ambient';
}

const SOUNDS: SoundEffect[] = [
  { id: 'airhorn', label: 'AIR HORN', emoji: '\u{1F4EF}', category: 'reaction' },
  { id: 'crash', label: 'CRASH!', emoji: '\u{1F4A5}', category: 'reaction' },
  { id: 'cheer', label: 'CHEER', emoji: '\u{1F389}', category: 'ambient' },
  { id: 'boo', label: 'BOO!', emoji: '\u{1F44E}', category: 'reaction' },
  { id: 'drumroll', label: 'DRUM ROLL', emoji: '\u{1F941}', category: 'commentary' },
  { id: 'sad_trombone', label: 'Wah Wah', emoji: '\u{1F3BA}', category: 'commentary' },
  { id: 'rev', label: 'REV', emoji: '\u{1F3CE}', category: 'ambient' },
  { id: 'bell', label: 'DING', emoji: '\u{1F514}', category: 'commentary' },
];

export function useCommentarySoundboard() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [volume, setVolume] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const play = useCallback((soundId: string) => {
    const ctx = getCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(ctx.destination);
    setIsPlaying(true);
    setLastPlayed(soundId);
    const now = ctx.currentTime;

    switch (soundId) {
      case 'airhorn': {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        const g = ctx.createGain();
        osc.connect(g); g.connect(masterGain);
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(330, now + 0.2);
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
        break;
      }
      case 'crash': {
        const len = Math.floor(ctx.sampleRate * 0.3);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        src.connect(g); g.connect(masterGain);
        g.gain.setValueAtTime(0.5, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        src.start(now);
        break;
      }
      case 'cheer': {
        for (let i = 0; i < 5; i++) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 300 + Math.random() * 400;
          osc.detune.value = Math.random() * 100 - 50;
          const g = ctx.createGain();
          osc.connect(g); g.connect(masterGain);
          g.gain.setValueAtTime(0.1, now);
          g.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
          osc.start(now); osc.stop(now + 1.0);
        }
        break;
      }
      case 'boo': {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const g = ctx.createGain();
        osc.connect(g); g.connect(masterGain);
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.linearRampToValueAtTime(60, now + 0.5);
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
        break;
      }
      case 'drumroll': {
        for (let i = 0; i < 40; i++) {
          const t = now + i * 0.05;
          const bLen = Math.floor(ctx.sampleRate * 0.03);
          const b = ctx.createBuffer(1, bLen, ctx.sampleRate);
          const dd = b.getChannelData(0);
          for (let j = 0; j < bLen; j++) dd[j] = (Math.random() * 2 - 1) * 0.5;
          const s = ctx.createBufferSource();
          s.buffer = b;
          const gg = ctx.createGain();
          s.connect(gg); gg.connect(masterGain);
          gg.gain.value = 0.15 + (i / 40) * 0.2;
          s.start(t);
        }
        break;
      }
      case 'sad_trombone': {
        [392, 349, 330, 262].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          const g = ctx.createGain();
          osc.connect(g); g.connect(masterGain);
          const st = now + i * 0.4;
          g.gain.setValueAtTime(0.25, st);
          g.gain.exponentialRampToValueAtTime(0.01, st + 0.35);
          osc.start(st); osc.stop(st + 0.4);
        });
        break;
      }
      case 'rev': {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const g = ctx.createGain();
        osc.connect(g); g.connect(masterGain);
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.linearRampToValueAtTime(200, now + 0.5);
        osc.frequency.linearRampToValueAtTime(80, now + 1.0);
        g.gain.setValueAtTime(0.15, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
        osc.start(now); osc.stop(now + 1.0);
        break;
      }
      case 'bell': {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 800;
        const g = ctx.createGain();
        osc.connect(g); g.connect(masterGain);
        g.gain.setValueAtTime(0.4, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
        break;
      }
    }
    setTimeout(() => setIsPlaying(false), 2000);
  }, [getCtx, volume]);

  return { sounds: SOUNDS, play, isPlaying, lastPlayed, volume, setVolume };
}

export default useCommentarySoundboard;
