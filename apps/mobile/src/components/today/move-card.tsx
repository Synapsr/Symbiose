import type { DaySummary, Workout } from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, Dumbbell, Footprints, Plus, SportShoe, Watch } from 'lucide-react-native';
import { Alert, Platform, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { AnimatedNumber, Card, IconButton, Pressy, Ring, Row, SwapIcon, Txt } from '@/components/ui';
import { WORKOUT_ICONS, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useRefreshAfterWorkout } from '@/lib/hooks';
import { useApi } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { Radius, Space, useTheme } from '@/theme';

/** Movement at a glance: the week's active minutes, the goal's extras (steps, strength) and the day's sessions. */
export function MoveCard({ day, isToday }: { day: DaySummary; isToday: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const week = day.activityWeek;
  const { goals } = week;
  const steps = day.activity?.steps ?? null;
  const leftHanded = useSettings((s) => s.leftHanded);
  // No session this week, but the steps are there: lead with what was done, not with a zero.
  const stepsFirst = week.activeMinutes === 0 && steps !== null;
  const progress = stepsFirst
    ? goals.dailySteps
      ? steps / goals.dailySteps
      : 0
    : goals.weeklyActiveMinutes > 0
      ? week.activeMinutes / goals.weeklyActiveMinutes
      : 0;
  const reached = progress >= 1;

  return (
    <Card style={{ gap: Space.lg }}>
      <Row gap={Space.md} style={leftHanded ? { flexDirection: 'row-reverse' } : null}>
        <Ring progress={progress} size={52} stroke={6} color={colors.accent}>
          <SwapIcon
            on={reached}
            onIcon={<Check size={20} color={colors.accent} strokeWidth={2.5} />}
            offIcon={stepsFirst ? <Footprints size={18} color={colors.accent} /> : <SportShoe size={18} color={colors.accent} />}
          />
        </Ring>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="overline" tone="secondary">
            {t('today.move')}
          </Txt>
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
        </View>
        <IconButton
          label={t('workout.title')}
          size={40}
          icon={<Plus size={20} color={colors.text} />}
          onPress={() => router.push({ pathname: '/workout', params: { date: day.date } })}
        />
      </Row>

      {(steps !== null && !stepsFirst) || goals.weeklyStrengthSessions !== null ? (
        <Row gap={Space.lg} style={{ flexWrap: 'wrap' }}>
          {steps !== null && !stepsFirst ? (
            <Row gap={5}>
              <Footprints size={14} color={goals.dailySteps && steps >= goals.dailySteps ? colors.accent : colors.text2} />
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {goals.dailySteps
                  ? t('today.moveSteps', { count: formatNumber(steps, locale), goal: formatNumber(goals.dailySteps, locale) })
                  : t('today.steps', { count: formatNumber(steps, locale) })}
              </Txt>
            </Row>
          ) : null}
          {goals.weeklyStrengthSessions !== null ? (
            <Row gap={5}>
              <Dumbbell size={14} color={week.strengthSessions >= goals.weeklyStrengthSessions ? colors.accent : colors.text2} />
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {t('today.moveStrength', { done: week.strengthSessions, goal: goals.weeklyStrengthSessions })}
              </Txt>
            </Row>
          ) : null}
        </Row>
      ) : null}

      {day.workouts.length ? (
        <LayoutAnimationConfig skipEntering>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
            {day.workouts.map((workout) => (
              <Animated.View key={workout.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)}>
                <SessionChip workout={workout} />
              </Animated.View>
            ))}
          </View>
        </LayoutAnimationConfig>
      ) : (
        <Txt variant="caption" tone="tertiary">
          {isToday ? t('today.moveEmpty') : t('today.moveEmptyPast')}
        </Txt>
      )}
    </Card>
  );
}

/** « Course · 32 min ». Sessions added by hand can be deleted with a long press; the watch's are read-only. */
function SessionChip({ workout }: { workout: Workout }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshAfterWorkout();
  const remove = useMutation({
    mutationFn: () => api.deleteWorkout(workout.id),
    onSuccess: () => {
      haptics.success();
      refresh();
    },
    onError: () => haptics.warning(),
  });

  const Icon = WORKOUT_ICONS[workout.type];
  const label = `${t(workoutTypeKey(workout.type))} · ${Math.round(workout.durationMin)} min`;
  const manual = workout.source === 'manual';

  const confirmDelete = () => {
    haptics.impact();
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(`${t('today.moveDelete')}\n${t('today.moveDeleteBody', { label })}`)) remove.mutate();
      return;
    }
    Alert.alert(t('today.moveDelete'), t('today.moveDeleteBody', { label }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  };

  const content = (
    <>
      <Icon size={14} color={colors.text} />
      <Txt variant="label" style={{ fontSize: 13 }}>
        {label}
      </Txt>
      {!manual ? <Watch size={12} color={colors.text3} accessibilityLabel={t('today.moveFromWatch')} /> : null}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, height: 32, paddingHorizontal: 12, borderRadius: Radius.pill, backgroundColor: colors.surface2 };

  if (!manual) return <View style={style}>{content}</View>;
  return (
    <Pressy haptic={false} hitSlop={4} delayLongPress={350} onLongPress={confirmDelete} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t('today.moveDelete')} style={[style, remove.isPending ? { opacity: 0.5 } : null]}>
      {content}
    </Pressy>
  );
}
