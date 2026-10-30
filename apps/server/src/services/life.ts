import { addDays, localTime, SHORT_NIGHT_MIN, type GoalPlan, type Profile } from '@symbiose/shared';

import type { LifeBrief } from '../ai/types';
import type { Db } from '../db';
import { dayHydration, hydrationTrend } from './hydration';
import { moodTrend } from './mood';
import { sleepTrend } from './sleep';

/** What the AI is told about sleep, hydration and mood on a given day: only the modules the person turned on. */
export function lifeBrief(db: Db, userId: string, profile: Profile | null, plan: GoalPlan | null, date: string): LifeBrief {
  const brief: LifeBrief = {};
  if (!profile) return brief;

  if (profile.trackSleep) {
    const week = sleepTrend(db, userId, addDays(date, -6), date);
    const last = week.nights.at(-1);
    brief.sleep = {
      lastNight: last?.localDate === date ? { date, asleepMin: last.asleepMin, bedtime: localTime(last.bedtime), wakeTime: localTime(last.wakeTime) } : null,
      average7Min: week.averageMin,
      nights7: week.nights.length,
      shortNights7: week.nights.filter((n) => n.asleepMin < SHORT_NIGHT_MIN).length,
      cravingsAfterShortNights: week.cravingsAfterShortNights,
    };
  }

  if (profile.trackHydration) {
    const today = dayHydration(db, userId, profile, date);
    const before = hydrationTrend(db, userId, profile, addDays(date, -7), addDays(date, -1));
    brief.hydration = { todayMl: today.totalMl, goalMl: today.goalMl, average7Ml: before.averageMl, daysReached7: before.daysReached };
  }

  if (profile.trackMood) {
    // 30 days for the « les jours où » link; the AI sees the last week day by day.
    const trend = moodTrend(db, userId, profile, plan, date, 30);
    const last7 = trend.days.filter((d) => d.date >= addDays(date, -6));
    const today = trend.latest?.localDate === date ? trend.latest : null;
    brief.mood = {
      today: today ? { mood: today.mood, note: today.note, time: localTime(today.at) } : null,
      last7,
      average7: last7.length ? Math.round((last7.reduce((sum, d) => sum + d.mood, 0) / last7.length) * 10) / 10 : null,
      persistentLow: trend.persistentLow,
      link: trend.link,
    };
  }

  return brief;
}
