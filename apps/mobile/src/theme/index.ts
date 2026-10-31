import type { NutrientKey, Verdict } from '@symbiose/shared';
import { Platform, useColorScheme } from 'react-native';

const light = {
  bg: '#F5F4F0',
  surface: '#FFFFFF',
  surface2: '#EDECE7',
  text: '#111111',
  text2: '#6E6E73',
  text3: '#A1A1A6',
  border: 'rgba(0,0,0,0.07)',
  /** What is alive: progress, rings, focus, success. Plain actions use the ink (`inverted`). */
  accent: '#0F7663',
  /** Accent-coloured text and small glyphs. The same value as `accent`, which passes AA on every surface. */
  accentText: '#0F7663',
  accentSoft: '#E6F2EE',
  /** Text and icons on an accent background. */
  onAccent: '#FFFFFF',
  warning: '#E8890C',
  warningSoft: '#FCEFD9',
  danger: '#E5484D',
  inverted: '#111111',
  onInverted: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.4)',
};

const dark: typeof light = {
  bg: '#0A0A0B',
  surface: '#161618',
  surface2: '#222225',
  text: '#F5F5F3',
  text2: '#9A9AA0',
  text3: '#5F5F66',
  border: 'rgba(255,255,255,0.08)',
  accent: '#5FD6B4',
  accentText: '#5FD6B4',
  accentSoft: '#122C27',
  onAccent: '#0A0A0B',
  warning: '#FFB224',
  warningSoft: '#3A2A0E',
  danger: '#FF6369',
  inverted: '#F5F5F3',
  onInverted: '#0A0A0B',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Palette = typeof light;

/** The night palette whatever the scheme, for surfaces that are always dark (the camera). */
export const NIGHT: Palette = dark;

/** One color per nutrient, used consistently in rings, bars and chips. */
export const NUTRIENT_COLORS: Record<NutrientKey, string> = {
  kcal: '#139478',
  protein: '#FF7A59',
  carbs: '#F2B23A',
  fat: '#4F8EF7',
  sugar: '#EC5FA0',
  addedSugar: '#D23C86',
  satFat: '#7C9FD8',
  fiber: '#3FB27F',
  sodium: '#9B7CF4',
};

/** The opt-in life modules. Mood colours live with the faces (`mood-face.tsx`). */
export const LIFE_COLORS = {
  water: '#3E9FE0',
  sleep: '#7482D9',
};

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const Radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const Fonts = {
  /** Fraunces: a soft, organic serif that gives titles and big numbers their character. */
  display: 'Fraunces_700Bold',
  title: 'Fraunces_600SemiBold',
  accent: 'Fraunces_400Regular_Italic',
  /** Friendly rounded digits for small numbers (SF Pro Rounded on iOS). */
  rounded: Platform.select({ ios: 'ui-rounded', web: 'ui-rounded, system-ui, sans-serif', default: undefined }),
};

/** Motion tokens: one spring for touch, one curve for data. */
export const Motion = {
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  settle: { damping: 16, stiffness: 160, mass: 0.9 },
  dataDuration: 900,
  stagger: 70,
} as const;

export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = scheme === 'dark' ? dark : light;
  // Soft layered shadows in light mode; a hairline in dark mode where shadows vanish.
  const elevation =
    scheme === 'dark'
      ? { borderWidth: 1, borderColor: colors.border }
      : { boxShadow: '0 1px 2px rgba(17,17,17,0.04), 0 6px 20px rgba(17,17,17,0.05)' };
  const imageOutline = { borderWidth: 1, borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' };
  return { scheme, colors, elevation, imageOutline };
}

export function verdictColor(verdict: Verdict, colors: Palette): string {
  switch (verdict) {
    case 'great':
      return colors.accent;
    case 'good':
      return '#7CC48B';
    case 'ok':
      return colors.text3;
    case 'watch':
      return colors.warning;
  }
}
