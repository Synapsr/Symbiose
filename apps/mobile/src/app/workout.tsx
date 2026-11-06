import { countsSteps, estimateWorkoutKcal, minutesFromSteps, toLocalDate, toLocalDateTime, type WorkoutIntensity, type WorkoutType } from '@symbiose/shared';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Flame, Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivitySummary } from '@/components/today/activity-summary';
import { AnimatedNumber, Button, Chip, IconButton, Pressy, Reveal, Row, Segmented, Txt, webInput } from '@/components/ui';
import { intensityKey, WORKOUT_ICONS, WORKOUT_INTENSITIES, WORKOUT_TYPES, workoutTypeKey } from '@/components/workout-meta';
import { useI18n } from '@/i18n';
import { formatDay, formatNumber } from '@/lib/format';
import { feedback } from '@/lib/feedback';
import { haptics } from '@/lib/haptics';
import { errorMessage, useDay, useRefreshAfterWorkout } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useApi, useUser } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { Fonts, Space, useTheme } from '@/theme';

const PRESETS = [15, 30, 45, 60];
const MIN = 5;
const MAX = 300;
const DEFAULT_MINUTES = 30;
// A walk or a run can be counted in steps, instead of the minutes or as well.
const STEP_PRESETS = [2000, 5000, 8000, 10_000];
const DEFAULT_STEPS = 5000;
const STEP = 500;
const MIN_STEPS = 100;
const MAX_STEPS = 100_000;

type Measure = 'time' | 'steps';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** The next round value in that direction: 62 min → 65 or 60, 6 237 steps → 6 500 or 6 000. */
const nudge = (value: number, unit: number, direction: 1 | -1) => (direction > 0 ? Math.floor(value / unit) + 1 : Math.ceil(value / unit) - 1) * unit;

/**
 * Add a session by hand: type, duration, done. Intensity and the energy estimate are there when they matter.
 * A walk or a run can be counted in steps too (« Durée | Pas »): a duration not given is then estimated from them.
 */
