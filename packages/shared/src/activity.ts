import type { ActivityGoals, GoalPlan, Workout, WorkoutIntensity, WorkoutType } from './schemas';

/** Metabolic equivalents (Compendium of Physical Activities, rounded) by type and intensity. */
export const MET: Record<WorkoutType, Record<WorkoutIntensity, number>> = {
  walking: { light: 2.8, moderate: 3.5, vigorous: 5 },
  running: { light: 7, moderate: 9.8, vigorous: 11.5 },
  cycling: { light: 4, moderate: 6.8, vigorous: 10 },
  strength: { light: 3.5, moderate: 5, vigorous: 6 },
  swimming: { light: 5.8, moderate: 7, vigorous: 9.8 },
  hiit: { light: 6, moderate: 8, vigorous: 10 },
  yoga: { light: 2.5, moderate: 3, vigorous: 4 },
  sports: { light: 4.5, moderate: 6.5, vigorous: 8 },
  other: { light: 3, moderate: 4.5, vigorous: 6.5 },
};

/** Active energy (above resting) of a session: (MET − 1) × kg × hours. */
export function estimateWorkoutKcal(type: WorkoutType, intensity: WorkoutIntensity, durationMin: number, weightKg: number): number {
  return Math.round((MET[type][intensity] - 1) * weightKg * (durationMin / 60));
}

/**
 * Steps per minute of the sessions that can be logged in steps, to estimate how
 * long they lasted. Walking: about 100 steps/min is where moderate intensity
 * starts and about 130 vigorous (Tudor-Locke et al., CADENCE-Adults, 2019); a
 * stroll is slower, and 120 matches the brisk walk of the METs above.
 * Running: recreational runners land around 150 to 170.
 */
export const STEP_CADENCE: Partial<Record<WorkoutType, Record<WorkoutIntensity, number>>> = {
  walking: { light: 80, moderate: 100, vigorous: 120 },
  running: { light: 150, moderate: 160, vigorous: 170 },
};

/** A walk or a run: what a step counter measures. */
export function countsSteps(type: WorkoutType): boolean {
  return STEP_CADENCE[type] !== undefined;
}

/** How long a session logged in steps lasted, in whole minutes, from its cadence. */
export function minutesFromSteps(type: WorkoutType, intensity: WorkoutIntensity, steps: number): number {
  const cadence = STEP_CADENCE[type]?.[intensity] ?? 100;
  return Math.min(1440, Math.max(1, Math.round(steps / cadence)));
}

/**
 * A day's steps: the health store's count and the steps of the sessions added
 * by hand are never summed, since the phone may well have counted that walk
 * already. The larger one wins, so a store that missed it (phone left at home,
 * a Health Connect without a step counter saying 0) doesn't hide it either.
 * Null when neither says anything.
 */
export function daySteps(storeSteps: number | null | undefined, workouts: readonly Pick<Workout, 'steps'>[]): number | null {
  let logged: number | null = null;
  for (const workout of workouts) if (workout.steps != null) logged = (logged ?? 0) + workout.steps;
  if (storeSteps == null) return logged;
  return logged === null ? storeSteps : Math.max(storeSteps, logged);
}

/** Goal-based defaults when the plan doesn't set activity guardrails. */
export function defaultActivityGoals(plan: Pick<GoalPlan, 'tags'> | null): ActivityGoals {
  const tags = new Set(plan?.tags ?? []);
  return {
    weeklyActiveMinutes: 150,
    dailySteps: tags.has('lose_weight') ? 8000 : null,
    weeklyStrengthSessions: tags.has('gain_muscle') ? 3 : null,
  };
}

export function activityGoalsFor(plan: Pick<GoalPlan, 'tags' | 'activity'> | null): ActivityGoals {
  return plan?.activity ?? defaultActivityGoals(plan);
}

/** Minutes that count toward the weekly goal: every session except an easy stroll. */
export function countsAsActive(workout: Pick<Workout, 'type' | 'intensity'>): boolean {
  return !(workout.type === 'walking' && workout.intensity === 'light');
}
