import { GoalTagSchema, NUTRIENT_KEYS, roundNutrients, type FoodItem } from '@symbiose/shared';
import { z } from 'zod';

import { HttpError } from '../errors';
import type {
  Ai,
  AiFeature,
  AiUsage,
  AiUsageListener,
  BloodPressureBrief,
  CoachInput,
  CoachOutput,
  CravingInput,
  CravingOutput,
  EnergyExpenditureBrief,
  JournalBrief,
  MealAnalysisInput,
  MealPhoto,
  MorningInput,
  NudgesInput,
  PlanDraftInput,
  RecoveryBrief,
  ReviewInput,
  UserContext,
} from './types';

/**
 * What every provider shares: the output schemas, the coach's tools, the
 * context each feature sends, and how answers are checked. The adapters
 * (`claude.ts`, `openai.ts`) only speak their API.
 */

// Structured-output schemas. Kept free of numeric bounds: the server clamps
// and validates everything afterwards.
const NutrientsOut = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  sugar: z.number(),
  addedSugar: z.number(),
  fat: z.number(),
  satFat: z.number(),
  fiber: z.number(),
  sodium: z.number(),
});

const MealTypeOut = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const NutrientKeyOut = z.enum(NUTRIENT_KEYS);

// The past meal reused comes first (its items follow from it), the courses' names before the items.
export const MealAnalysisOut = z.object({
  isFood: z.boolean(),
  reusedMeal: z.string().nullable(),
  title: z.string(),
  mealType: MealTypeOut,
  courses: z.array(z.string()),
  items: z.array(
    z.object({
      name: z.string(),
      emoji: z.string(),
      portion: z.string(),
      grams: z.number(),
      confidence: z.number(),
      per100g: NutrientsOut,
      course: z.number(),
    }),
  ),
  verdict: z.enum(['great', 'good', 'ok', 'watch']),
  headline: z.string(),
  tips: z.array(z.string()),
  clarification: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
});

export const PlanOut = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(GoalTagSchema),
  calorieMode: z.enum(['maintain', 'deficit', 'surplus']),
  caloriePercent: z.number(),
  proteinPerKg: z.number(),
  fatPercent: z.number(),
  rules: z.array(
    z.object({
      nutrient: NutrientKeyOut,
      kind: z.enum(['max', 'min']),
      value: z.number(),
      reason: z.string(),
    }),
  ),
  focus: z.array(NutrientKeyOut),
  habits: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['avoid', 'do']) })),
  coachTone: z.enum(['gentle', 'direct', 'scientific']),
  adjustForActivity: z.boolean(),
  activity: z.object({
    weeklyActiveMinutes: z.number(),
    dailySteps: z.number().nullable(),
    weeklyStrengthSessions: z.number().nullable(),
  }),
});

export const NudgesOut = z.object({ lines: z.array(z.string()) });

const PlanChange = z.object({ intentions: z.string().min(1), rationale: z.string() });

const MealAction = z.object({
  action: z.enum(['add', 'edit', 'delete']),
  mealId: z.string().nullable(),
  description: z.string(),
  mealType: MealTypeOut.nullable(),
  localDate: z.string().nullable(),
  time: z.string().nullable(),
  summary: z.string().min(1),
});

/** A tool the coach may call, as JSON Schema; each adapter adds its API's options. */
export interface CoachTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

/** The coach streams prose; a plan change comes as a tool call after the reply. */
export const PLAN_CHANGE_TOOL: CoachTool = {
  name: 'propose_plan_change',
  description:
    'Propose updated goals when the person asks to change their goals or states a new goal or constraint. The app shows the proposal and asks them to confirm.',
  input_schema: {
    type: 'object',
    properties: {
      intentions: { type: 'string', description: 'Their full updated intentions, first person, merging the existing intentions with the change.' },
      rationale: { type: 'string', description: 'One sentence explaining the change.' },
    },
    required: ['intentions', 'rationale'],
    additionalProperties: false,
  },
};

