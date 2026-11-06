import type { DaySummary } from '@symbiose/shared';
import { router } from 'expo-router';
import { Flame } from 'lucide-react-native';
import Animated, { LayoutAnimationConfig, ZoomIn } from 'react-native-reanimated';

import { Pressy, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useProgress } from '@/lib/progress';
import { useSettings, useToast } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/**
 * The flame on Today: the streak, lit once today counts, an outline while it
 * still waits for today's meal. A tap opens « Ta progression ». Hidden when
 * « Séries et étapes » is off, and until there is something to show.
 */
export function StreakPill({ day }: { day: DaySummary | undefined }) {
  const { t, plural } = useI18n();
  const { colors, elevation } = useTheme();
  const on = useSettings((s) => s.motivation);
  const showToast = useToast((s) => s.show);
  const progress = useProgress();
  const summary = progress.data;
  // An older server has no « Ta progression »: the day's own streak, as before.
  const count = summary?.streak.current ?? day?.streak ?? 0;
  const lit = summary ? summary.streak.todayLogged : Boolean(day?.meals.length);
  const known = Boolean(summary && (summary.streak.best > 0 || summary.reached.length > 0));

  if (!on || (count === 0 && !known)) return null;
  const label = lit || count === 0 ? plural('today.streakLabel', count) : `${plural('today.streakLabel', count)}, ${t('progress.notYetToday')}`;
  const color = count > 0 ? colors.warning : colors.text3;

  return (
    <Pressy
      onPress={() => (progress.error ? showToast({ message: label }) : router.push('/progress'))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('progress.open')}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: Radius.pill, paddingHorizontal: Space.md, height: 34 }, elevation]}>
      {/* The flame lights up with today's first meal: a small pop (never on the way in, only when it changes). */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={lit ? 'lit' : 'waiting'} entering={ZoomIn.springify().damping(10)}>
          <Flame size={15} color={color} fill={lit ? color : 'transparent'} />
        </Animated.View>
      </LayoutAnimationConfig>
      <Txt variant="label" style={{ fontVariant: ['tabular-nums'] }}>
        {count}
      </Txt>
    </Pressy>
  );
}
