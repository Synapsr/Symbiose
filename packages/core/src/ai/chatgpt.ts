import { ReviewSchema } from '@symbiose/shared';
import { zodTextFormat } from 'openai/helpers/zod';
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
  emptyAnswer,
  incomplete,
  MealAnalysisOut,
  mealText,
  morningOutput,
  morningText,
  NudgesOut,
  nudgesText,
  photoCaption,
  PlanOut,
  planText,
  refused,
  reviewText,
  type TokenCounts,
  usageMeter,
} from './shared';
import type { Ai, AiFeature, AiUsageListener } from './types';

/**
 * The person's ChatGPT plan, through « Sign in with ChatGPT » (plan usage for
 * open-source, locally hosted apps): OpenAI's Responses API with the OAuth
 * token of the person who signed in. The preview's rules: every request is
 * streamed and not stored, the system prompt goes in `instructions`, and some
 * fields are refused (max_output_tokens, temperature, metadata,
 * previous_response_id…), so none of them is sent.
 * https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
 */

export const CHATGPT_API = 'https://api.openai.com/v1';
/** OpenAI's example model; the account's own list (GET /v1/models) wins when it answers. */
export const CHATGPT_FALLBACK_MODEL = 'gpt-6.1-sol';

export interface ChatGptOptions {
  /** A valid access token; `fresh` asks for a new one (after a 401). Throws HttpError `ai_reconnect` when the person must sign in again. */
  accessToken: (options?: { fresh?: boolean }) => Promise<string>;
  /** The model chosen in settings; null: the first one the account lists. */
  model: string | null;
  fetch?: typeof fetch;
}

type InputContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'auto' };
type InputItem = { role: 'user' | 'assistant'; content: string | InputContent[] };

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

interface Outcome {
  text: string;
  calls: { name: string; input: unknown }[];
  refusal: string;
  usage: Usage | null;
  model: string | null;
}

/** What the plan's errors mean for the app (errors-and-recovery in OpenAI's docs). */
function planError(status: number, code: string | undefined, message: string | undefined): HttpError {
  const detail = message ?? code ?? `HTTP ${status}`;
  if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') {
    return new HttpError(429, 'ai_plan_limit', 'Your ChatGPT plan limit is reached for now');
  }
  if (code === 'subscription_sharing_user_not_eligible') {
    return new HttpError(424, 'ai_not_eligible', 'This ChatGPT plan cannot be used in other apps');
  }
  if (code === 'subscription_sharing_invalid_user' || status === 401) {
    return new HttpError(424, 'ai_reconnect', 'Sign in to ChatGPT again');
  }
  if (status === 403) return new HttpError(424, 'ai_not_eligible', `ChatGPT refused the request: ${detail}`);
  if (status === 429) return new HttpError(429, 'ai_rate_limited', 'The AI is busy, retry in a moment');
  if (status === 400 || status === 422) return new HttpError(424, 'ai_bad_request', detail);
  return new HttpError(424, 'ai_error', `AI provider error (${status || code || 'unknown'})`);
}

function tokens(usage: Usage | null): TokenCounts {
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached),
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}

/** Server-sent events: each block has an `event:` and a `data:` line. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const event = /^event: ?(.*)$/m.exec(block)?.[1] ?? String(parsed.type ?? '');
        yield { event, data: parsed };
      } catch {
        // Not JSON: a keep-alive or a comment.
      }
    }
    if (done) return;
  }
}

/** The plan's AI, and a check that the plan can be used here (right after signing in). */
export type ChatGptAi = Ai & {
  /** One tiny request: resolves when the plan answers, throws `ai_not_eligible`, `ai_plan_limit`… otherwise. */
  ping(): Promise<void>;
};

