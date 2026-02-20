/**
 * useSplitScreen.ts - Split-screen local multiplayer
 *
 * Two players on one keyboard. Player 1: WASD + Space.
 * Player 2: Arrow keys + Enter. Screen splits in half.
 *
 * Wild Idea #10 from TODO.md
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';

interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

const EMPTY_KEYS: KeyState = { up: false, down: false, left: false, right: false, brake: false };

export function useSplitScreen(enabled: boolean) {
  const [isActive, setIsActive] = useState(false);
  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const p1Ref = useRef<KeyState>({ ...EMPTY_KEYS });
  const p2Ref = useRef<KeyState>({ ...EMPTY_KEYS });
  const [p1Keys, setP1Keys] = useState<KeyState>({ ...EMPTY_KEYS });
  const [p2Keys, setP2Keys] = useState<KeyState>({ ...EMPTY_KEYS });

  useEffect(() => {
    setIsActive(enabled);
    if (!enabled) {
      p1Ref.current = { ...EMPTY_KEYS };
      p2Ref.current = { ...EMPTY_KEYS };
      setP1Keys({ ...EMPTY_KEYS });
      setP2Keys({ ...EMPTY_KEYS });
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const update = (key: string, pressed: boolean) => {
      switch (key) {
        case 'w': case 'W': p1Ref.current.up = pressed; break;
        case 's': case 'S': p1Ref.current.down = pressed; break;
        case 'a': case 'A': p1Ref.current.left = pressed; break;
        case 'd': case 'D': p1Ref.current.right = pressed; break;
        case ' ': p1Ref.current.brake = pressed; break;
        case 'ArrowUp': p2Ref.current.up = pressed; break;
        case 'ArrowDown': p2Ref.current.down = pressed; break;
        case 'ArrowLeft': p2Ref.current.left = pressed; break;
        case 'ArrowRight': p2Ref.current.right = pressed; break;
        case 'Enter': p2Ref.current.brake = pressed; break;
        default: return;
      }
      setP1Keys({ ...p1Ref.current });
      setP2Keys({ ...p2Ref.current });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      update(e.key, true);
    };
    const onKeyUp = (e: KeyboardEvent) => update(e.key, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);

  const toggleOrientation = useCallback(() => {
    setSplitOrientation(prev => prev === 'horizontal' ? 'vertical' : 'horizontal');
  }, []);

  const player1Style: CSSProperties = splitOrientation === 'horizontal'
    ? { position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden' }
    : { position: 'absolute', left: 0, top: 0, width: '100%', height: '50%', overflow: 'hidden' };

  const player2Style: CSSProperties = splitOrientation === 'horizontal'
    ? { position: 'absolute', right: 0, top: 0, width: '50%', height: '100%', overflow: 'hidden' }
    : { position: 'absolute', left: 0, bottom: 0, width: '100%', height: '50%', overflow: 'hidden' };

  return {
    isActive,
    player1Keys: p1Keys,
    player2Keys: p2Keys,
    splitOrientation,
    toggleOrientation,
    player1Style,
    player2Style,
  };
}

export default useSplitScreen;
