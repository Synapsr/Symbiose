import type { ProgressSummary } from '@symbiose/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Shield } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayDot } from '@/components/progress/day-dot';
import { FlameHero, RollingNumber } from '@/components/progress/flame-hero';
import { Button, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { feedback } from '@/lib/feedback';
import { FLAME_BEATS } from '@/lib/feedback-logic';
import { weekdayInitial } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { dismiss } from '@/lib/nav';
import { useProgress } from '@/lib/progress';
import { flameLine } from '@/lib/progress-logic';
import { Space, useTheme } from '@/theme';

/** The screen's own fade comes first: the moment starts once it is in front. */
const START_MS = 250;
const IGNITE = START_MS + FLAME_BEATS.ignite;
const COUNT = START_MS + FLAME_BEATS.count;

/**
 * « Ta flamme grandit », full screen, once a day after the day's first meal
 * (`useCelebrations`): the flame catches, the number turns, today's dot
 * lights up, with its sound and its haptics on the same beats. With `next`,
 * a milestone was reached at the same time: « Continuer » opens it.
 */
export default function StreakScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const data = useProgress().data;
  useEffect(() => {
    if (data && !data.streak.todayLogged) dismiss();
  }, [data]);
  return data?.streak.todayLogged ? <Moment data={data} next={next} /> : null;
}

function Moment({ data, next }: { data: ProgressSummary; next?: string }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { streak } = data;
  const [lit, setLit] = useState(false);
  const yesterday = streak.week.at(-2)?.state;
  const bonus = streak.restEarnedToday ? 'earned' : yesterday === 'rest' ? 'kept' : null;

  useEffect(() => {
    const timers = [setTimeout(() => feedback.flame(), START_MS), setTimeout(() => setLit(true), COUNT), bonus ? setTimeout(() => haptics.soft(), COUNT + 650) : null];
    return () => timers.forEach((timer) => timer && clearTimeout(timer));
  }, [bonus]);

  const line = flameLine(data, Boolean(next?.startsWith('streak.')));
  const words =
    line.key === 'flame.again'
      ? t('flame.again', { best: line.best })
      : line.key === 'flame.toRecord'
        ? plural('flame.toRecord', line.count)
        : line.key === 'flame.recordNext'
          ? plural('flame.recordNext', line.count, { next: line.next })
          : t(line.key);

  const go = () => {
    if (next) router.replace({ pathname: '/milestone', params: { id: next, celebrate: '1' } });
    else dismiss();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + Space.lg, paddingBottom: insets.bottom + Space.lg, paddingHorizontal: Space.xl }}>
      <View
        accessible
        accessibilityLabel={`${plural('milestone.title.streak', streak.current)}. ${words}`}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md }}>
        <FlameHero size={140} igniteAt={IGNITE} />

        <View style={{ alignItems: 'center', marginTop: -Space.lg }}>
          <RollingNumber from={Math.max(0, streak.current - 1)} to={streak.current} at={COUNT} />
          <Animated.View entering={FadeIn.delay(IGNITE).duration(300)}>
            <Txt variant="label" tone="secondary" style={{ fontSize: 18 }}>
              {plural('progress.unit.streak', streak.current)}
            </Txt>
          </Animated.View>
        </View>

        <Animated.View entering={FadeInDown.delay(IGNITE + 120).duration(380)}>
          <Row gap={Space.sm} style={{ marginTop: Space.md }}>
            {streak.week.map((day, i) => {
              const today = i === streak.week.length - 1;
              return (
                <View key={day.date} style={{ alignItems: 'center', gap: 6 }}>
                  <Txt variant="caption" tone={today ? 'primary' : 'tertiary'} style={{ fontWeight: '600' }}>
                    {weekdayInitial(day.date, locale)}
                  </Txt>
                  {today ? (
                    <Animated.View key={lit ? 'lit' : 'open'} entering={lit ? ZoomIn.springify().damping(18).stiffness(260) : undefined}>
                      <DayDot state={lit ? 'logged' : 'open'} size={38} />
                    </Animated.View>
                  ) : (
                    <DayDot state={day.state} size={38} />
                  )}
                </View>
              );
            })}
          </Row>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(COUNT + 250).duration(380)} style={{ maxWidth: 360, marginTop: Space.sm }}>
          <Txt variant="accent" tone="secondary" style={{ fontSize: 20, lineHeight: 27, textAlign: 'center' }}>
            {words}
          </Txt>
        </Animated.View>

        {bonus ? (
          <Animated.View entering={ZoomIn.delay(COUNT + 650).springify().damping(18).stiffness(220)}>
            <Row gap={Space.sm} style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: Space.sm, paddingHorizontal: Space.lg }}>
              <Shield size={16} color={colors.accentText} fill={colors.accentText} />
              <Txt variant="label" tone="accent">
                {t(bonus === 'earned' ? 'flame.restEarned' : 'flame.restKept')}
              </Txt>
            </Row>
          </Animated.View>
        ) : null}
      </View>

      <Animated.View entering={FadeInDown.delay(COUNT + 450).duration(380)} style={{ alignItems: 'center' }}>
        <Button title={next ? t('flame.reveal') : t('milestone.continue')} onPress={go} style={{ alignSelf: 'stretch', maxWidth: 420 }} />
      </Animated.View>
    </View>
  );
}