/** Called once per meal, after the reply; the app asks the person to confirm each one. */
export const MEAL_ACTION_TOOL: CoachTool = {
  name: 'propose_meal_action',
  description:
    'Propose adding, editing or deleting a logged meal, only when the person asks for it or clearly says they ate something and want it noted. The app shows each proposal as a card and changes nothing until they confirm. One call per meal, at most 5 per reply.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'edit', 'delete'] },
      mealId: { type: ['string', 'null'], description: 'edit and delete: the `id` of a meal listed in `recentMeals`, never invented. Null for add.' },
      description: {
        type: 'string',
        description:
          'add: what they ate, in their words, with quantities ("un yaourt nature avec une cuillère de miel"). edit: the correction in plain words ("la portion de riz était plutôt 150 g", "c’était du coca zéro"), or "" when only the type, day or time changes. delete: "".',
      },
      mealType: { anyOf: [{ type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] }, { type: 'null' }], description: 'When they said it or it is clear; null to infer it (add) or keep it (edit).' },
      localDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }], description: 'YYYY-MM-DD when the meal is on another day than today ("hier soir"); null for today (add) or to keep it (edit).' },
      time: { type: ['string', 'null'], description: 'Local time as HH:mm when they said it or it is clear; null for now (add) or to keep it (edit).' },
      summary: { type: 'string', description: 'One short line for the confirmation card, in their language, e.g. "Ajouter : yaourt nature + miel, 16 h".' },
    },
    required: ['action', 'mealId', 'description', 'mealType', 'localDate', 'time', 'summary'],
    additionalProperties: false,
  },
};

export const COACH_TOOLS = [PLAN_CHANGE_TOOL, MEAL_ACTION_TOOL];

/** "tip\nalternative" → both, without the labels or list markers a model sometimes adds anyway. */
export function parseCravingAdvice(text: string): { tip: string; alternative: string } {
  const lines = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^\**(?:tip|conseil|astuce|alternative)\**\s*[:：]\s*\**/i, '')
        .trim(),
    )
    .filter(Boolean);
  return { tip: lines[0] ?? '', alternative: lines.slice(1).join(' ') };
}

export type Effort = 'low' | 'medium' | 'high';

/** Blood pressure only enters the context for people who opted in and have readings. */
const bloodPressureExtra = (brief: BloodPressureBrief | null) => (brief ? { bloodPressure: brief } : {});
/** Measured expenditure only enters once estimated, or when the budget follows it. */
const expenditureExtra = (brief: EnergyExpenditureBrief | null) => (brief ? { energyExpenditure: brief } : {});
/** The health journal only enters when there are notes. */
const journalExtra = (brief: JournalBrief | null) => (brief ? { journal: brief } : {});
/** Recovery only enters when the vitals are reliable. */
const recoveryExtra = (brief: RecoveryBrief | null) => (brief ? { recovery: brief } : {});

function contextBlock(ctx: UserContext, extra: Record<string, unknown> = {}): string {
  const payload = {
    locale: ctx.locale,
    profile: ctx.profile
      ? {
          sex: ctx.profile.sex,
          age: new Date().getFullYear() - ctx.profile.birthYear,
          heightCm: ctx.profile.heightCm,
          weightKg: ctx.profile.weightKg,
          activityLevel: ctx.profile.activityLevel,
        }
      : null,
    goals: ctx.plan
      ? {
          intentions: ctx.plan.intentions,
          title: ctx.plan.title,
          focus: ctx.plan.focus,
          rules: ctx.plan.rules,
          habits: ctx.plan.habits.map((h) => h.label),
          coachTone: ctx.plan.coachTone,
        }
      : null,
    dailyTargets: ctx.targets
      ? Object.fromEntries(Object.entries(ctx.targets).map(([k, t]) => [k, `${t.kind} ${t.value}`]))
      : null,
    ...extra,
  };
  return `<context>\n${JSON.stringify(payload, null, 1)}\n</context>`;
}

// What each feature sends after the system prompt. The meal's photo, when
// there is one, goes before this text.

const previousItem = (i: FoodItem) => ({ name: i.name, portion: i.portion, grams: i.grams, per100g: i.per100g });

/** Said before each photo of a correction in courses, so the AI knows which course it shows. */
export const photoCaption = (photo: MealPhoto): string | null => (photo.course ? `Photo of course ${photo.course}:` : null);

