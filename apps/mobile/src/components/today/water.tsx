import { toLocalDateTime, type DayHydration, type DaySummary, type WaterEntry } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { useI18n } from '@/i18n';
import { momentOn } from '@/lib/day-logic';
import { haptics } from '@/lib/haptics';
import { health } from '@/lib/health';
import { useApi } from '@/lib/session';
import { useSettings, useToast } from '@/lib/stores';
import { useUndoableDelete } from '@/lib/undo';
import { LIFE_COLORS, Motion, useTheme } from '@/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** A tumbler, a little wider at the rim (drawn on a 34 × 42 grid). */
const GLASS = 'M4,3 L30,3 L27.2,37.6 Q26.9,41 23.5,41 L10.5,41 Q7.1,41 6.8,37.6 Z';
const TOP = 3;
const BOTTOM = 41;

/** The glass fills with a soft spring (the water settles) and pops a little with each new glass. */
export function Glass({ progress, totalMl, height = 42 }: { progress: number; totalMl: number; height?: number }) {
  const { colors } = useTheme();
  const level = useSharedValue(0);
  const pop = useSharedValue(1);
  const previous = useRef(totalMl);
  useEffect(() => {
    level.set(withSpring(Math.min(progress, 1), Motion.settle));
  }, [progress, level]);
  useEffect(() => {
    if (totalMl > previous.current) pop.set(withSequence(withTiming(1.15, { duration: 110 }), withSpring(1, Motion.press)));
    previous.current = totalMl;
  }, [totalMl, pop]);
  const water = useAnimatedProps(() => {
    const top = TOP + (1 - level.value) * (BOTTOM - TOP);
    return { y: top, height: Math.max(0, BOTTOM - top) };
  });
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const full = progress >= 1;
  const width = (height * 34) / 42;
  return (
    <Animated.View style={popStyle}>
      <Svg width={width} height={height} viewBox="0 0 34 42">
        <Defs>
          <ClipPath id="hydration-glass">
            <Path d={GLASS} />
          </ClipPath>
        </Defs>
        <AnimatedRect x={0} width={34} fill={LIFE_COLORS.water} fillOpacity={0.85} clipPath="url(#hydration-glass)" animatedProps={water} />
        <Path d={GLASS} fill="none" stroke={full ? LIFE_COLORS.water : colors.text2} strokeWidth={height < 30 ? 3.2 : 2} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

/**
 * Pours a glass on a day. Optimistic: the glass fills on tap, the server
 * catches up. Every glass can be undone from the toast; with Health on, it
 * lands there too (and leaves with the undo). Reaching the goal is the one
 * moment worth a success haptic.
 */
export function useWater(date: string) {
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

  return async (ml: number, hydration: DayHydration | null | undefined) => {
    haptics.soft();
    await bump(ml);
    try {
      const entry = await api.addWater({ externalId: null, at: toLocalDateTime(momentOn(date)), localDate: date, ml });
      if (hydration && hydration.totalMl < hydration.goalMl && hydration.totalMl + ml >= hydration.goalMl) haptics.success();
      const written = healthEnabled && health.source ? health.writeWater({ id: entry.id, at: new Date(entry.at), ml }).catch(() => undefined) : null;
      showToast({ message: t('water.added', { ml }), action: { label: t('today.undo'), onPress: () => void remove(entry, written) } });
    } catch {
      await bump(-ml);
      haptics.warning();
    }
    settle();
  };
}

/** The day's last glass logged in the app (the health store's drinks live there). */
export const lastGlass = (hydration: DayHydration | null | undefined) =>
  hydration?.entries.filter((e) => e.source === 'manual').sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

/**
 * Takes a glass back the one way (see `useUndoableDelete`): the total drops
 * at once, « Annuler » keeps it, the server hears about it when the toast leaves.
 */
export function useRemoveGlass(date: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const remove = useUndoableDelete();
  const healthEnabled = useSettings((s) => s.healthEnabled);
  const key = ['day', date];
  return (entry: WaterEntry) => {
    queryClient.setQueryData<DaySummary>(key, (day) =>
      day?.hydration
        ? { ...day, hydration: { ...day.hydration, totalMl: Math.max(0, day.hydration.totalMl - entry.ml), entries: day.hydration.entries.filter((e) => e.id !== entry.id) } }
        : day,
    );
    remove({
      id: entry.id,
      message: t('water.removed', { ml: entry.ml }),
      commit: async () => {
        await api.deleteWater(entry.id);
        if (healthEnabled && health.source) void health.deleteWater(entry.id).catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: ['insights'] });
      },
      restore: () => void queryClient.invalidateQueries({ queryKey: key }),
    });
  };
}
