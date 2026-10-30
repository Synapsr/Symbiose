import files from 'virtual:screens';

export type ScreenName =
  | 'welcome'
  | 'onboarding-goals'
  | 'plan'
  | 'today'
  | 'capture-text'
  | 'meal'
  | 'craving'
  | 'insights-sources'
  | 'insights-weight'
  | 'coach';

export type Theme = 'light' | 'dark';

const available = new Set(files);

/**
 * Best file for a screen in a given theme: the new webp screens first, then the
 * older copies from docs/screenshots, preferring the requested theme. Returns
 * null when no candidate exists so the caller can render a fallback instead.
 */
export function screenSrc(names: ScreenName | ScreenName[], theme: Theme): string | null {
  const other: Theme = theme === 'light' ? 'dark' : 'light';
  for (const name of Array.isArray(names) ? names : [names]) {
    const candidates = [
      `/screens/${name}-${theme}.webp`,
      `/screens-fallback/${name}-${theme}.webp`,
      `/screens/${name}-${other}.webp`,
      `/screens-fallback/${name}-${other}.webp`,
    ];
    const found = candidates.find((candidate) => available.has(candidate));
    if (found) return found;
  }
  return null;
}

export function hasScreen(names: ScreenName | ScreenName[]): boolean {
  return screenSrc(names, 'light') !== null;
}