export function mealText(input: MealAnalysisInput): string {
  const extra: Record<string, unknown> = {
    localTime: input.localTime,
    mealTypeHint: input.mealTypeHint,
    alreadyEatenToday: input.dayTotalsBefore,
  };
  if (input.recentWorkout) extra.recentWorkout = input.recentWorkout;
  if (input.activityToday) extra.activityToday = input.activityToday;
  if (input.bloodPressureCategory) extra.bloodPressureCategory = input.bloodPressureCategory;
  if (input.meal) {
    extra.meal = { title: input.meal.title, courses: input.meal.courses.map((c) => ({ ...c, nutrients: roundNutrients(c.nutrients) })) };
  }
  if (input.assessOnly) extra.assessOnly = true;
  if (input.previous) {
    const { title, items, courses } = input.previous;
    extra.previousAnalysis = courses?.length
      ? { title, courses: courses.map((c) => ({ course: c.course, label: c.label, time: c.time, ...(c.text ? { text: c.text } : {}), items: c.items.map(previousItem) })) }
      : { title, items: items.map(previousItem) };
  }
  if (input.history) {
    extra.today = input.history.today;
    extra.history = input.history.meals;
  }
  const lines = [contextBlock(input, extra)];
  if (input.text) lines.push(`${input.meal ? 'Next course' : 'What I ate'}: ${input.text}`);
  if (input.correction) lines.push(`Correction to apply: ${input.correction}`);
  if (input.assessOnly) lines.push('Assess this meal as a whole.');
  else if (!input.text && !input.correction) lines.push(input.meal ? 'Analyse this next course.' : 'Analyse this meal.');
  return lines.join('\n\n');
}

export function planText(input: PlanDraftInput): string {
  const ctx: UserContext = { locale: input.locale, profile: input.profile, plan: input.previousPlan, targets: null };
  const weight = { latestKg: input.weight.latest?.kg ?? null, changeKgOver90Days: input.weight.changeKg, readings: input.weight.points.length };
  return `${contextBlock(ctx, { weightTrend: weight, ...bloodPressureExtra(input.bloodPressure) })}\n\nMy goals, in my own words:\n${input.intentions}`;
}

/** The latest message with its context; the earlier turns go before it as they are. */
export function coachText(input: CoachInput): string {
  const extra = {
    today: input.today,
    recentMeals: input.recentMeals,
    last7Days: input.week,
    ...bloodPressureExtra(input.bloodPressure),
    ...expenditureExtra(input.energyExpenditure),
    ...input.life,
    ...journalExtra(input.journal),
    ...recoveryExtra(input.recovery),
  };
  return `${contextBlock(input, extra)}\n\n${input.message}`;
}

export function cravingText(input: CravingInput): string {
  const craving = input.what ? `I'm craving: ${input.what}` : "I'm having a craving (I didn't say what).";
  return `${contextBlock(input, { localTime: input.localTime, activityToday: input.activityToday, ...input.life })}\n\n${craving}${input.intensity ? ` Intensity ${input.intensity}/3.` : ''}`;
}

export function reviewText(input: ReviewInput): string {
  // The briefs replace the daily blood pressure points and the full expenditure block; the life modules' days join the compact days.
  const { days, activity, bloodPressure: _trend, adaptiveEnergy: _adaptive, sleep, hydration, mood, ...rest } = input.insights;
  const { days: activityDays, ...activityStats } = activity;
  const moves = new Map(activityDays.map((d) => [d.date, d]));
  const asleep = new Map(sleep?.nights.map((n) => [n.localDate, n.asleepMin]));
  const water = new Map(hydration?.days.map((d) => [d.date, d.ml]));
  const moods = new Map(mood?.days.map((d) => [d.date, d]));
  const compactDays = days.map((d) => ({
    date: d.date,
    logged: d.logged,
    kcal: d.totals.kcal,
    kcalTarget: d.kcalTarget,
    ...Object.fromEntries(input.insights.focus.map((k) => [k, d.totals[k]])),
    activeMinutes: moves.get(d.date)?.activeMinutes ?? 0,
    steps: moves.get(d.date)?.steps ?? null,
    workouts: moves.get(d.date)?.workouts ?? 0,
    ...(sleep ? { asleepMin: asleep.get(d.date) ?? null } : {}),
    ...(hydration ? { waterMl: water.get(d.date) ?? 0 } : {}),
    ...(mood ? { mood: moods.get(d.date)?.mood ?? null, ...(moods.get(d.date)?.note ? { moodNote: moods.get(d.date)!.note } : {}) } : {}),
  }));
  const life = {
    ...(sleep ? { sleep: { averageMin: sleep.averageMin, bedtime: sleep.bedtime, wakeTime: sleep.wakeTime, regularityMin: sleep.regularityMin, cravingsAfterShortNights: sleep.cravingsAfterShortNights } } : {}),
    ...(hydration ? { hydration: { averageMl: hydration.averageMl, goalMl: hydration.days.at(-1)?.goalMl, daysReached: hydration.daysReached, daysLogged: hydration.daysLogged } } : {}),
    ...(mood ? { mood: { average: mood.average, checkIns: mood.days.length, link: mood.link, persistentLow: mood.persistentLow } } : {}),
  };
  const stats = { ...rest, activity: activityStats, ...life };
  return `${contextBlock(input, { stats, days: compactDays, ...bloodPressureExtra(input.bloodPressure), ...expenditureExtra(input.energyExpenditure), ...journalExtra(input.journal) })}\n\nWrite my review for this period.`;
}

