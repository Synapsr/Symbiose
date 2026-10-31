import { addDays, type Craving, type JournalEntry, type Meal, type MoodCheckIn, type Workout } from '@symbiose/shared';
import { router, useFocusEffect } from 'expo-router';
import { Camera, ChevronRight, CloudOff, Flame } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanResponder, Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoachLine } from '@/components/coach/coach-line';
import { JournalRow } from '@/components/journal/journal-row';
import { CravingRow, WorkoutRow } from '@/components/today/day-rows';
import { EnergyCard, heroNutrient } from '@/components/today/energy-card';
import { MealCard, PendingMealCard } from '@/components/today/meal-card';
import { MoodEntry } from '@/components/today/mood-row';
import { QueuedMealCard } from '@/components/today/queued-meal-card';
import { StatusRow } from '@/components/today/status-row';
import { CAPTURE_SIZE, ThumbZone } from '@/components/today/thumb-zone';
import { WeekStrip } from '@/components/today/week-strip';
import { Card, Pressy, Reveal, Row, SectionTitle, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDay } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage, useDay, useHealthSync, useMealLogger, useToday } from '@/lib/hooks';
import { useJournal } from '@/lib/journal';
import { dropEntry, isNetworkError, retryEntry, useOutbox, type OutboxEntry } from '@/lib/outbox';
import { timeline, type TimelineRow } from '@/lib/outbox-logic';
import { useUser } from '@/lib/session';
import { usePending, useSettings, useToast } from '@/lib/stores';
import { useHiddenIds } from '@/lib/undo';
import { dayVoice, greeting } from '@/lib/voice';
import { Radius, Space, useTheme } from '@/theme';

/** Today opens many times a day: its entrance plays once per session, then it simply appears. */
let entrancePlayed = false;

type DayRow =
  | TimelineRow<Meal, OutboxEntry>
  | { type: 'note'; at: number; note: JournalEntry }
  | { type: 'workout'; at: number; workout: Workout }
  | { type: 'craving'; at: number; craving: Craving }
  | { type: 'mood'; at: number; mood: MoodCheckIn };

/**
 * Today: the status (coach line, hero, one row of modules), then the day's
 * timeline. Logging happens through the two thumb buttons: 📷 and « + ».
 */
