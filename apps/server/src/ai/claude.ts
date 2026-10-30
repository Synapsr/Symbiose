import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GoalTagSchema, NUTRIENT_KEYS, ReviewSchema } from '@symbiose/shared';
import { z } from 'zod';

import { HttpError } from '../errors';
import { COACH, CRAVING, GOAL_PLANNER, MEAL_ANALYST, REVIEWER } from './prompts';
import type { Ai, MealAnalysisInput, UserContext } from './types';

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

const CravingOut = z.object({ tip: z.string(), alternative: z.string() });

type Effort = 'low' | 'medium' | 'high';

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

export function createClaudeAi(apiKey: string, model: string, workspaceId: string | null = null): Ai {
  const client = new Anthropic({
    apiKey,
    maxRetries: 2,
    timeout: 120_000,
    // Keys that aren't scoped to a workspace must name one on every request.
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });

  async function run<S extends z.ZodType>(opts: {
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: S;
    effort: Effort;
    history?: Anthropic.Beta.BetaMessageParam[];
  }): Promise<z.infer<S>> {
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
      if (response.stop_reason === 'refusal') {
        throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw new HttpError(424, 'ai_bad_output', 'The AI returned an incomplete answer, please retry');
      }
      return response.parsed_output as z.infer<S>;
    } catch (error) {
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
      return run({ system: MEAL_ANALYST, content, schema: MealAnalysisOut, effort: 'medium' });
    },

    async draftPlan(input) {
      const ctx: UserContext = { locale: input.locale, profile: input.profile, plan: input.previousPlan, targets: null };
      const text = `${contextBlock(ctx)}\n\nMy goals, in my own words:\n${input.intentions}`;
      return run({ system: GOAL_PLANNER, content: [{ type: 'text', text }], schema: PlanOut, effort: 'medium' });
    },

    async coach(input, onText) {
      const history: Anthropic.Beta.BetaMessageParam[] = input.history.map((turn) => ({ role: turn.role, content: turn.content }));
      const text = `${contextBlock(input, { today: input.today, last7Days: input.week })}\n\n${input.message}`;
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: COACH, cache_control: { type: 'ephemeral' } }],
          messages: [...history, { role: 'user', content: [{ type: 'text', text }] }],
          tools: [PLAN_CHANGE_TOOL],
          tool_choice: { type: 'auto' },
          output_config: { effort: 'low' },
        });
        if (onText) stream.on('text', (delta) => onText(delta));
        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal') {
          throw new HttpError(422, 'ai_refused', 'The AI declined to answer this request');
        }
        const reply = message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('')
          .trim();
        // Eager tool input streaming skips server-side validation: validate here.
        const call = message.content.find((block) => block.type === 'tool_use' && block.name === PLAN_CHANGE_TOOL.name);
        const parsed = call?.type === 'tool_use' ? PlanChange.safeParse(call.input) : null;
        const planChange = parsed?.success ? parsed.data : null;
        if (!reply && !planChange) throw new HttpError(424, 'ai_bad_output', 'The AI returned an empty answer, please retry');
        return { reply: reply || planChange!.rationale, planChange };
      } catch (error) {
        throw mapError(error);
      }
    },

    async cravingTip(input) {
      const text = `${contextBlock(input, { localTime: input.localTime })}\n\nI'm craving: ${input.what} (intensity ${input.intensity}/3)`;
      return run({ system: CRAVING, content: [{ type: 'text', text }], schema: CravingOut, effort: 'low' });
    },

    async review(input) {
      const { days, ...stats } = input.insights;
      const compactDays = days.map((d) => ({
        date: d.date,
        logged: d.logged,
        kcal: d.totals.kcal,
        kcalTarget: d.kcalTarget,
        ...Object.fromEntries(input.insights.focus.map((k) => [k, d.totals[k]])),
      }));
      const text = `${contextBlock(input, { stats, days: compactDays })}\n\nWrite my review for this period.`;
      return run({ system: REVIEWER, content: [{ type: 'text', text }], schema: ReviewSchema, effort: 'medium' });
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
  };
}
