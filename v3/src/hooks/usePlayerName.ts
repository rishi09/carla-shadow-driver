import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'shadow_driver_player_name';
const DEFAULT_NAME = 'Player';

export function usePlayerName() {
  const [name, setNameState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const setName = useCallback((newName: string) => {
    setNameState(newName);

    // Debounced save to localStorage (500ms)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (newName.trim()) {
          localStorage.setItem(STORAGE_KEY, newName.trim());
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // localStorage not available -- ignore
      }
    }, 500);
  }, []);

  const getName = useCallback((): string => {
    const trimmed = name.trim();
    return trimmed || DEFAULT_NAME;
  }, [name]);

  return { name, setName, getName };
}
