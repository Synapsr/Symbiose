import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ReviewSchema } from '@symbiose/shared';
import type { z } from 'zod';

import { HttpError } from '../errors';
import { COACH, CRAVING, GOAL_PLANNER, MEAL_ANALYST, MORNING, NUDGES, REVIEWER } from './prompts';
import {
  COACH_TOOLS,
  coachOutput,
  coachText,
  cravingOutput,
  cravingText,
  type Effort,
  incomplete,
  MealAnalysisOut,
  mealText,
  morningOutput,
  morningText,
  NudgesOut,
  nudgesText,
  PlanOut,
  planText,
  refused,
  reviewText,
  usageMeter,
} from './shared';
import type { Ai, AiFeature, AiUsageListener, MealAnalysisInput } from './types';

// Kept here for the modules and tests that import them from the Claude adapter.
export { createDisabledAi, parseCravingAdvice } from './shared';

/** Strict, and streamed as they are written: the inputs are validated after the reply. */
const TOOLS: Anthropic.Beta.BetaTool[] = COACH_TOOLS.map((tool) => ({ ...tool, strict: true, eager_input_streaming: true }));

const tokens = (usage: Anthropic.Beta.BetaUsage) => ({
  inputTokens: usage.input_tokens ?? 0,
  outputTokens: usage.output_tokens ?? 0,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
});

const textOf = (message: Anthropic.Beta.BetaMessage) => message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');

export function createClaudeAi(apiKey: string, model: string, workspaceId: string | null = null, onUsage?: AiUsageListener): Ai {
  const client = new Anthropic({
    apiKey,
    maxRetries: 2,
    timeout: 120_000,
    // Keys that aren't scoped to a workspace must name one on every request.
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined,
  });
  const usage = usageMeter('anthropic', model, mapError, onUsage);

  /** Reports each call once: answered (tokens were billed, even for a refusal) or failed. */
  function meter(feature: AiFeature) {
    const call = usage(feature);
    return {
      answered: (message: { model: string; usage: Anthropic.Beta.BetaUsage }) => call.answered(tokens(message.usage), message.model),
      failed: call.failed,
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
      if (response.stop_reason === 'refusal') throw refused();
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw incomplete();
      return response.parsed_output as z.infer<S>;
    } catch (error) {
      meterCall.failed(error);
      throw mapError(error);
    }
  }

  /** A streamed answer: its text goes through `onText` as it is written. */
  async function stream(
    feature: AiFeature,
    params: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; maxTokens: number; tools?: Anthropic.Beta.BetaTool[] },
    onText?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<Anthropic.Beta.BetaMessage> {
    const meterCall = meter(feature);
    try {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: params.maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
          messages: params.messages,
          ...(params.tools ? { tools: params.tools, tool_choice: { type: 'auto' as const } } : {}),
          output_config: { effort: 'low' },
        },
        signal ? { signal } : undefined,
      );
      if (onText) stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      meterCall.answered(message);
      if (message.stop_reason === 'refusal') throw refused();
      return message;
    } catch (error) {
      meterCall.failed(error);
      throw mapError(error);
    }
  }

  return {
    enabled: true,
    model,
    provider: 'anthropic',

    async analyzeMeal(input: MealAnalysisInput) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (input.photo) {
        content.push({ type: 'image', source: { type: 'base64', media_type: input.photo.mime, data: input.photo.base64 } });
      }
      content.push({ type: 'text', text: mealText(input) });
      return run({ feature: 'meal', system: MEAL_ANALYST, content, schema: MealAnalysisOut, effort: 'medium' });
    },

    async draftPlan(input) {
      return run({ feature: 'plan', system: GOAL_PLANNER, content: [{ type: 'text', text: planText(input) }], schema: PlanOut, effort: 'medium' });
    },

    async coach(input, onText) {
      const history: Anthropic.Beta.BetaMessageParam[] = input.history.map((turn) => ({ role: turn.role, content: turn.content }));
      const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user', content: [{ type: 'text', text: coachText(input) }] }];
      const message = await stream('coach', { system: COACH, messages, maxTokens: 16000, tools: TOOLS }, onText);
      // Eager tool input streaming skips server-side validation: `coachOutput` validates.
      const calls = message.content.flatMap((block) => (block.type === 'tool_use' ? [{ name: block.name, input: block.input }] : []));
      return coachOutput(textOf(message), calls);
    },

    async cravingTip(input, onText, signal) {
      // Plain text, streamed: the tip shows up while it is written, the buttons never wait for it.
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: cravingText(input) }] }];
      return cravingOutput(textOf(await stream('craving', { system: CRAVING, messages, maxTokens: 2000 }, onText, signal)));
    },

    async review(input) {
      return run({ feature: 'review', system: REVIEWER, content: [{ type: 'text', text: reviewText(input) }], schema: ReviewSchema, effort: 'medium' });
    },

    async morning(input, onText) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [{ type: 'text', text: morningText(input) }] }];
      return morningOutput(textOf(await stream('morning', { system: MORNING, messages, maxTokens: 2000 }, onText)));
    },

    async cravingNudges(input) {
      return run({ feature: 'nudges', system: NUDGES, content: [{ type: 'text', text: nudgesText(input) }], schema: NudgesOut, effort: 'low' });
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
