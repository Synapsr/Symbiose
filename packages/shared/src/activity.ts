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
