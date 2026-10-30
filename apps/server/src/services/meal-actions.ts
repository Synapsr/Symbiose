import { LocalDateSchema, localTime, type CoachMealAction, type CoachMealProposal, type Meal, type MealType } from '@symbiose/shared';

import type { Deps } from '../http';
import { createMeal, deleteMeal, getMealRow, refineMeal, toMeal, updateMeal } from './meals';

const MAX_ACTIONS = 5;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** When an added meal has no time and isn't from today. */
const TYPICAL_TIME: Record<MealType, string> = { breakfast: '08:00', lunch: '12:30', snack: '16:30', dinner: '19:30' };

const offsetOf = (localDateTime: string) => /(Z|[+-]\d{2}:\d{2})$/.exec(localDateTime)?.[1] ?? 'Z';

/**
 * Keeps the coach's proposals that can be applied: at most 5, edits and
 * deletes only on meals it was shown, adds dated on the conversation's day
 * unless it named another one.
 */
export function acceptMealActions(proposals: CoachMealProposal[], shownMealIds: Set<string>, localDate: string): CoachMealAction[] {
  return proposals
    .flatMap((proposal): CoachMealAction[] => {
      const date = proposal.localDate && LocalDateSchema.safeParse(proposal.localDate).success ? proposal.localDate : null;
      const time = proposal.time && TIME.test(proposal.time) ? proposal.time : null;
      const description = proposal.action === 'delete' ? '' : proposal.description.trim().slice(0, 1000);
      const common = { mealType: proposal.mealType, time, summary: proposal.summary.trim().slice(0, 160), status: 'proposed' as const, resultMealId: null };
      if (proposal.action === 'add') {
        return description ? [{ ...common, action: 'add', mealId: null, description, localDate: date ?? localDate }] : [];
      }
      if (!proposal.mealId || !shownMealIds.has(proposal.mealId)) return [];
      if (proposal.action === 'edit' && !description && !proposal.mealType && !date && !time) return [];
      return [{ ...common, action: proposal.action, mealId: proposal.mealId, description, localDate: date }];
    })
    .slice(0, MAX_ACTIONS);
}

/**
 * Runs a confirmed action with the regular meal logic and returns the meal
 * added or edited. `now` is the device's local time, which carries its offset.
 */
export async function runMealAction(deps: Pick<Deps, 'db' | 'ai' | 'photos'>, userId: string, action: CoachMealAction, now: string): Promise<Meal | null> {
  if (action.action === 'add') {
    const today = now.slice(0, 10);
    const localDate = action.localDate ?? today;
    const time = action.time ?? (localDate === today ? localTime(now) : TYPICAL_TIME[action.mealType ?? 'lunch']);
    return createMeal(deps, userId, {
      eatenAt: `${localDate}T${time}:00${offsetOf(now)}`,
      localDate,
      mealType: action.mealType ?? undefined,
      text: action.description,
    });
  }

  const existing = getMealRow(deps.db, userId, action.mealId ?? '');
  if (action.action === 'delete') {
    await deleteMeal(deps, userId, existing.id);
    return null;
  }

  // The AI first: if it fails, nothing has changed yet.
  let meal = action.description ? await refineMeal(deps, userId, existing.id, action.description) : toMeal(existing);
  if (action.mealType || action.localDate || action.time) {
    const localDate = action.localDate ?? existing.localDate;
    const moved = Boolean(action.localDate || action.time);
    meal = updateMeal(deps.db, userId, existing.id, {
      mealType: action.mealType ?? undefined,
      ...(moved ? { localDate, eatenAt: `${localDate}T${action.time ?? localTime(existing.eatenAt)}:00${offsetOf(existing.eatenAt)}` } : {}),
    });
  }
  return meal;
}
