import { localTime, type Craving, type Workout } from '@symbiose/shared';
import { router } from 'expo-router';
import { Sparkles, Watch } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Pressy, Row, Txt } from '@/components/ui';
import { intensityKey, WORKOUT_ICONS, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { useDeleteWorkout } from '@/lib/hooks';
import { Radius, Space, useTheme } from '@/theme';

const PAD = Space.md;
// Concentric radii, like the meal cards: the bubble's corner follows the card's corner minus the padding.
const BUBBLE_RADIUS = Radius.lg - PAD;

/** The notes' row shape: flatter than a meal, so meals stay the main thing. */
function SmallRow({ bubble, title, detail, time, label, onPress, onLongPress, hint }: { bubble: ReactNode; title: string; detail?: ReactNode; time: string; label: string; onPress?: () => void; onLongPress?: () => void; hint?: string }) {
  const { colors } = useTheme();
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Space.md, paddingVertical: 10, paddingHorizontal: PAD, backgroundColor: colors.surface, borderRadius: Radius.lg, borderCurve: 'continuous' as const };
  const content = (
    <>
      {bubble}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="label" numberOfLines={1} style={{ fontSize: 15 }}>
          {title}
        </Txt>
        {detail}
      </View>
      <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
        {time}
      </Txt>
    </>
  );
  return (
    <Animated.View entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(250)}>
      {onPress ? (
        <Pressy onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} style={style}>
          {content}
        </Pressy>
      ) : (
        <View accessible accessibilityLabel={label} style={style}>
          {content}
        </View>
      )}
    </Animated.View>
  );
}

function Bubble({ children, tint }: { children: ReactNode; tint: string }) {
  return <View style={{ width: 36, height: 36, borderRadius: BUBBLE_RADIUS, borderCurve: 'continuous', backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

/** « Course · 32 min ». Tap: the Activité sheet. A session added by hand also leaves from there, or with a long press. */
export function WorkoutRow({ workout, hideCalories }: { workout: Workout; hideCalories: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const remove = useDeleteWorkout();
  const Icon = WORKOUT_ICONS[workout.type];
  const manual = workout.source === 'manual';
  const title = `${t(workoutTypeKey(workout.type))} · ${Math.round(workout.durationMin)} min`;
  const kcal = workout.activeKcal !== null && !hideCalories ? `${formatNumber(workout.activeKcal, locale)} kcal` : null;
  const detail = [manual ? (workout.intensity ? t(intensityKey(workout.intensity)) : null) : t('today.moveFromWatch'), kcal].filter(Boolean).join(' · ');
  return (
    <SmallRow
      bubble={
        <Bubble tint={colors.accentSoft}>
          <Icon size={17} color={colors.accent} />
        </Bubble>
      }
      title={title}
      detail={
        detail ? (
          <Row gap={4}>
            {!manual ? <Watch size={11} color={colors.text3} /> : null}
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {detail}
            </Txt>
          </Row>
        ) : null
      }
      time={localTime(workout.startedAt)}
      label={`${title}, ${localTime(workout.startedAt)}`}
      onPress={() => router.push({ pathname: '/workout', params: { date: workout.localDate } })}
      onLongPress={manual ? () => remove(workout) : undefined}
      hint={manual ? t('today.moveDelete') : undefined}
    />
  );
}

/** « Envie surmontée · chocolat »: the craving flow's outcome, in the day's story. */
export function CravingRow({ craving }: { craving: Craving }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const key = craving.outcome === 'resisted' ? 'today.cravingRow.resisted' : craving.outcome === 'gave_in' ? 'today.cravingRow.gaveIn' : 'today.cravingRow.pending';
  const title = t(key, { what: craving.what.toLowerCase() });
  return (
    <SmallRow
      bubble={
        <Bubble tint={craving.outcome === 'resisted' ? colors.accentSoft : colors.surface2}>
          <Sparkles size={16} color={craving.outcome === 'resisted' ? colors.accent : colors.text2} />
        </Bubble>
      }
      title={title}
      time={localTime(craving.at)}
      label={`${title}, ${localTime(craving.at)}`}
    />
  );
}
