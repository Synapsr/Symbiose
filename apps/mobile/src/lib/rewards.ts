import { addDays, heroNutrient, type GoalPlan } from '@symbiose/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Easing, useSharedValue, withDelay, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';

import { feedback } from './feedback';
import { goodDay, reachedGoals, rewardsDue, type GoodDay } from './feedback-logic';
import { useDay } from './hooks';
import { useApi } from './session';
import { useSettings } from './stores';

/**
 * Today's goals (a minimum, the water goal), each celebrated the first time
 * it is reached in the day, right after a meal or a glass logged here: a
 * chime, a success haptic, and a glow for the hero card (returned, 0 → 1 → 0).
 */
export function useGoalRewards(today: string): SharedValue<number> {
  const day = useDay(today).data;
  const glow = useSharedValue(0);
  const set = useSettings((s) => s.set);

  useEffect(() => {
    // The previous day may still be on screen while today loads.
    if (!day || day.date !== today) return;
    const { rewards } = useSettings.getState();
    const { due, log } = rewardsDue(rewards, today, reachedGoals(day), feedback.isLive());
    if (log !== rewards) set({ rewards: log });
    if (!due.length) return;
    feedback.goalReached();
    glow.set(withSequence(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }), withDelay(500, withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) }))));
  }, [day, today, glow, set]);

  return glow;
}

/**
 * Yesterday, when it was a good day (see `goodDay`), for the morning line:
 * asked only while today is still empty.
 */
export function useGoodDay(today: string, enabled: boolean, plan: GoalPlan | null, hideCalories: boolean): GoodDay | null {
  const api = useApi();
  const yesterday = addDays(today, -1);
  const { data } = useQuery({ queryKey: ['day', yesterday], queryFn: () => api.day(yesterday), enabled });
  if (!enabled || !data || data.date !== yesterday) return null;
  return goodDay(data, heroNutrient(data.progress, plan, hideCalories));
}
