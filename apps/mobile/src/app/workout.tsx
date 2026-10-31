import { estimateWorkoutKcal, toLocalDate, toLocalDateTime, type WorkoutIntensity, type WorkoutType } from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Flame, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivitySummary } from '@/components/today/activity-summary';
import { AnimatedNumber, Button, Chip, IconButton, Reveal, Row, Segmented, Txt } from '@/components/ui';
import { intensityKey, WORKOUT_ICONS, WORKOUT_INTENSITIES, WORKOUT_TYPES, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatDay, formatNumber } from '@/lib/format';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { errorMessage, useDay, useRefreshAfterWorkout } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useApi, useUser } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

const PRESETS = [15, 30, 45, 60];
const MIN = 5;
const MAX = 300;

/** Add a session by hand: type, duration, done. Intensity and the energy estimate are there when they matter. */
export default function WorkoutSheet() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const refresh = useRefreshAfterWorkout();
  const showToast = useToast((s) => s.show);
  const hideCalories = useSettings((s) => s.hideCalories);
  const params = useLocalSearchParams<{ date?: string }>();

  const today = toLocalDate();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date < today ? params.date : today;
  // The day's summary is usually already cached by Today.
  const day = useDay(date).data;
  const summary = day?.date === date ? day : null;
  const [type, setType] = useState<WorkoutType | null>(null);
  const [duration, setDuration] = useState(30);
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');

  const kcal = type ? estimateWorkoutKcal(type, intensity, duration, user.profile?.weightKg ?? 70) : 0;
  const label = type ? `${t(workoutTypeKey(type))} · ${duration} min` : '';

  const add = useMutation({
    mutationFn: () => {
      // Ends now (or at this time of day, for a past day), without spilling into the day before.
      const now = new Date();
      const [y, m, d] = date.split('-').map(Number) as [number, number, number];
      const midnight = new Date(y, m - 1, d);
      const end = date === today ? now : new Date(y, m - 1, d, now.getHours(), now.getMinutes());
      const start = new Date(Math.max(midnight.getTime(), end.getTime() - duration * 60_000));
      return api.createWorkout({
        externalId: null,
        type: type!,
        startedAt: toLocalDateTime(start),
        localDate: date,
        durationMin: duration,
        intensity,
        activeKcal: null,
        distanceKm: null,
        avgHeartRate: null,
        source: 'manual',
      });
    },
    onSuccess: (workout) => {
      feedback.workoutLogged();
      refresh();
      showToast({
        message: `${t('workout.added')} · ${label}`,
        action: { label: t('today.undo'), onPress: () => void api.deleteWorkout(workout.id).then(refresh) },
      });
      dismiss();
    },
    onError: () => haptics.warning(),
  });

  const step = (delta: number) => setDuration((d) => Math.min(MAX, Math.max(MIN, d + delta)));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.xl }}>
      <Reveal index={0} style={{ gap: Space.sm }}>
        <Txt variant="title">{t('today.move')}</Txt>
        <Txt tone="secondary">
          {date === today ? t('workout.subtitle') : capitalize(formatDay(date, locale, { today: t('common.today'), yesterday: t('common.yesterday') }))}
        </Txt>
      </Reveal>

      {/* The week first (it's what the Activité pill opened), then a session to add. */}
      {summary ? (
        <Reveal index={0}>
          <ActivitySummary day={summary} />
        </Reveal>
      ) : null}

      <Reveal index={1} style={{ gap: Space.md }}>
        <Txt variant="heading">{t('workout.title')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
          {WORKOUT_TYPES.map((key) => {
            const Icon = WORKOUT_ICONS[key];
            const selected = type === key;
            return (
              <Chip key={key} label={t(workoutTypeKey(key))} selected={selected} onPress={() => setType(key)} icon={<Icon size={16} color={selected ? colors.onInverted : colors.text} />} />
            );
          })}
        </View>
      </Reveal>

      <Reveal index={2} style={{ gap: Space.md }}>
        <Txt variant="caption" tone="secondary">
          {t('workout.duration')}
        </Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton label={t('workout.less')} size={48} icon={<Minus size={20} color={colors.text} />} onPress={() => step(-5)} />
          <Row gap={6} style={{ alignItems: 'baseline' }}>
            <AnimatedNumber value={duration} format={(n) => String(Math.round(n))} variant="display" />
            <Txt tone="secondary">min</Txt>
          </Row>
          <IconButton label={t('workout.more')} size={48} icon={<Plus size={20} color={colors.text} />} onPress={() => step(5)} />
        </Row>
        <Row gap={Space.sm} style={{ justifyContent: 'center' }}>
          {PRESETS.map((minutes) => (
            <Chip key={minutes} label={`${minutes} min`} selected={duration === minutes} onPress={() => setDuration(minutes)} />
          ))}
        </Row>
      </Reveal>

      <Reveal index={3} style={{ gap: Space.sm }}>
        <Txt variant="caption" tone="secondary">
          {t('workout.intensity')}
        </Txt>
        <Segmented value={intensity} onChange={setIntensity} options={WORKOUT_INTENSITIES.map((value) => ({ value, label: t(intensityKey(value)) }))} />
      </Reveal>

      <Reveal index={4} style={{ gap: Space.md }}>
        {!hideCalories ? (
          // Space is kept before a type is picked, so nothing jumps when the estimate appears.
          <Row gap={6} style={{ alignItems: 'baseline', opacity: type ? 1 : 0 }} accessibilityElementsHidden={!type}>
            <View style={{ alignSelf: 'center' }}>
              <Flame size={16} color={colors.warning} />
            </View>
            <Txt variant="number">≈</Txt>
            <AnimatedNumber value={kcal} format={(n) => formatNumber(Math.round(n), locale)} variant="number" />
            <Txt variant="caption" tone="secondary">
              {t('workout.estimate')}
            </Txt>
          </Row>
        ) : null}
        {add.error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(add.error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
        <Button title={t('workout.add')} onPress={() => add.mutate()} disabled={!type} loading={add.isPending} />
      </Reveal>
    </ScrollView>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
