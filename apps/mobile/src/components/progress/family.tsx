import type { MilestoneFamily } from '@symbiose/shared';
import { CalendarCheck, Flame, Sparkles } from 'lucide-react-native';

import type { Palette } from '@/theme';

/** Each family's colour: the flame's warmth, the plan's green, the craving's violet. */
export function familyColor(family: MilestoneFamily, colors: Palette): string {
  return { streak: colors.warning, days: colors.accent, cravings: '#8E7CF0' }[family];
}

/** Each family's glyph, the same in the app and on the shared card (`share-card.tsx`). */
export function FamilyIcon({ family, size = 18, color, filled = false }: { family: MilestoneFamily; size?: number; color: string; filled?: boolean }) {
  if (family === 'streak') return <Flame size={size} color={color} fill={filled ? color : 'transparent'} />;
  if (family === 'days') return <CalendarCheck size={size} color={color} />;
  return <Sparkles size={size} color={color} fill={filled ? color : 'transparent'} />;
}
