import { clampActivityGoals, clampRuleValue, defaultActivityGoals, GoalPlanSchema, type GoalPlan, type GoalTag, type Locale, type NutrientKey, type NutrientRule } from '@symbiose/shared';

import type { PlanDraft } from '../ai/types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

const unique = <T,>(list: T[]) => [...new Set(list)];

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** Clamp and validate an AI-proposed plan into something safe and coherent. */
export function planFromDraft(draft: PlanDraft, intentions: string, overrides: GoalPlan['overrides'] = {}): GoalPlan {
  const rulesByNutrient = new Map<NutrientKey, NutrientRule>();
  for (const rule of draft.rules) {
    if (rule.nutrient === 'kcal') continue;
    rulesByNutrient.set(rule.nutrient, {
      nutrient: rule.nutrient,
      kind: rule.kind,
      value: clampRuleValue(rule.nutrient, rule.value),
      reason: (rule.reason ?? '').slice(0, 240),
    });
  }
  const focus = unique(draft.focus).slice(0, 3);
  const plan: GoalPlan = {
    intentions: intentions.slice(0, 2000),
    title: draft.title.trim().slice(0, 80),
    summary: draft.summary.trim().slice(0, 500),
    tags: unique(draft.tags).slice(0, 5),
    calorieMode: draft.calorieMode,
    caloriePercent: draft.calorieMode === 'maintain' ? 0 : Math.round(clamp(draft.caloriePercent, 0, draft.calorieMode === 'surplus' ? 20 : 25)),
    proteinPerKg: Math.round(clamp(draft.proteinPerKg, 0.8, 2.4) * 10) / 10,
    fatPercent: Math.round(clamp(draft.fatPercent, 20, 45)),
    rules: [...rulesByNutrient.values()].slice(0, 9),
    focus: focus.length ? focus : ['kcal'],
    habits: draft.habits.slice(0, 6).map((habit, index) => ({
      id: slug(habit.id || habit.label) || `habit-${index + 1}`,
      label: habit.label.trim().slice(0, 160),
      kind: habit.kind,
    })),
    coachTone: draft.coachTone,
    adjustForActivity: draft.adjustForActivity,
    overrides,
    activity: clampActivityGoals(draft.activity),
  };
  return GoalPlanSchema.parse(plan);
}

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/**
 * Keyword-based planner used when no AI is configured, so the app stays
 * fully usable on a server without an API key.
 */
export function heuristicPlan(intentions: string, locale: Locale): GoalPlan {
  const text = intentions.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fr = locale === 'fr';
  const tags: GoalTag[] = [];
  const rules: NutrientRule[] = [];
  const focus: NutrientKey[] = [];
  const habits: PlanDraft['habits'] = [];
  let calorieMode: GoalPlan['calorieMode'] = 'maintain';
  let caloriePercent = 0;
  let proteinPerKg = 1.0;

  if (has(text, 'maigr', 'perdre', 'poids', 'mincir', 'seche', 'lose', 'weight', 'cut', 'fat loss')) {
    tags.push('lose_weight');
    calorieMode = 'deficit';
    caloriePercent = 15;
    proteinPerKg = 1.6;
    focus.push('kcal');
  }
  if (has(text, 'muscle', 'masse', 'prise', 'bulk', 'gain', 'muscu')) {
    tags.push('gain_muscle');
    calorieMode = 'surplus';
    caloriePercent = 10;
    proteinPerKg = 1.8;
    focus.push('protein');
    rules.push({ nutrient: 'protein', kind: 'min', value: 0, reason: fr ? 'Construire du muscle' : 'Build muscle' });
  }
  if (has(text, 'sucre', 'sugar', 'sucr', 'gateau', 'bonbon', 'soda')) {
    tags.push('reduce_sugar');
    focus.unshift('addedSugar');
    rules.push({
      nutrient: 'addedSugar',
      kind: 'max',
      value: 25,
      reason: fr ? "Recommandation de l'OMS : moins de 5 % de l'énergie" : 'WHO guidance: under 5% of energy',
    });
    habits.push({
      id: 'sweet-reflex',
      label: fr ? "Quand l'envie arrive, attendre 10 minutes avec un verre d'eau" : 'When a craving hits, wait 10 minutes with a glass of water',
      kind: 'do',
    });
  }
  if (has(text, 'fibre', 'fiber', 'transit', 'legume')) {
    tags.push('more_fiber');
    focus.push('fiber');
    rules.push({ nutrient: 'fiber', kind: 'min', value: 30, reason: fr ? 'Satiété et digestion' : 'Satiety and digestion' });
  }
  if (has(text, 'sel', 'salt', 'sodium', 'tension')) {
    tags.push('reduce_salt');
    focus.push('sodium');
    rules.push({ nutrient: 'sodium', kind: 'max', value: 2000, reason: fr ? "OMS : moins de 5 g de sel par jour" : 'WHO: under 5 g of salt a day' });
  }
  if (has(text, 'proteine', 'protein') && !tags.includes('gain_muscle')) {
    tags.push('more_protein');
    proteinPerKg = Math.max(proteinPerKg, 1.4);
    focus.push('protein');
  }
  if (!tags.length) {
    tags.push('eat_balanced');
    focus.push('kcal', 'protein');
  }

  // A protein "min" rule with value 0 means "derive from proteinPerKg": drop it.
  const draft: PlanDraft = {
    title: fr ? 'Mon plan' : 'My plan',
    summary: fr
      ? 'Plan établi à partir de tes mots-clés. Active l’IA sur le serveur pour un plan sur mesure.'
      : 'Plan built from your keywords. Enable AI on the server for a tailored plan.',
    tags,
    calorieMode,
    caloriePercent,
    proteinPerKg,
    fatPercent: 30,
    rules: rules.filter((r) => r.value > 0),
    focus: unique(focus).slice(0, 3),
    habits,
    coachTone: 'gentle',
    adjustForActivity: calorieMode !== 'maintain',
    activity: defaultActivityGoals({ tags }),
  };
  return planFromDraft(draft, intentions);
}
