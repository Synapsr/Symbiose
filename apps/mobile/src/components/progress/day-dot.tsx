import type { StreakDayState } from '@symbiose/shared';
import { Flame, Shield } from 'lucide-react-native';
import { View } from 'react-native';

import { useTheme } from '@/theme';

/** A day of the week: a lit flame, a rest day's shield, an empty ring, or today's dashed one waiting for its meal. Never red: a missed day is not a fault. */
export function DayDot({ state, size = 34 }: { state: StreakDayState; size?: number }) {
  const { colors } = useTheme();
  const base = { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' } as const;
  if (state === 'logged')
    return (
      <View style={[base, { backgroundColor: colors.warning }]}>
        <Flame size={size * 0.47} color="#FFFFFF" fill="#FFFFFF" />
      </View>
    );
  if (state === 'rest')
    return (
      <View style={[base, { backgroundColor: colors.accentSoft }]}>
        <Shield size={size * 0.44} color={colors.accentText} fill={colors.accentText} />
      </View>
    );
  if (state === 'open') return <View style={[base, { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.warning }]} />;
  return <View style={[base, { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2 }]} />;
}
