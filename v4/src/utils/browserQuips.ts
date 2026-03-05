/**
 * browserQuips.ts - Fourth-wall breaking browser detection quips
 *
 * Reads navigator.userAgent to detect the browser and returns a witty
 * AI-generated quip displayed during the countdown overlay.
 */

interface BrowserInfo {
  name: string;
  quips: string[];
}

/** Detect whether the browser is in private/incognito mode.
 *  Heuristic: in Chrome incognito, storage quota is limited; in Firefox private,
 *  IndexedDB is restricted. Returns a best-effort guess. */
function isLikelyIncognito(): boolean {
  try {
    // Chrome incognito: window.chrome exists but storage.estimate() returns < 120MB
    // Firefox private: IndexedDB open throws
    // Safari private: localStorage.setItem throws after quota is hit immediately
    // None of these are 100% reliable, so we just do a quick localStorage check.
    const testKey = '__sd_incognito_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return false;
  } catch {
    return true;
  }
}

/** Detect browser and return a random witty quip. */
export function getBrowserQuip(): string {
  const ua = navigator.userAgent;

  // Check incognito first (overrides browser-specific quips)
  if (isLikelyIncognito()) {
    const incognitoQuips = [
      'Incognito mode? Trying to hide your lap times?',
      'Private browsing? Your losses are still real.',
      'Going incognito won\'t hide your driving from the AI.',
    ];
    return incognitoQuips[Math.floor(Math.random() * incognitoQuips.length)];
  }

  // Check mobile first (overrides desktop browser quips)
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  if (isMobile) {
    const mobileQuips = [
      'Racing on mobile? Brave. Very brave.',
      'Touchscreen racing? The AI respects your courage.',
      'Mobile racer detected. Bold strategy.',
      'Tiny screen, big heart. Let\'s go.',
    ];
    return mobileQuips[Math.floor(Math.random() * mobileQuips.length)];
  }

  // Detect specific browsers (order matters: Edge uses Chrome UA too)
  const browsers: BrowserInfo[] = [
    {
      name: 'Edge',
      quips: [
        'Microsoft Edge? The AI already feels sorry for you.',
        'Edge user? At least you\'re not using Internet Explorer.',
        'Racing in Edge. Unexpected. The AI is intrigued.',
      ],
    },
    {
      name: 'Opera',
      quips: [
        'Opera? A browser of culture. The AI approves.',
        'Opera user spotted. You like doing things differently.',
      ],
    },
    {
      name: 'Brave',
      quips: [
        'Brave browser? Fitting name for what you\'re about to attempt.',
        'Brave user. Privacy-conscious AND reckless? Interesting combo.',
      ],
    },
    {
      name: 'Firefox',
      quips: [
        'Racing in Firefox? Bold choice. Respect.',
        'Firefox user. Independent thinker. The AI likes a challenge.',
        'Firefox? Open source browser, closed racing lines. Let\'s fix that.',
      ],
    },
    {
      name: 'Safari',
      quips: [
        'Safari? On a Mac? You drive like you code -- different.',
        'Safari user. The AI hopes your rendering is as smooth as your driving.',
        'Racing in Safari. The AI admires your... commitment.',
      ],
    },
    {
      name: 'Chrome',
      quips: [
        'Chrome user detected. At least your tabs are fast.',
        'Chrome? Hope you left enough RAM for the race.',
        'Google Chrome. 47 tabs open and still racing. Impressive.',
        'Chrome detected. The AI has already indexed your weaknesses.',
      ],
    },
  ];

  // Match browser
  for (const browser of browsers) {
    if (ua.includes(browser.name) || ua.includes(browser.name.toLowerCase())) {
      return browser.quips[Math.floor(Math.random() * browser.quips.length)];
    }
  }

  // Fallback for unknown browsers
  const fallbackQuips = [
    'Unknown browser? Mysterious. The AI is concerned.',
    'The AI can\'t identify your browser. Intriguing.',
    'Custom browser? The AI wasn\'t trained for this.',
  ];
  return fallbackQuips[Math.floor(Math.random() * fallbackQuips.length)];
}

/** Get a battery-themed quip based on battery level and charging state.
 *  Returns null if no battery info is available. */
export function getBatteryQuip(level: number, charging: boolean): string {
  if (charging && level >= 0.95) {
    return 'Full battery. Full speed. No mercy.';
  }
  if (charging) {
    return 'Plugged in? No excuses.';
  }
  if (level < 0.1) {
    return 'Low battery detected. The AI is going easy on you.';
  }
  if (level < 0.2) {
    return 'Battery dying. Race faster.';
  }
  if (level > 0.9) {
    return 'Full charge. The AI expects your best.';
  }
  return '';
}