export default function WorkoutSheet() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const refresh = useRefreshAfterWorkout();
  const showToast = useToast((s) => s.show);
  const hideCalories = useSettings((s) => s.hideCalories);
  const inSteps = useSettings((s) => s.workoutInSteps);
  const setSettings = useSettings((s) => s.set);
  const params = useLocalSearchParams<{ date?: string }>();

  const today = toLocalDate();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date < today ? params.date : today;
  // The day's summary is usually already cached by Today.
  const day = useDay(date).data;
  const summary = day?.date === date ? day : null;
  const [type, setType] = useState<WorkoutType | null>(null);
  const [intensity, setIntensity] = useState<WorkoutIntensity>('moderate');
  // Minutes and steps are the person's once they set them (null until then), whichever the big number shows.
  const [minutes, setMinutes] = useState<number | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [chosenMeasure, setChosenMeasure] = useState<Measure | null>(null);

  const stepsAllowed = type !== null && countsSteps(type);
  // Until the toggle is touched, a walk opens the way it was last added.
  const measure: Measure = stepsAllowed ? (chosenMeasure ?? (inSteps.includes(type) ? 'steps' : 'time')) : 'time';
  const inStepsNow = measure === 'steps';
  const shownSteps = steps ?? DEFAULT_STEPS;
  // Steps go with the session while they're on screen, or once set before going back to the minutes.
  const loggedSteps = stepsAllowed && (inStepsNow || steps !== null) ? shownSteps : null;
  const estimated = type && loggedSteps !== null ? minutesFromSteps(type, intensity, loggedSteps) : null;
  const duration = minutes ?? estimated ?? DEFAULT_MINUTES;
  const durationGiven = !inStepsNow || minutes !== null;

  const kcal = type ? estimateWorkoutKcal(type, intensity, duration, user.profile?.weightKg ?? 70) : 0;
  const stepsText = loggedSteps === null ? null : t('today.steps', { count: formatNumber(loggedSteps, locale) });
  // « Marche · 6 200 pas », with the duration when the person gave it.
  const label = type ? [t(workoutTypeKey(type)), durationGiven ? `${duration} min` : null, stepsText].filter(Boolean).join(' · ') : '';
  const note = !stepsAllowed ? null : inStepsNow ? (minutes !== null ? `${minutes} min` : `≈ ${duration} min`) : stepsText;

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
        steps: loggedSteps,
        source: 'manual',
      });
    },
    onSuccess: (workout) => {
      feedback.workoutLogged();
      refresh();
      if (stepsAllowed) {
        const others = inSteps.filter((kind) => kind !== type);
        setSettings({ workoutInSteps: inStepsNow ? [...others, type] : others });
      }
      showToast({
        message: `${t('workout.added')} · ${label}`,
        action: { label: t('today.undo'), onPress: () => void api.deleteWorkout(workout.id).then(refresh) },
      });
      dismiss();
    },
    onError: () => haptics.warning(),
  });

  const step = (direction: 1 | -1) => {
    if (inStepsNow) setSteps(clamp(nudge(shownSteps, STEP, direction), MIN_STEPS, MAX_STEPS));
    else setMinutes(clamp(nudge(duration, 5, direction), MIN, MAX));
  };

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
        {stepsAllowed ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Segmented
              value={measure}
              onChange={setChosenMeasure}
              options={[
                { value: 'time', label: t('workout.duration') },
                { value: 'steps', label: t('workout.steps') },
              ]}
            />
            {/* Beside the toggle, the other measure: « ≈ 62 min » from the steps, or the one the person set. */}
            {note ? (
              <Txt
                variant="label"
                tone="secondary"
                accessibilityLabel={inStepsNow && minutes === null ? t('workout.aboutMinutes', { count: duration }) : undefined}
                style={{ fontVariant: ['tabular-nums'] }}>
                {note}
              </Txt>
            ) : null}
          </Row>
        ) : (
          <Txt variant="caption" tone="secondary">
            {t('workout.duration')}
          </Txt>
        )}
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton label={inStepsNow ? t('workout.lessSteps') : t('workout.less')} size={48} icon={<Minus size={20} color={colors.text} />} onPress={() => step(-1)} />
          {inStepsNow ? (
            <StepCount value={shownSteps} onChange={(count) => setSteps(clamp(count, MIN_STEPS, MAX_STEPS))} />
          ) : (
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <AnimatedNumber value={duration} format={(n) => String(Math.round(n))} variant="display" />
              <Txt tone="secondary">min</Txt>
            </Row>
          )}
          <IconButton label={inStepsNow ? t('workout.moreSteps') : t('workout.more')} size={48} icon={<Plus size={20} color={colors.text} />} onPress={() => step(1)} />
        </Row>
        <Row gap={Space.sm} style={{ justifyContent: 'center' }}>
          {inStepsNow
            ? STEP_PRESETS.map((count) => (
                <Chip
                  key={count}
                  label={formatNumber(count, locale)}
                  accessibilityLabel={t('today.steps', { count: formatNumber(count, locale) })}
                  selected={shownSteps === count}
                  onPress={() => setSteps(count)}
                />
              ))
            : PRESETS.map((preset) => <Chip key={preset} label={`${preset} min`} selected={duration === preset} onPress={() => setMinutes(preset)} />)}
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

/** The step count: the steppers and presets give a round number, a tap types the one the phone shows (6 237). */
function StepCount({ value, onChange }: { value: number; onChange: (steps: number) => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  // The digits being typed; null while the number is shown.
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <Row gap={6} style={{ alignItems: 'baseline' }}>
      {typing === null ? (
        <Pressy
          onPress={() => setTyping(String(value))}
          accessibilityRole="button"
          accessibilityLabel={t('today.steps', { count: formatNumber(value, locale) })}
          accessibilityHint={t('workout.typeSteps')}>
          <AnimatedNumber value={value} format={(n) => formatNumber(Math.round(n), locale)} variant="display" />
        </Pressy>
      ) : (
        <TextInput
          autoFocus
          value={typing}
          onChangeText={(text) => {
            const digits = text.replace(/\D/g, '').slice(0, 6);
            setTyping(digits);
            if (digits) onChange(Number(digits));
          }}
          onBlur={() => setTyping(null)}
          keyboardType="number-pad"
          selectTextOnFocus
          accessibilityLabel={t('workout.steps')}
          style={[{ minWidth: 64, padding: 0, fontSize: 48, fontFamily: Fonts.display, letterSpacing: -1.2, color: colors.text, textAlign: 'right', fontVariant: ['tabular-nums'] }, webInput]}
        />
      )}
      <Txt tone="secondary">{t('workout.stepsUnit')}</Txt>
    </Row>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
