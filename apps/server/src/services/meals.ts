import {
  mealFlags,
  mealTotals,
  sanitizePer100g,
  shortId,
  type FoodItem,
  type GoalPlan,
  type Meal,
  type MealInsight,
  type Nutrients,
  type Targets,
} from '@symbiose/shared';

import type { MealAnalysis } from '../ai/types';
import type { MealRow } from '../db/schema';

export function toMeal(row: MealRow): Meal {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    localDate: row.localDate,
    mealType: row.mealType,
    title: row.title,
    items: row.items,
    photoId: row.photoId,
    note: row.note,
    insight: row.insight ?? null,
    favorite: row.favorite,
    totals: mealTotals(row.items),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/** Turns raw AI output into validated, physically plausible food items. */
export function itemsFromAnalysis(analysis: MealAnalysis): FoodItem[] {
  return analysis.items
    .filter((item) => item.name.trim().length > 0)
    .slice(0, 40)
    .map((item) => ({
      id: shortId(),
      name: item.name.trim().slice(0, 120),
      emoji: [...(item.emoji ?? '')].slice(0, 2).join(''),
      portion: (item.portion ?? '').slice(0, 60),
      grams: Math.round(clamp(item.grams, 0, 5000)),
      per100g: sanitizePer100g(item.per100g),
      source: 'ai' as const,
      confidence: Math.round(clamp(item.confidence, 0, 1) * 100) / 100,
      brand: null,
      barcode: null,
    }));
}

/** Combines the AI's qualitative assessment with deterministic, goal-aware flags. */
export function buildInsight(
  totals: Nutrients,
  targets: Targets | null,
  plan: GoalPlan | null,
  ai?: Pick<MealAnalysis, 'verdict' | 'headline' | 'tips' | 'clarification'>,
): MealInsight | null {
  const flags = targets ? mealFlags(totals, targets, plan) : [];
  if (!ai) {
    if (!flags.length) return null;
    const worst = flags.find((f) => f.kind === 'max' && f.share >= 0.5);
    return { verdict: worst ? 'watch' : 'ok', headline: '', tips: [], flags, clarification: null };
  }
  return {
    verdict: ai.verdict,
    headline: ai.headline.slice(0, 240),
    tips: ai.tips.filter(Boolean).slice(0, 2).map((tip) => tip.slice(0, 240)),
    flags,
    clarification:
      ai.clarification && ai.clarification.options.length >= 2
        ? {
            question: ai.clarification.question.slice(0, 160),
            options: ai.clarification.options.slice(0, 4).map((o) => o.slice(0, 40)),
          }
        : null,
  };
}

/** Removes the per-request item ids so foods can be grouped across meals. */
export function stripItem(item: FoodItem): Omit<FoodItem, 'id'> {
  const { id: _id, ...rest } = item;
  return rest;
}
