import Svg, { Circle, Path } from 'react-native-svg';

import type { TranslationKey } from '@/i18n';
import type { Palette } from '@/theme';

export const MOOD_LEVELS = [1, 2, 3, 4, 5] as const;

/** Calm hues from a quiet blue to the accent: a low mood is never painted red. */
const HUES = ['#8395C9', '#A08FD0', '#C4A56E', '#6CBA88'];

export function moodColor(mood: number, colors: Palette): string {
  return mood >= 5 ? colors.accent : (HUES[Math.max(0, Math.round(mood) - 1)] ?? colors.text2);
}

export const moodLabel = (mood: number) => `mood.${Math.min(5, Math.max(1, Math.round(mood)))}` as TranslationKey;

/** How much the mouth bends, from a frown (1) to a wide smile (5). */
const CURVE = [-0.13, -0.06, 0, 0.08, 0.15];

/** A hand-drawn face: one stroke, two eyes, a mouth that smiles more with each level. */
export function MoodFace({ mood, size = 36, color, filled = false, fillOpacity = 0.18 }: { mood: number; size?: number; color: string; filled?: boolean; fillOpacity?: number }) {
  const s = size;
  const stroke = Math.max(1.6, s * 0.06);
  const level = Math.min(5, Math.max(1, Math.round(mood)));
  const curve = CURVE[level - 1]!;
  const y = s * (0.66 - curve / 3);
  const mouth = `M${s * 0.32},${y} Q${s / 2},${y + curve * s * 2} ${s * 0.68},${y}`;
  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <Circle cx={s / 2} cy={s / 2} r={s / 2 - stroke / 2} fill={filled ? color : 'none'} fillOpacity={fillOpacity} stroke={color} strokeWidth={stroke} />
      <Circle cx={s * 0.37} cy={s * 0.42} r={s * 0.05} fill={color} />
      <Circle cx={s * 0.63} cy={s * 0.42} r={s * 0.05} fill={color} />
      {/* The best days laugh: an open mouth. */}
      <Path d={level === 5 ? `${mouth} Z` : mouth} fill={level === 5 ? color : 'none'} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
