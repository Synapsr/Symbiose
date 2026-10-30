import type { DaySummary, Workout } from '@symbiose/shared';
import { Check, Dumbbell, Flame, Footprints, SportShoe, Watch, X } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { AnimatedNumber, Card, Pressy, Ring, Row, SwapIcon, Txt } from '@/components/ui';
import { WORKOUT_ICONS, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { useDeleteWorkout } from '@/lib/hooks';
import { useSettings } from '@/lib/stores';
import { useHiddenIds } from '@/lib/undo';
import { Radius, Space, useTheme } from '@/theme';

/**
 * Activité at a glance, at the top of its sheet: the week's active minutes
 * against the goal, the goal's extras (steps, strength), the energy spent and
 * the day's sessions. Nothing here is a zero waiting to be filled.
 */
export function ActivitySummary({ day }: { day: DaySummary }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const hideCalories = useSettings((s) => s.hideCalories);
  const hidden = useHiddenIds();
  const week = day.activityWeek;
  const { goals } = week;
  const steps = day.activity?.steps ?? null;
  // No session this week, but the steps are there: lead with what was done, not with a zero.
  const stepsFirst = week.activeMinutes === 0 && steps !== null;
  const progress = stepsFirst ? (goals.dailySteps ? steps / goals.dailySteps : 0) : goals.weeklyActiveMinutes > 0 ? week.activeMinutes / goals.weeklyActiveMinutes : 0;
  const reached = progress >= 1;
  const activeKcal = day.activity?.activeKcal ?? (day.energy.source === 'activity' ? day.energy.activeKcal : null);
  const workouts = day.workouts.filter((w) => !hidden[w.id]);

  return (
    <Card style={{ gap: Space.lg, padding: Space.lg }}>
      <Row gap={Space.md}>
        <Ring progress={progress} size={52} stroke={6} color={colors.accent}>
          <SwapIcon
            on={reached}
            onIcon={<Check size={20} color={colors.accent} strokeWidth={2.5} />}
            offIcon={stepsFirst ? <Footprints size={18} color={colors.accent} /> : <SportShoe size={18} color={colors.accent} />}
          />
        </Ring>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={5} style={{ alignItems: 'baseline' }}>
            <AnimatedNumber value={stepsFirst ? steps : week.activeMinutes} format={(n) => formatNumber(Math.round(n), locale)} variant="number" />
            <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {stepsFirst
                ? goals.dailySteps
                  ? t('today.moveStepsLead', { goal: formatNumber(goals.dailySteps, locale) })
                  : t('today.moveStepsLeadNoGoal')
                : t('today.moveWeek', { goal: formatNumber(goals.weeklyActiveMinutes, locale) })}
            </Txt>
          </Row>
          <Row gap={Space.md} style={{ flexWrap: 'wrap' }}>
            {steps !== null && !stepsFirst ? (
              <Row gap={4}>
                <Footprints size={13} color={goals.dailySteps && steps >= goals.dailySteps ? colors.accent : colors.text2} />
                <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                  {goals.dailySteps
                    ? t('today.moveSteps', { count: formatNumber(steps, locale), goal: formatNumber(goals.dailySteps, locale) })
                    : t('today.steps', { count: formatNumber(steps, locale) })}
                </Txt>
              </Row>
            ) : null}
            {goals.weeklyStrengthSessions !== null ? (
              <Row gap={4}>
                <Dumbbell size={13} color={week.strengthSessions >= goals.weeklyStrengthSessions ? colors.accent : colors.text2} />
                <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                  {t('today.moveStrength', { done: week.strengthSessions, goal: goals.weeklyStrengthSessions })}
                </Txt>
              </Row>
            ) : null}
            {activeKcal !== null && !hideCalories ? (
              <Row gap={4}>
                <Flame size={13} color={colors.warning} />
                <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                  {t('today.burnedKcal', { count: formatNumber(activeKcal, locale) })}
                </Txt>
              </Row>
            ) : null}
          </Row>
        </View>
      </Row>

      {workouts.length ? (
        <LayoutAnimationConfig skipEntering>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
            {workouts.map((workout) => (
              <Animated.View key={workout.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
                <SessionChip workout={workout} />
              </Animated.View>
            ))}
          </View>
        </LayoutAnimationConfig>
      ) : null}
    </Card>
  );
}

/** « Course · 32 min ». A session added by hand has its × (the twin of the long press on Today); the watch's are read-only. */
function SessionChip({ workout }: { workout: Workout }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const remove = useDeleteWorkout();
  const Icon = WORKOUT_ICONS[workout.type];
  const label = `${t(workoutTypeKey(workout.type))} · ${Math.round(workout.durationMin)} min`;
  const manual = workout.source === 'manual';
  return (
    <Row gap={6} style={{ height: 32, paddingLeft: 12, paddingRight: manual ? 4 : 12, borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
      <Icon size={14} color={colors.text} />
      <Txt variant="label" style={{ fontSize: 13 }}>
        {label}
      </Txt>
      {manual ? (
        <Pressy onPress={() => remove(workout)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${t('common.delete')} ${label}`} style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <X size={14} color={colors.text2} />
        </Pressy>
      ) : (
        <Watch size={12} color={colors.text3} accessibilityLabel={t('today.moveFromWatch')} />
      )}
    </Row>
  );
}