export function morningText(input: MorningInput): string {
  const { locale: _l, profile: _p, plan: _pl, targets: _t, ...data } = input;
  return `${contextBlock(input, data)}\n\nWrite my morning check-in for ${input.date}.`;
}

export function nudgesText(input: NudgesInput): string {
  const { locale: _l, profile: _p, plan: _pl, targets: _t, ...data } = input;
  return `${contextBlock(input, data)}\n\nWrite this week's nudges.`;
}

// Answers the app can't use.
export const refused = () => new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
export const incomplete = () => new HttpError(424, 'ai_bad_output', 'The AI returned an incomplete answer, please retry');
export const emptyAnswer = () => new HttpError(424, 'ai_bad_output', 'The AI returned an empty answer, please retry');

/** The coach's answer from its prose and tool calls. Tool inputs are validated here, whatever the provider promised. */
export function coachOutput(text: string, calls: { name: string; input: unknown }[]): CoachOutput {
  const reply = text.trim();
  const inputs = (name: string) => calls.flatMap((call) => (call.name === name ? [call.input] : []));
  const parsed = PlanChange.safeParse(inputs(PLAN_CHANGE_TOOL.name)[0]);
  const planChange = parsed.success ? parsed.data : null;
  const mealActions = inputs(MEAL_ACTION_TOOL.name).flatMap((input) => {
    const action = MealAction.safeParse(input);
    return action.success ? [action.data] : [];
  });
  const fallback = planChange?.rationale ?? mealActions[0]?.summary;
  if (!reply && !fallback) throw emptyAnswer();
  return { reply: reply || fallback!, planChange, mealActions };
}

export function cravingOutput(text: string): CravingOutput {
  const advice = parseCravingAdvice(text);
  if (!advice.tip) throw emptyAnswer();
  return advice;
}

export function morningOutput(text: string): { text: string } {
  const reply = text.trim();
  if (!reply) throw emptyAnswer();
  return { text: reply };
}

export type TokenCounts = Pick<AiUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>;

const NO_TOKENS: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Reports each call once: answered (tokens were billed, even for a refusal)
 * or failed, with the code the app would get. Metering never breaks an answer.
 */
export function usageMeter(provider: string, model: string, mapError: (error: unknown) => unknown, onUsage?: AiUsageListener) {
  return (feature: AiFeature) => {
    const started = Date.now();
    let reported = false;
    const report = (tokens: TokenCounts, answeredBy: string, error?: unknown) => {
      if (reported || !onUsage) return;
      reported = true;
      try {
        onUsage({
          feature,
          provider,
          model: answeredBy,
          ...tokens,
          durationMs: Date.now() - started,
          ok: error === undefined,
          ...(error === undefined ? {} : { error: (mapError(error) as { code?: string }).code ?? 'ai_error' }),
        });
      } catch {
        // Metering never breaks an answer.
      }
    };
    return {
      answered: (tokens: TokenCounts, answeredBy: string) => report(tokens, answeredBy),
      failed: (error: unknown) => report(NO_TOKENS, model, error),
    };
  };
}

/** Used when the AI isn't configured: every AI feature answers 424 `ai_disabled`. */
export function createDisabledAi(hint = 'set ANTHROPIC_API_KEY'): Ai {
  const fail = async (): Promise<never> => {
    throw new HttpError(424, 'ai_disabled', `AI is not configured on this server (${hint})`);
  };
  return {
    enabled: false,
    model: null,
    provider: null,
    analyzeMeal: fail,
    draftPlan: fail,
    coach: fail,
    cravingTip: fail,
    review: fail,
    morning: fail,
    cravingNudges: fail,
  };
}
