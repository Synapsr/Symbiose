import { addDays } from '@symbiose/shared';
import { router } from 'expo-router';
import { Camera, Flame, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { PanResponder, Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EnergyCard, heroNutrient, NutrientBars } from '@/components/today/energy-card';
import { MealCard, PendingMealCard } from '@/components/today/meal-card';
import { WeekStrip } from '@/components/today/week-strip';
import { Card, Pressy, Reveal, Row, SectionTitle, Skeleton, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDay } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage, useDay, useHealthSync, useMealLogger, useToday } from '@/lib/hooks';
import { useUser } from '@/lib/session';
import { usePending, useSettings } from '@/lib/stores';
import { dayVoice, greeting } from '@/lib/voice';
import { Radius, Space, useTheme } from '@/theme';

export default function Today() {
  const { t, locale, nutrient } = useI18n();
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const today = useToday();
  const [selected, setSelected] = useState(today);
  const date = selected > today ? today : selected;
  const day = useDay(date);
  const hideCalories = useSettings((s) => s.hideCalories);
  const allPending = usePending((s) => s.items);
  const pending = allPending.filter((p) => p.input.localDate === date);
  const { retry, dismiss } = useMealLogger();
  const syncHealth = useHealthSync(today);

  const showCraving = Boolean(user.plan?.rules.some((r) => r.kind === 'max')) && date === today;
  const hero = day.data ? heroNutrient(day.data, user.plan, hideCalories) : 'kcal';
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
  const empty = Boolean(day.data && day.data.meals.length === 0 && pending.length === 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.md, paddingBottom: insets.bottom + (Platform.OS === 'web' ? 130 : 120), paddingHorizontal: Space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
        refreshControl={
          <RefreshControl
            refreshing={day.isRefetching}
            onRefresh={() => {
              void syncHealth(true);
              void day.refetch();
            }}
          />
        }>
        <View {...pan.panHandlers} style={{ gap: Space.lg }}>
          <Reveal index={0}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 4 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="overline" tone="secondary">
                  {new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                </Txt>
                <Txt variant="title" numberOfLines={2}>
                  {date === today ? greeting(t, name) : dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
                </Txt>
              </View>
              {day.data && day.data.streak > 0 ? (
                <Row gap={4} style={[{ backgroundColor: colors.surface, borderRadius: Radius.pill, paddingHorizontal: Space.md, height: 34 }, elevation]}>
                  <Flame size={15} color={colors.warning} fill={colors.warning} />
                  <Txt variant="label">{t('today.streak', { count: day.data.streak })}</Txt>
                </Row>
              ) : null}
            </Row>
          </Reveal>

          <Reveal index={1}>
            <WeekStrip selected={date} today={today} onSelect={setSelected} />
          </Reveal>

          {day.data ? (
            <>
              <Reveal index={2}>
                <EnergyCard day={day.data} hero={hero} hideCalories={hideCalories} />
              </Reveal>
              <Reveal index={3}>
                <Txt variant="accent" tone="secondary" style={{ fontSize: 19, lineHeight: 26, paddingHorizontal: 6 }}>
                  {dayVoice(day.data, hero, t, nutrient, locale)}
                </Txt>
              </Reveal>
              <Reveal index={4}>
                <NutrientBars day={day.data} plan={user.plan} hero={hero} />
              </Reveal>
            </>
          ) : day.error ? (
            <Card>
              <Txt tone="warning">{errorMessage(day.error, t('common.error'), t('common.offline'))}</Txt>
            </Card>
          ) : (
            <>
              <Skeleton width="100%" height={220} radius={Radius.xl} />
              <Skeleton width="100%" height={140} radius={Radius.xl} />
            </>
          )}
        </View>

        {showCraving ? (
          <Reveal index={5}>
            <Pressy
              onPress={() => router.push('/craving')}
              style={{ marginTop: Space.lg, flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg, borderRadius: Radius.lg, backgroundColor: colors.accentSoft }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="label" style={{ fontSize: 16 }}>
                  {t('today.craving')}
                </Txt>
                <Txt variant="caption" tone="secondary">
                  {day.data && day.data.cravings.resisted > 0 ? t('today.cravingResisted', { count: day.data.cravings.resisted }) : t('craving.subtitle')}
                </Txt>
              </View>
            </Pressy>
          </Reveal>
        ) : null}

        <Reveal index={6}>
          <SectionTitle>{t('today.meals')}</SectionTitle>
          <View style={{ gap: Space.sm }}>
            {pending.map((p) => (
              <PendingMealCard key={p.id} pending={p} onRetry={() => void retry(p)} onDismiss={() => dismiss(p.id)} />
            ))}
            {day.data?.meals
              .slice()
              .reverse()
              .map((meal) => <MealCard key={meal.id} meal={meal} hideCalories={hideCalories} />)}
            {empty ? (
              <Pressy
                onPress={() => router.push({ pathname: '/capture', params: { date } })}
                style={{ alignItems: 'center', paddingVertical: Space.xxl, paddingHorizontal: Space.xl, gap: Space.sm, borderRadius: Radius.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.text3 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.inverted, alignItems: 'center', justifyContent: 'center', marginBottom: Space.xs }}>
                  <Camera size={24} color={colors.onInverted} />
                </View>
                <Txt variant="heading">{t('today.empty.title')}</Txt>
                <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 290 }}>
                  {t('today.empty.body')}
                </Txt>
              </Pressy>
            ) : null}
          </View>
        </Reveal>
      </ScrollView>

      <CaptureButton date={date} bottom={insets.bottom + (Platform.OS === 'web' ? 96 : Space.lg)} invite={empty} />
    </View>
  );
}

/** The one button that matters: tap to snap a meal, long-press to type it. A soft ripple invites the first photo of the day. */
function CaptureButton({ date, bottom, invite }: { date: string; bottom: number; invite: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const halo = useSharedValue(0);
  useEffect(() => {
    halo.set(invite ? withRepeat(withSequence(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1) : withTiming(0));
  }, [invite, halo]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: (1 - halo.value) * 0.3, transform: [{ scale: 1 + halo.value * 0.5 }] }));

  return (
    <View style={{ position: 'absolute', right: Space.xl, bottom, width: 68, height: 68 }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 68, height: 68, borderRadius: 34, backgroundColor: colors.inverted }, haloStyle]} />
      <Pressy
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={t('capture.photo')}
        onPress={() => {
          haptics.impact();
          router.push({ pathname: '/capture', params: { date } });
        }}
        onLongPress={() => {
          haptics.impact();
          router.push({ pathname: '/capture', params: { date, mode: 'text' } });
        }}
        style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.inverted, alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 28px rgba(0,0,0,0.25)' }}>
        <Camera size={28} color={colors.onInverted} />
      </Pressy>
    </View>
  );
}
