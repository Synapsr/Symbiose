import { addDays } from './dates';

/**
 * Progress: the streak, its rest days and the milestones, from the days with
 * a meal and the cravings resisted. Pure, so the server, the phone and the
 * tests agree.
 *
 * It rewards showing up, never a number on a plate or on the scale: a day
 * counts as soon as one meal is logged, whatever it was. And it forgives: a
 * day without a meal is covered by a rest day when one is in reserve, so one
 * forgotten evening never wipes out weeks of effort.
 */

/** A rest day is earned every this many days logged in a run… */
export const REST_DAY_EVERY = 7;
/** …and no more than this many are kept in reserve. */
export const MAX_REST_DAYS = 2;

/**
 * A day of the streak: a meal logged; covered by a rest day; missed (or before
 * the first meal: both read the same, never as a fault); today, still open.
 */
export type StreakDayState = 'logged' | 'rest' | 'missed' | 'open';

export interface StreakSummary {
  /** Days logged in the run under way: a rest day holds it without adding to it. 0 once broken. */
  current: number;
  /** The longest run ever. */
  best: number;
  /** Rest days in reserve, each one covering a day without a meal. */
  restDays: number;
  /** Days still to log before the next rest day (0 when the reserve is full). */
  nextRestIn: number;
  /** Today's meal earned a rest day (optional: older servers don't say). */
  restEarnedToday?: boolean;
  /** A meal is already logged today: the run is safe until tomorrow. */
  todayLogged: boolean;
  /** The last 7 days, oldest first, ending today. */
  week: { date: string; state: StreakDayState }[];
}

export type MilestoneFamily = 'streak' | 'days' | 'cravings';

/**
 * The steps of each family. Close together at first (habits are made in the
 * first weeks), then further apart, so each one stays an event.
 */
export const MILESTONE_STEPS: Record<MilestoneFamily, readonly number[]> = {
  streak: [3, 7, 14, 30, 60, 100, 200, 365],
  days: [10, 50, 100, 250, 500, 1000],
  cravings: [5, 10, 25, 50, 100],
};

export interface Milestone {
  /** `family.value`, e.g. `streak.7`: stable, used to celebrate each one once. */
  id: string;
  family: MilestoneFamily;
  value: number;
  /** The local day it was reached. */
  reachedAt: string;
}

export interface FamilyProgress {
  family: MilestoneFamily;
  /** Where the person stands: the run under way, the days logged, the cravings resisted. */
  count: number;
  /** The next step to reach; null once every step is reached. */
  next: number | null;
}

export interface ProgressSummary {
  today: string;
  streak: StreakSummary;
  /** Every family worth showing, in a fixed order (cravings only once one was logged). */
  families: FamilyProgress[];
  /** The milestones reached, the most recent first. */
  reached: Milestone[];
}

export interface ProgressInput {
  /** Local days with at least one meal, in any order (duplicates are fine). */
  loggedDays: readonly string[];
  /** One local day per craving resisted. */
  resisted: readonly string[];
  /** At least one craving was ever logged, resisted or not: the family shows from then on. */
  cravingsLogged: boolean;
  today: string;
}

const FAMILY_ORDER: MilestoneFamily[] = ['streak', 'days', 'cravings'];

/** The streak as it stands on `today` (today, while still open, never breaks it), and the day each run length was first reached. */
export function streakSummary(loggedDays: readonly string[], today: string): StreakSummary & { reachedOn: Map<number, string> } {
  const logged = new Set(loggedDays.filter((d) => d <= today));
  const first = [...logged].sort()[0];
  const states = new Map<string, StreakDayState>();
  const reachedOn = new Map<number, string>();
  let run = 0;
  let best = 0;
  let reserve = 0;
  let toward = 0;
  let restEarnedToday = false;

  if (first) {
    for (let day = first; day <= today; day = addDays(day, 1)) {
      if (logged.has(day)) {
        run++;
        best = Math.max(best, run);
        if (!reachedOn.has(run)) reachedOn.set(run, day);
        toward++;
        if (toward >= REST_DAY_EVERY) {
          toward = 0;
          if (day === today && reserve < MAX_REST_DAYS) restEarnedToday = true;
          reserve = Math.min(MAX_REST_DAYS, reserve + 1);
        }
        states.set(day, 'logged');
      } else if (day === today) {
        states.set(day, 'open');
      } else if (run > 0 && reserve > 0) {
        reserve--;
        states.set(day, 'rest');
      } else {
        run = 0;
        toward = 0;
        states.set(day, 'missed');
      }
    }
  }

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, state: states.get(date) ?? (date === today ? 'open' : 'missed') };
  });
  return {
    current: run,
    best,
    restDays: reserve,
    nextRestIn: reserve >= MAX_REST_DAYS ? 0 : REST_DAY_EVERY - toward,
    todayLogged: logged.has(today),
    restEarnedToday,
    week,
    reachedOn,
  };
}

/** `best` decides the next step (a step reached once stays reached), `count` where the person stands on the way to it. */
function family(family: MilestoneFamily, count: number, best = count): FamilyProgress {
  return { family, count, next: MILESTONE_STEPS[family].find((step) => step > best) ?? null };
}

/** Everything « Ta progression » shows, and what can be celebrated. */
export function progressSummary(input: ProgressInput): ProgressSummary {
  const { today } = input;
  const { reachedOn, ...streak } = streakSummary(input.loggedDays, today);
  const days = [...new Set(input.loggedDays.filter((d) => d <= today))].sort();
  const resisted = input.resisted.filter((d) => d <= today).sort();

  const reached: Milestone[] = [];
  const add = (family: MilestoneFamily, value: number, reachedAt: string | undefined) => {
    if (reachedAt) reached.push({ id: `${family}.${value}`, family, value, reachedAt });
  };
  for (const step of MILESTONE_STEPS.streak) add('streak', step, reachedOn.get(step));
  for (const step of MILESTONE_STEPS.days) add('days', step, days[step - 1]);
  for (const step of MILESTONE_STEPS.cravings) add('cravings', step, resisted[step - 1]);
  // Most recent first; on the same day, the streak before the other families, then the bigger step.
  reached.sort((a, b) => b.reachedAt.localeCompare(a.reachedAt) || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || b.value - a.value);

  const families = [
    // The streak's next step is measured against the run under way: that is what has to grow.
    family('streak', streak.current, streak.best),
    family('days', days.length),
    ...(input.cravingsLogged || resisted.length ? [family('cravings', resisted.length)] : []),
  ];
  return { today, streak, families, reached };
}

/**
 * The milestone to celebrate now, among those reached today and never
 * celebrated (`seen`): the biggest one, when two land the same day. The others
 * are noted with it, so each milestone is celebrated at most once.
 */
export function milestoneDue(summary: Pick<ProgressSummary, 'today' | 'reached'>, seen: readonly string[]): { due: Milestone | null; seen: string[] } {
  const fresh = summary.reached.filter((m) => !seen.includes(m.id));
  if (!fresh.length) return { due: null, seen: [...seen] };
  const today = fresh.filter((m) => m.reachedAt === summary.today);
  return { due: today[0] ?? null, seen: [...seen, ...fresh.map((m) => m.id)] };
}
