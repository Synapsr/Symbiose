import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GoalTagSchema, NUTRIENT_KEYS, ReviewSchema } from '@symbiose/shared';
import { z } from 'zod';

import { HttpError } from '../errors';
import { COACH, CRAVING, GOAL_PLANNER, MEAL_ANALYST, MORNING, NUDGES, REVIEWER } from './prompts';
import type { Ai, AiFeature, AiUsageListener, BloodPressureBrief, EnergyExpenditureBrief, JournalBrief, MealAnalysisInput, RecoveryBrief, UserContext } from './types';

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

const MealAnalysisOut = z.object({
  isFood: z.boolean(),
  title: z.string(),
  mealType: MealTypeOut,
  items: z.array(
    z.object({
      name: z.string(),
      emoji: z.string(),
      portion: z.string(),
      grams: z.number(),
      confidence: z.number(),
      per100g: NutrientsOut,
    }),
  ),
  verdict: z.enum(['great', 'good', 'ok', 'watch']),
  headline: z.string(),
  tips: z.array(z.string()),
  clarification: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
});

const PlanOut = z.object({
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

const PlanChange = z.object({ intentions: z.string().min(1), rationale: z.string() });

/** The coach streams prose; a plan change comes as a tool call after the reply. */
const PLAN_CHANGE_TOOL: Anthropic.Beta.BetaTool = {
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
  strict: true,
  eager_input_streaming: true,
};

const MealAction = z.object({
  action: z.enum(['add', 'edit', 'delete']),
  mealId: z.string().nullable(),
  description: z.string(),
  mealType: MealTypeOut.nullable(),
  localDate: z.string().nullable(),
  time: z.string().nullable(),
  summary: z.string().min(1),
});

/** Called once per meal, after the reply; the app asks the person to confirm each one. */
const MEAL_ACTION_TOOL: Anthropic.Beta.BetaTool = {
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
  strict: true,
  eager_input_streaming: true,
};

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
const NudgesOut = z.object({ lines: z.array(z.string()) });

type Effort = 'low' | 'medium' | 'high';

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

export function createClaudeAi(apiKey: string, model: string, workspaceId: string | null = null, onUsage?: AiUsageListener): Ai {
  const client = new Anthropic({
    apiKey,
    maxRetries: 2,
    timeout: 120_000,
    // Keys that aren't scoped to a workspace must name one on every request.
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });

  /** Reports each call once: answered (tokens were billed, even for a refusal) or failed. */
  function meter(feature: AiFeature) {
    const started = Date.now();
    let reported = false;
    const report = (usage: Anthropic.Beta.BetaUsage | null, answeredBy: string, error?: unknown) => {
      if (reported || !onUsage) return;
      reported = true;
      try {
        onUsage({
          feature,
          provider: 'anthropic',
          model: answeredBy,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
          durationMs: Date.now() - started,
          ok: error === undefined,
          ...(error === undefined ? {} : { error: (mapError(error) as { code?: string }).code ?? 'ai_error' }),
        });
      } catch {
        // Metering never breaks an answer.
      }
    };
    return {
      answered: (message: { model: string; usage: Anthropic.Beta.BetaUsage }) => report(message.usage, message.model),
      failed: (error: unknown) => report(null, model, error),
    };
  }

  async function run<S extends z.ZodType>(opts: {
    feature: AiFeature;
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: S;
    effort: Effort;
    history?: Anthropic.Beta.BetaMessageParam[];
  }): Promise<z.infer<S>> {
    const meterCall = meter(opts.feature);
    try {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        // On a safety decline, the API retries on Anthropic's recommended fallback model.
        fallbacks: 'default',
        system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
        messages: [...(opts.history ?? []), { role: 'user', content: opts.content }],
        output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      });
      meterCall.answered(response);
      if (response.stop_reason === 'refusal') {
        throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw new HttpError(424, 'ai_bad_output', 'The AI returned an incomplete answer, please retry');
      }
      return response.parsed_output as z.infer<S>;
    } catch (error) {
      meterCall.failed(error);
      throw mapError(error);
    }
  }

  return {
    enabled: true,
    model,

    async analyzeMeal(input: MealAnalysisInput) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (input.photo) {
        content.push({ type: 'image', source: { type: 'base64', media_type: input.photo.mime, data: input.photo.base64 } });
      }
      const extra: Record<string, unknown> = {
        localTime: input.localTime,
        mealTypeHint: input.mealTypeHint,
        alreadyEatenToday: input.dayTotalsBefore,
      };
      if (input.recentWorkout) extra.recentWorkout = input.recentWorkout;
      if (input.activityToday) extra.activityToday = input.activityToday;
      if (input.bloodPressureCategory) extra.bloodPressureCategory = input.bloodPressureCategory;
      if (input.previous) {
        extra.previousAnalysis = {
          title: input.previous.title,
          items: input.previous.items.map((i) => ({ name: i.name, portion: i.portion, grams: i.grams, per100g: i.per100g })),
        };
      }
      const lines = [contextBlock(input, extra)];
      if (input.text) lines.push(`What I ate: ${input.text}`);
      if (input.correction) lines.push(`Correction to apply: ${input.correction}`);
      if (!input.text && !input.correction) lines.push('Analyse this meal.');
      content.push({ type: 'text', text: lines.join('\n\n') });
      return run({ feature: 'meal', system: MEAL_ANALYST, content, schema: MealAnalysisOut, effort: 'medium' });
    },

    async draftPlan(input) {
      const ctx: UserContext = { locale: input.locale, profile: input.profile, plan: input.previousPlan, targets: null };
      const weight = { latestKg: input.weight.latest?.kg ?? null, changeKgOver90Days: input.weight.changeKg, readings: input.weight.points.length };
      const text = `${contextBlock(ctx, { weightTrend: weight, ...bloodPressureExtra(input.bloodPressure) })}\n\nMy goals, in my own words:\n${input.intentions}`;
      return run({ feature: 'plan', system: GOAL_PLANNER, content: [{ type: 'text', text }], schema: PlanOut, effort: 'medium' });
    },

    async coach(input, onText) {
      const history: Anthropic.Beta.BetaMessageParam[] = input.history.map((turn) => ({ role: turn.role, content: turn.content }));
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
      const text = `${contextBlock(input, extra)}\n\n${input.message}`;
      const meterCall = meter('coach');
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: COACH, cache_control: { type: 'ephemeral' } }],
          messages: [...history, { role: 'user', content: [{ type: 'text', text }] }],
          tools: [PLAN_CHANGE_TOOL, MEAL_ACTION_TOOL],
          tool_choice: { type: 'auto' },
          output_config: { effort: 'low' },
        });
        if (onText) stream.on('text', (delta) => onText(delta));
        const message = await stream.finalMessage();
        meterCall.answered(message);
        if (message.stop_reason === 'refusal') {
          throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
        }
        const reply = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('')
          .trim();
        // Eager tool input streaming skips server-side validation: validate here.
        const inputs = (name: string) => message.content.flatMap((block) => (block.type === 'tool_use' && block.name === name ? [block.input] : []));
        const parsed = PlanChange.safeParse(inputs(PLAN_CHANGE_TOOL.name)[0]);
        const planChange = parsed.success ? parsed.data : null;
        const mealActions = inputs(MEAL_ACTION_TOOL.name).flatMap((input) => {
          const action = MealAction.safeParse(input);
          return action.success ? [action.data] : [];
        });
        const fallback = planChange?.rationale ?? mealActions[0]?.summary;
        if (!reply && !fallback) throw new HttpError(424, 'ai_bad_output', 'The AI returned an empty answer, please retry');
        return { reply: reply || fallback!, planChange, mealActions };
      } catch (error) {
        meterCall.failed(error);
        throw mapError(error);
      }
    },

    async cravingTip(input, onText, signal) {
      const craving = input.what ? `I'm craving: ${input.what}` : "I'm having a craving (I didn't say what).";
      const text = `${contextBlock(input, { localTime: input.localTime, activityToday: input.activityToday, ...input.life })}\n\n${craving}${input.intensity ? ` Intensity ${input.intensity}/3.` : ''}`;
      const meterCall = meter('craving');
      try {
        // Plain text, streamed: the tip shows up while it is written, the buttons never wait for it.
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 2000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: [{ type: 'text', text: CRAVING, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: [{ type: 'text', text }] }],
            output_config: { effort: 'low' },
          },
          { signal },
        );
        if (onText) stream.on('text', (delta) => onText(delta));
        const message = await stream.finalMessage();
        meterCall.answered(message);
        if (message.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
        const advice = parseCravingAdvice(message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''));
        if (!advice.tip) throw new HttpError(424, 'ai_bad_output', 'The AI returned an empty answer, please retry');
        return advice;
      } catch (error) {
        meterCall.failed(error);
        throw mapError(error);
      }
    },

    async review(input) {
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
      const text = `${contextBlock(input, { stats, days: compactDays, ...bloodPressureExtra(input.bloodPressure), ...expenditureExtra(input.energyExpenditure), ...journalExtra(input.journal) })}\n\nWrite my review for this period.`;
      return run({ feature: 'review', system: REVIEWER, content: [{ type: 'text', text }], schema: ReviewSchema, effort: 'medium' });
    },

    async morning(input, onText) {
      const { locale: _l, profile: _p, plan: _pl, targets: _t, ...data } = input;
      const text = `${contextBlock(input, data)}\n\nWrite my morning check-in for ${input.date}.`;
      const meterCall = meter('morning');
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 2000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: MORNING, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [{ type: 'text', text }] }],
          output_config: { effort: 'low' },
        });
        if (onText) stream.on('text', (delta) => onText(delta));
        const message = await stream.finalMessage();
        meterCall.answered(message);
        if (message.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
        const reply = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('')
          .trim();
        if (!reply) throw new HttpError(424, 'ai_bad_output', 'The AI returned an empty answer, please retry');
        return { text: reply };
      } catch (error) {
        meterCall.failed(error);
        throw mapError(error);
      }
    },

    async cravingNudges(input) {
      const { locale: _l, profile: _p, plan: _pl, targets: _t, ...data } = input;
      const text = `${contextBlock(input, data)}\n\nWrite this week's nudges.`;
      return run({ feature: 'nudges', system: NUDGES, content: [{ type: 'text', text }], schema: NudgesOut, effort: 'low' });
    },
  };
}

// AI failures use 424 (failed dependency): proxies like Traefik replace 502/503
// bodies with their own HTML pages, and the app needs the JSON error.
function mapError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(424, 'ai_misconfigured', 'The server AI key is invalid');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'ai_rate_limited', 'The AI is busy, retry in a moment');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new HttpError(424, 'ai_bad_request', error.message);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new HttpError(424, 'ai_unreachable', 'Could not reach the AI provider');
  }
  if (error instanceof Anthropic.APIError) {
    return new HttpError(424, 'ai_error', `AI provider error (${error.status ?? 'unknown'})`);
  }
  return error;
}

/** Used when no API key is configured: every AI feature answers 503. */
export function createDisabledAi(): Ai {
  const fail = async (): Promise<never> => {
    throw new HttpError(424, 'ai_disabled', 'AI is not configured on this server (set ANTHROPIC_API_KEY)');
  };
  return {
    enabled: false,
    model: null,
    analyzeMeal: fail,
    draftPlan: fail,
    coach: fail,
    cravingTip: fail,
    review: fail,
    morning: fail,
    cravingNudges: fail,
  };
}