export default function Today() {
  const { t, plural, locale, nutrient } = useI18n();
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const today = useToday();
  const [selected, setSelected] = useState(today);
  const date = selected > today ? today : selected;
  const isToday = date === today;
  const day = useDay(date);
  const notes = useJournal({ from: date, to: date }).data ?? [];
  const hideCalories = useSettings((s) => s.hideCalories);
  const hidden = useHiddenIds();
  const allPending = usePending((s) => s.items);
  const pending = allPending.filter((p) => p.input.localDate === date);
  // Captures waiting for the network (those still in their first attempt show as "analysing" above).
  const outbox = useOutbox((s) => s.items);
  const live = useOutbox((s) => s.live);
  const sending = useOutbox((s) => s.sending);
  const queued = outbox.filter((q) => q.localDate === date && !live.includes(q.id));
  const { retry, dismiss } = useMealLogger();
  const syncHealth = useHealthSync(today);
  const leftHanded = useSettings((s) => s.leftHanded);
  const showToast = useToast((s) => s.show);
  const setLift = useToast((s) => s.setLift);
  const [animate] = useState(() => !entrancePlayed);
  useEffect(() => {
    entrancePlayed = true;
  }, []);

  // The thumb buttons: the scroll ends far enough below them that nothing stays hidden underneath,
  // and toasts rise above them while Today is on screen.
  const thumbBottom = insets.bottom + (Platform.OS === 'web' ? 96 : Space.lg);
  useFocusEffect(
    useCallback(() => {
      setLift(thumbBottom + CAPTURE_SIZE + Space.md);
      return () => setLift(0);
    }, [setLift, thumbBottom]),
  );

  // The previous day stays on screen while the next one loads, never in its place when that load fails.
  const data = day.isPlaceholderData && day.error ? undefined : day.data;
  const hero = data ? heroNutrient(data, user.plan, hideCalories) : 'kcal';
  const name = user.profile?.name ?? user.name;

  // Horizontal swipe on the header moves between days.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_, g) => {
          const next = addDays(date, g.dx < 0 ? 1 : -1);
          if (next > today) return;
          haptics.tap();
          setSelected(next);
        },
      }),
    [date, today],
  );

  const dateLabel = formatDay(date, locale, { today: t('common.today'), yesterday: t('common.yesterday') });
  const meals = (data?.meals ?? []).filter((m) => !hidden[m.id]);
  const empty = Boolean(data && meals.length === 0 && pending.length === 0 && queued.length === 0);
  const offline = isNetworkError(day.error);
  // The mood shows once: in its pill when Humeur is on, otherwise here, in the day's story.
  const moodRow = user.profile?.trackMood === true ? null : (data?.mood ?? null);
  // Meals, captures waiting for the network, notes, sessions, cravings and the mood on one timeline, newest first.
  const rows: DayRow[] = [
    ...timeline(meals, queued),
    ...notes.filter((note) => !hidden[note.id]).map((note) => ({ type: 'note' as const, at: Date.parse(note.at), note })),
    ...(data?.workouts ?? []).filter((w) => !hidden[w.id]).map((workout) => ({ type: 'workout' as const, at: Date.parse(workout.startedAt), workout })),
    ...(data?.cravings.items ?? []).map((craving) => ({ type: 'craving' as const, at: Date.parse(craving.at), craving })),
    ...(moodRow ? [{ type: 'mood' as const, at: Date.parse(moodRow.at), mood: moodRow }] : []),
  ].sort((a, b) => b.at - a.at);
  const streak = data?.streak ?? 0;
  const streakLabel = plural('today.streakLabel', streak);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingBottom: thumbBottom + CAPTURE_SIZE + Space.xxl, paddingHorizontal: Space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        refreshControl={
          <RefreshControl
            refreshing={day.isRefetching && !day.isPlaceholderData}
            onRefresh={() => {
              void syncHealth(true);
              void day.refetch();
            }}
          />
        }>
        <View {...pan.panHandlers} style={{ gap: Space.lg }}>
          <Reveal index={0} instant={!animate} style={{ gap: Space.lg }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 4 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="overline" tone="secondary">
                  {new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                </Txt>
                <Txt variant="title" numberOfLines={2}>
                  {isToday ? greeting(t, name) : dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
                </Txt>
              </View>
              {streak > 0 ? (
                <Pressy
                  onPress={() => showToast({ message: streakLabel })}
                  accessibilityRole="button"
                  accessibilityLabel={streakLabel}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: Radius.pill, paddingHorizontal: Space.md, height: 34 }, elevation]}>
                  <Flame size={15} color={colors.warning} fill={colors.warning} />
                  <Txt variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                    {streak}
                  </Txt>
                </Pressy>
              ) : null}
            </Row>
            <WeekStrip selected={date} today={today} onSelect={setSelected} />
          </Reveal>

          <Reveal index={1} instant={!animate} style={{ gap: Space.md }}>
            {data ? (
              <>
                <CoachLine date={date} fallback={dayVoice(data, hero, t, nutrient, locale, !isToday)} />
                <View>
                  <EnergyCard day={data} plan={user.plan} hero={hero} hideCalories={hideCalories} />
                  {queued.length ? <WaitingNote count={queued.length} /> : null}
                </View>
                {/* Day 1, or a new morning: the invitation comes right under the hero. */}
                {empty && isToday ? <Invite date={date} /> : null}
                <StatusRow day={data} />
              </>
            ) : offline ? (
              // Without network the day can't load, but nothing is lost: say so calmly.
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <CloudOff size={20} color={colors.text2} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="label" style={{ fontSize: 16 }}>
                    {t('outbox.offlineTitle')}
                  </Txt>
                  <Txt variant="caption" tone="secondary">
                    {t('outbox.offlineBody')}
                  </Txt>
                </View>
              </Card>
            ) : day.error ? (
              <Card>
                <Txt tone="warning">{errorMessage(day.error, t('common.error'), t('common.offline'))}</Txt>
              </Card>
            ) : (
              <>
                <Skeleton width="70%" height={22} radius={Radius.sm} />
                <Skeleton width="100%" height={168} radius={Radius.xl} />
                <Skeleton width="100%" height={46} radius={Radius.pill} />
              </>
            )}
          </Reveal>
        </View>

        <Reveal index={2} instant={!animate}>
          {rows.length || pending.length ? (
            <>
              <SectionTitle
                right={
                  <Pressy hitSlop={8} onPress={() => router.push('/journal')} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Txt variant="label" tone="secondary">
                      {t('today.history')}
                    </Txt>
                    <ChevronRight size={16} color={colors.text2} />
                  </Pressy>
                }>
                {t('today.dayTitle')}
              </SectionTitle>
              <View style={{ gap: Space.sm }}>
                {pending.map((p) => (
                  <PendingMealCard key={p.id} pending={p} onRetry={() => void retry(p)} onDismiss={() => dismiss(p.id)} />
                ))}
                {rows.map((row) =>
                  row.type === 'meal' ? (
                    <MealCard key={row.meal.id} meal={row.meal} hideCalories={hideCalories} />
                  ) : row.type === 'note' ? (
                    <JournalRow key={row.note.id} entry={row.note} />
                  ) : row.type === 'workout' ? (
                    <WorkoutRow key={row.workout.id} workout={row.workout} hideCalories={hideCalories} />
                  ) : row.type === 'craving' ? (
                    <CravingRow key={row.craving.id} craving={row.craving} />
                  ) : row.type === 'mood' ? (
                    <MoodEntry key={`mood-${row.mood.localDate}`} mood={row.mood} variant="row" />
                  ) : (
                    <QueuedMealCard
                      key={row.entry.id}
                      entry={row.entry}
                      sending={sending === row.entry.id}
                      onRetry={() => retryEntry(row.entry.id)}
                      onDelete={() => void dropEntry(row.entry.id)}
                    />
                  ),
                )}
              </View>
            </>
          ) : null}
        </Reveal>
      </ScrollView>

      <ThumbZone date={date} bottom={thumbBottom} invite={empty && isToday} side={leftHanded ? 'left' : 'right'} />
    </View>
  );
}

/** The first photo of the day, asked for where the eye lands: right under the hero. */
function Invite({ date }: { date: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(260)} exiting={FadeOut.duration(180)}>
      <Pressy
        onPress={() => router.push({ pathname: '/capture', params: { date } })}
        accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: Space.lg, padding: Space.lg, borderRadius: Radius.xl, borderCurve: 'continuous', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.text3 }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.inverted, alignItems: 'center', justifyContent: 'center' }}>
          <Camera size={22} color={colors.onInverted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">{t('today.empty.title')}</Txt>
          <Txt variant="caption" tone="secondary">
            {t('today.empty.body')}
          </Txt>
        </View>
      </Pressy>
    </Animated.View>
  );
}

/** The totals only count meals the server confirmed: said quietly under the hero. */
function WaitingNote({ count }: { count: number }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(260)} exiting={FadeOut.duration(200)}>
      <Row gap={6} style={{ justifyContent: 'center', marginTop: Space.md }}>
        <CloudOff size={14} color={colors.text3} />
        <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {count === 1 ? t('outbox.pendingOne') : t('outbox.pendingMany', { count })}
        </Txt>
      </Row>
    </Animated.View>
  );
}
