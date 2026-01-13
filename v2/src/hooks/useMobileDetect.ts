import { useState, useEffect } from 'react';

/**
 * Hook to detect if the user is on a mobile/touch device
 *
 * Uses multiple detection strategies:
 * 1. Touch event support
 * 2. Navigator maxTouchPoints
 * 3. Screen width (optional breakpoint check)
 *
 * @param breakpoint Optional max width to consider as mobile (default: 1024)
 * @returns boolean indicating if device is mobile/touch capable
 */
export function useMobileDetect(breakpoint: number = 1024): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    // Initial detection on mount
    if (typeof window === 'undefined') return false;

    const hasTouchEvents = 'ontouchstart' in window;
    const hasMaxTouchPoints = navigator.maxTouchPoints > 0;
    const isNarrowScreen = window.innerWidth <= breakpoint;

    return (hasTouchEvents || hasMaxTouchPoints) && isNarrowScreen;
  });

  useEffect(() => {
    const checkMobile = () => {
      const hasTouchEvents = 'ontouchstart' in window;
      const hasMaxTouchPoints = navigator.maxTouchPoints > 0;
      const isNarrowScreen = window.innerWidth <= breakpoint;

      setIsMobile((hasTouchEvents || hasMaxTouchPoints) && isNarrowScreen);
    };

    // Re-check on resize (handles orientation changes)
    window.addEventListener('resize', checkMobile);

    // Initial check
    checkMobile();

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, [breakpoint]);

  return isMobile;
}

/**
 * Simple check for touch capability without screen size consideration
 * Useful when you want to show touch controls regardless of screen size
 */
export function useTouchCapable(): boolean {
  const [isTouchCapable, setIsTouchCapable] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  });

  useEffect(() => {
    setIsTouchCapable('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  return isTouchCapable;
}

export default useMobileDetect;
