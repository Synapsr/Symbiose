import { toLocalDateTime, WATER_SIZES, type DayHydration, type DaySummary, type WaterEntry } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { AnimatedNumber, Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatLiters } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { health } from '@/lib/health';
import { useApi } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { LIFE_COLORS, Motion, Radius, Space, useTheme } from '@/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const W = 34;
const H = 42;
/** A tumbler, a little wider at the rim. */
const GLASS = 'M4,3 L30,3 L27.2,37.6 Q26.9,41 23.5,41 L10.5,41 Q7.1,41 6.8,37.6 Z';
const TOP = 3;
const BOTTOM = 41;

/** The glass fills with a soft spring (the water settles) and pops a little with each new glass. */
function Glass({ progress, totalMl }: { progress: number; totalMl: number }) {
  const { colors } = useTheme();
  const level = useSharedValue(0);
  const pop = useSharedValue(1);
  const previous = useRef(totalMl);
  useEffect(() => {
    level.set(withSpring(Math.min(progress, 1), Motion.settle));
  }, [progress, level]);
  useEffect(() => {
    if (totalMl > previous.current) pop.set(withSequence(withTiming(1.1, { duration: 110 }), withSpring(1, Motion.press)));
    previous.current = totalMl;
  }, [totalMl, pop]);
  const water = useAnimatedProps(() => {
    const top = TOP + (1 - level.value) * (BOTTOM - TOP);
    return { y: top, height: Math.max(0, BOTTOM - top) };
  });
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const full = progress >= 1;
  return (
    <Animated.View style={popStyle}>
      <Svg width={W} height={H}>
        <Defs>
          <ClipPath id="hydration-glass">
            <Path d={GLASS} />
          </ClipPath>
        </Defs>
        <AnimatedRect x={0} width={W} fill={LIFE_COLORS.water} fillOpacity={0.85} clipPath="url(#hydration-glass)" animatedProps={water} />
        <Path d={GLASS} fill="none" stroke={full ? LIFE_COLORS.water : colors.text3} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

/**
 * Optimistic: the glass fills on tap, the server catches up. Every glass can
 * be undone from the toast; with Health on, it lands there too (and leaves
 * with the undo).
 */
function useWater(date: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const showToast = useToast((s) => s.show);
  const healthEnabled = useSettings((s) => s.healthEnabled);
  const key = ['day', date];

  const bump = async (ml: number) => {
    // A refetch started before this change would bring back the old total.
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<DaySummary>(key, (day) =>
      day?.hydration ? { ...day, hydration: { ...day.hydration, totalMl: Math.max(0, day.hydration.totalMl + ml) } } : day,
    );
  };
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
  };

  /** `written` is the copy to Health still on its way: it must land before it can leave. */
  const remove = async (entry: WaterEntry, written: Promise<void> | null) => {
    await bump(-entry.ml);
    try {
      await api.deleteWater(entry.id);
      if (written) void written.then(() => health.deleteWater(entry.id)).catch(() => undefined);
    } catch {
      haptics.warning();
    }
    settle();
  };

  return async (ml: number, hydration: DayHydration) => {
    haptics.soft();
    await bump(ml);
    try {
      const entry = await api.addWater({ externalId: null, at: toLocalDateTime(), localDate: date, ml });
      if (hydration.totalMl < hydration.goalMl && hydration.totalMl + ml >= hydration.goalMl) haptics.success();
      const written = healthEnabled && health.source ? health.writeWater({ id: entry.id, at: new Date(entry.at), ml }).catch(() => undefined) : null;
      showToast({ message: t('water.added', { ml }), action: { label: t('today.undo'), onPress: () => void remove(entry, written) } });
    } catch {
      await bump(-ml);
      haptics.warning();
    }
    settle();
  };
}

/** Today's drinks against the goal: one tap pours a glass, a long press picks the size (and keeps it for next time). */
export function HydrationRow({ date, hydration, editable }: { date: string; hydration: DayHydration; editable: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const glassMl = useSettings((s) => s.glassMl);
  const setSettings = useSettings((s) => s.set);
  const [picking, setPicking] = useState(false);
  const pour = useWater(date);
  const progress = hydration.goalMl > 0 ? hydration.totalMl / hydration.goalMl : 0;
  const reached = progress >= 1;

  return (
    <View style={{ gap: Space.md }}>
      <Row gap={Space.md}>
        <Glass progress={progress} totalMl={hydration.totalMl} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="overline" tone="secondary">
            {t('water.title')}
          </Txt>
          <Row gap={5} style={{ alignItems: 'baseline' }}>
            <AnimatedNumber value={hydration.totalMl} format={(n) => formatLiters(Math.round(n / 10) * 10, locale)} variant="number" />
            <Txt variant="caption" tone={reached ? 'accent' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {reached ? t('water.reached') : t('water.of', { goal: formatLiters(hydration.goalMl, locale) })}
            </Txt>
          </Row>
        </View>
        {editable ? (
          <Pressy
            haptic={false}
            delayLongPress={300}
            onPress={() => void pour(glassMl, hydration)}
            onLongPress={() => {
              haptics.tap();
              setPicking((open) => !open);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('water.add', { ml: glassMl })}
            accessibilityHint={t('water.pick')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
            <Plus size={16} color={colors.text} strokeWidth={2.5} />
            <Txt variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {glassMl} ml
            </Txt>
          </Pressy>
        ) : null}
      </Row>

      {picking ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
          <Row gap={Space.sm}>
            {WATER_SIZES.map((ml) => {
              const selected = ml === glassMl;
              return (
                <Pressy
                  key={ml}
                  onPress={() => {
                    setSettings({ glassMl: ml });
                    setPicking(false);
                    void pour(ml, hydration);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('water.add', { ml })}
                  accessibilityState={{ selected }}
                  style={{ flex: 1, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? LIFE_COLORS.water : colors.surface2 }}>
                  <Txt variant="label" color={selected ? '#FFFFFF' : colors.text} style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>
                    {ml} ml
                  </Txt>
                </Pressy>
              );
            })}
          </Row>
        </Animated.View>
      ) : null}
    </View>
  );
}