export function createChatGptAi(options: ChatGptOptions, onUsage?: AiUsageListener): ChatGptAi {
  const fetchImpl = options.fetch ?? fetch;
  let model = options.model;
  /** `text.format` refused by the plan's API: structured answers then come as a forced function call. */
  let formatAsTool = false;

  async function currentModel(): Promise<string> {
    if (model) return model;
    try {
      const res = await fetchImpl(`${CHATGPT_API}/models`, { headers: { authorization: `Bearer ${await options.accessToken()}` } });
      const body = (await res.json()) as { models?: { id?: string; slug?: string; visibility?: string }[]; data?: { id?: string }[] };
      const listed = (body.models ?? []).filter((m) => (m.visibility ?? 'list') === 'list').map((m) => m.id ?? m.slug);
      model = listed.find(Boolean) ?? body.data?.[0]?.id ?? CHATGPT_FALLBACK_MODEL;
    } catch {
      model = CHATGPT_FALLBACK_MODEL;
    }
    return model;
  }

  const meterFor = (name: string) => usageMeter('chatgpt', name, (error) => error, onUsage);

  /** Sends one request (again once with a fresh token after a 401) and reads its stream to the end. */
  async function run(body: Record<string, unknown>, onText?: (delta: string) => void, signal?: AbortSignal): Promise<Outcome> {
    const send = async (fresh: boolean) => {
      try {
        return await fetchImpl(`${CHATGPT_API}/responses`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await options.accessToken({ fresh })}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ ...body, stream: true, store: false }),
          signal,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (signal?.aborted) throw error;
        throw new HttpError(424, 'ai_unreachable', 'Could not reach ChatGPT');
      }
    };
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (!res.ok || !res.body) {
      const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw planError(res.status, payload?.error?.code, payload?.error?.message);
    }

    const outcome: Outcome = { text: '', calls: [], refusal: '', usage: null, model: null };
    let completed = false;
    try {
      for await (const { event, data } of events(res.body)) {
        switch (event) {
          case 'response.output_text.delta': {
            const delta = String(data.delta ?? '');
            outcome.text += delta;
            onText?.(delta);
            break;
          }
          case 'response.refusal.delta':
            outcome.refusal += String(data.delta ?? '');
            break;
          case 'response.output_item.done': {
            const item = data.item as { type?: string; name?: string; arguments?: string } | undefined;
            if (item?.type === 'function_call') {
              let input: unknown = null;
              try {
                input = JSON.parse(item.arguments || '{}');
              } catch {
                input = null;
              }
              outcome.calls.push({ name: item.name ?? '', input });
            }
            break;
          }
          case 'response.completed': {
            const response = data.response as { usage?: Usage; model?: string } | undefined;
            outcome.usage = response?.usage ?? null;
            outcome.model = response?.model ?? null;
            completed = true;
            break;
          }
          case 'response.incomplete': {
            const response = data.response as { incomplete_details?: { reason?: string } } | undefined;
            if (response?.incomplete_details?.reason === 'content_filter') throw refused();
            throw incomplete();
          }
          case 'response.failed': {
            // A usage limit can come after the stream began.
            const error = (data.response as { error?: { code?: string; message?: string } } | undefined)?.error;
            throw planError(error?.code?.startsWith('subscription_sharing_usage') ? 429 : 0, error?.code, error?.message);
          }
          case 'error':
            throw planError(Number(data.status ?? 0), (data.code as string | undefined) ?? undefined, (data.message as string | undefined) ?? undefined);
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (signal?.aborted) throw error;
      throw new HttpError(424, 'ai_unreachable', 'The connection to ChatGPT was interrupted');
    }
    // Only `response.completed` means the answer is whole.
    if (!completed) throw new HttpError(424, 'ai_unreachable', 'The connection to ChatGPT was interrupted');
    if (outcome.refusal) throw refused();
    return outcome;
  }

  const reasoning = (effort: Effort) => ({ reasoning: { effort } });

  async function structured<S extends z.ZodType>(feature: AiFeature, instructions: string, content: InputContent[], schema: S, name: string, effort: Effort): Promise<z.infer<S>> {
    const answeredBy = await currentModel();
    const call = meterFor(answeredBy)(feature);
    try {
      const format = zodTextFormat(schema, name) as { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean };
      const ask = (asTool: boolean) =>
        run({
          model: answeredBy,
          instructions,
          input: [{ role: 'user', content }] satisfies InputItem[],
          ...reasoning(effort),
          ...(asTool
            ? { tools: [{ type: 'function', name, description: 'Give the answer.', parameters: format.schema, strict: true }], tool_choice: { type: 'function', name } }
            : { text: { format } }),
        });
      let outcome: Outcome;
      try {
        outcome = await ask(formatAsTool);
      } catch (error) {
        // The preview doesn't document `text.format`: if the plan's API refuses it, the same schema goes as a tool.
        if (!formatAsTool && error instanceof HttpError && error.code === 'ai_bad_request' && /text|format|schema/i.test(error.message)) {
          formatAsTool = true;
          outcome = await ask(true);
        } else throw error;
      }
      call.answered(tokens(outcome.usage), outcome.model ?? answeredBy);
      const raw = formatAsTool ? outcome.calls.find((c) => c.name === name)?.input : parse(outcome.text);
      if (raw === undefined || raw === null) throw emptyAnswer();
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new HttpError(424, 'ai_bad_output', 'The AI returned an answer the app could not use, please retry');
      return parsed.data;
    } catch (error) {
      call.failed(error);
      throw error;
    }
  }

  async function streamed(
    feature: AiFeature,
    instructions: string,
    input: InputItem[],
    opts: { withTools?: boolean; onText?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<{ text: string; calls: { name: string; input: unknown }[] }> {
    const answeredBy = await currentModel();
    const call = meterFor(answeredBy)(feature);
    try {
      const outcome = await run(
        {
          model: answeredBy,
          instructions,
          input,
          ...reasoning('low'),
          ...(opts.withTools
            ? { tools: COACH_TOOLS.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: true })) }
            : {}),
        },
        opts.onText,
        opts.signal,
      );
      call.answered(tokens(outcome.usage), outcome.model ?? answeredBy);
      return { text: outcome.text, calls: outcome.calls };
    } catch (error) {
      call.failed(error);
      throw error;
    }
  }

  const text = (value: string): InputContent[] => [{ type: 'input_text', text: value }];

  return {
    enabled: true,
    get model() {
      return model ?? options.model ?? 'chatgpt';
    },
    provider: 'chatgpt',

    async analyzeMeal(input) {
      const content: InputContent[] = [];
      for (const photo of input.photos) {
        const caption = photoCaption(photo);
        if (caption) content.push({ type: 'input_text', text: caption });
        content.push({ type: 'input_image', image_url: `data:${photo.mime};base64,${photo.base64}`, detail: 'auto' });
      }
      content.push({ type: 'input_text', text: mealText(input) });
      return structured('meal', MEAL_ANALYST, content, MealAnalysisOut, 'meal_analysis', 'medium');
    },

    async draftPlan(input) {
      return structured('plan', GOAL_PLANNER, text(planText(input)), PlanOut, 'goal_plan', 'medium');
    },

    async coach(input, onText) {
      const history: InputItem[] = input.history.map((turn) => ({ role: turn.role, content: turn.content }));
      const result = await streamed('coach', COACH, [...history, { role: 'user', content: coachText(input) }], { withTools: true, onText });
      return coachOutput(result.text, result.calls);
    },

    async cravingTip(input, onText, signal) {
      const result = await streamed('craving', CRAVING, [{ role: 'user', content: cravingText(input) }], { onText, signal });
      return cravingOutput(result.text);
    },

    async review(input) {
      return structured('review', REVIEWER, text(reviewText(input)), ReviewSchema, 'review', 'medium');
    },

    async morning(input, onText) {
      const result = await streamed('morning', MORNING, [{ role: 'user', content: morningText(input) }], { onText });
      return morningOutput(result.text);
    },

    async cravingNudges(input) {
      return structured('nudges', NUDGES, text(nudgesText(input)), NudgesOut, 'nudges', 'low');
    },

    async ping() {
      await run({ model: await currentModel(), instructions: 'Answer with the single word OK.', input: [{ role: 'user', content: 'OK?' }], ...reasoning('low') });
    },
  };
}

/** The JSON of a structured answer, forgiving code fences. */
function parse(text: string): unknown {
  const bare = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  if (!bare) return null;
  try {
    return JSON.parse(bare);
  } catch {
    throw new HttpError(424, 'ai_bad_output', 'The AI returned an answer the app could not use, please retry');
  }
}
