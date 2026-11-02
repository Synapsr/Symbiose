import { ReviewSchema } from '@symbiose/shared';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { CompletionUsage } from 'openai/resources/completions';
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
 * Any provider that speaks the OpenAI Chat Completions API: OpenAI, Mistral,
 * Gemini, OpenRouter, Ollama, LM Studio, vLLM… Claude keeps its own adapter.
 */

/** The optional request fields a provider's API documents; the rest is plain Chat Completions. */
export interface ProviderTraits {
  /** Where the answer's length cap goes; null: let the server decide (local servers know their context size). */
  tokenLimit: 'max_completion_tokens' | 'max_tokens' | null;
  /** Sends `reasoning_effort` (low or medium, as for Claude). */
  effort: boolean;
  /** Asks for usage at the end of a stream (`stream_options.include_usage`); some APIs send it anyway, others reject the field. */
  streamUsage: boolean;
  /** Strict function schemas for the coach's tools. */
  strictTools: boolean;
}

export interface OpenAiCompatibleOptions {
  /** For the usage log and error messages: `openai`, `mistral`, `ollama`… */
  provider: string;
  model: string;
  /** Local servers ignore it, but the client needs one. */
  apiKey: string | null;
  baseUrl: string;
  /** False for a model that can't read photos. */
  vision: boolean;
  traits: ProviderTraits;
  /** Tests answer with a fake API. */
  fetch?: typeof fetch;
}

/** Optional request fields the server refused once: the adapter goes on without them, until restart. */
type Optional = 'effort' | 'streamUsage' | 'tools';

const REFUSED: Record<Optional, RegExp> = {
  effort: /reasoning/i,
  streamUsage: /stream_options|include_usage/i,
  tools: /\btools?\b|function/i,
};

const LABEL: Record<Optional, string> = {
  effort: 'reasoning_effort',
  streamUsage: 'stream_options.include_usage',
  tools: 'tool calls (the coach answers in plain text, without proposals)',
};

/** "image input is not supported", "is not a multimodal model"… but not "image too large". */
const cannotSee = (message: string) => /image|vision|multimodal|mmproj/i.test(message) && /support|multimodal|mmproj|missing/i.test(message);

export const noVision = () => new HttpError(424, 'ai_no_vision', "This server's AI model can't read photos: describe the meal in words instead");

const unusable = () => new HttpError(424, 'ai_bad_output', 'The AI returned an answer the app could not use, please retry');

/** Message text: a string, or chunks (Mistral while it reasons) where only `text` ones count. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: { type?: unknown; text?: unknown }) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('');
}

/** JSON from a structured answer, forgiving the fences or the reasoning some local models print around it. */
function parseJson(text: string): unknown {
  const bare = text
    .replace(/^\s*<think>[\s\S]*?<\/think>/, '')
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  try {
    return JSON.parse(bare);
  } catch {
    throw unusable();
  }
}

/** Anthropic's split: input tokens exclude the ones read from or written to the cache. */
function tokens(usage: CompletionUsage | null | undefined): TokenCounts {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const details = usage.prompt_tokens_details;
  // Mistral also reports cached tokens as `num_cached_tokens`.
  const cacheRead = details?.cached_tokens ?? (usage as { num_cached_tokens?: number | null }).num_cached_tokens ?? 0;
  const cacheWrite = details?.cache_write_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cacheRead - cacheWrite),
    outputTokens: usage.completion_tokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

export function createOpenAiCompatibleAi(options: OpenAiCompatibleOptions, onUsage?: AiUsageListener): Ai {
  const { provider, model, traits } = options;
  const client = new OpenAI({
    apiKey: options.apiKey || 'none',
    baseURL: options.baseUrl,
    maxRetries: 2,
    timeout: 120_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const meter = usageMeter(provider, model, toHttpError, onUsage);
  const off = new Set<Optional>();
  let vision = options.vision;

  const tools: ChatCompletionTool[] = COACH_TOOLS.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema, ...(traits.strictTools ? { strict: true } : {}) },
  }));

  /** Length cap and reasoning effort, as this provider names them. */
  const tuning = (maxTokens: number, effort: Effort) => ({
    ...(traits.tokenLimit === 'max_completion_tokens' ? { max_completion_tokens: maxTokens } : {}),
    ...(traits.tokenLimit === 'max_tokens' ? { max_tokens: maxTokens } : {}),
    ...(traits.effort && !off.has('effort') ? { reasoning_effort: effort } : {}),
  });

  /**
   * Sends a request; when the server refuses one of its optional fields, sends
   * it again without (and never again). A photo the model can't read is final.
   */
  async function send<T>(optional: Optional[], image: boolean, request: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await request();
      } catch (error) {
        if (!(error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError)) throw error;
        if (image && cannotSee(error.message)) {
          vision = false;
          console.warn(`AI: ${provider} · ${model} can't read photos (${error.message}). Photo meals answer ai_no_vision; set AI_VISION=false to skip the try.`);
          throw noVision();
        }
        const dropped = optional.find((field) => !off.has(field) && REFUSED[field].test(error.message));
        if (!dropped) throw error;
        off.add(dropped);
        console.warn(`AI: ${provider} refused ${LABEL[dropped]}; going on without it (${error.message})`);
      }
    }
  }

  async function structured<S extends z.ZodType>(feature: AiFeature, system: string, content: ChatCompletionContentPart[], schema: S, name: string, effort: Effort): Promise<z.infer<S>> {
    const call = meter(feature);
    const image = content.some((part) => part.type === 'image_url');
    try {
      const completion = await send(traits.effort ? ['effort'] : [], image, () => {
        const params: ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          // Strict JSON schema; the answer is validated against the same zod schema anyway.
          response_format: zodResponseFormat(schema, name),
          ...tuning(16000, effort),
        };
        return client.chat.completions.create(params);
      });
      call.answered(tokens(completion.usage), completion.model || model);
      const choice = completion.choices[0];
      if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw refused();
      if (choice?.finish_reason === 'length') throw incomplete();
      const parsed = schema.safeParse(parseJson(textOf(choice?.message?.content)));
      if (!parsed.success) throw unusable();
      return parsed.data;
    } catch (error) {
      call.failed(error);
      throw mapError(error);
    }
  }

  /** Streams the answer's text through `onText`; returns it with the tool calls. */
  async function streamed(
    feature: AiFeature,
    messages: ChatCompletionMessageParam[],
    opts: { maxTokens: number; withTools?: boolean; onText?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<{ text: string; calls: { name: string; input: unknown }[] }> {
    const call = meter(feature);
    const optional: Optional[] = [...(traits.effort ? ['effort' as const] : []), ...(traits.streamUsage ? ['streamUsage' as const] : []), ...(opts.withTools ? ['tools' as const] : [])];
    try {
      const stream = await send(optional, false, () => {
        const params: ChatCompletionCreateParamsStreaming = {
          model,
          messages,
          stream: true,
          ...(traits.streamUsage && !off.has('streamUsage') ? { stream_options: { include_usage: true } } : {}),
          ...(opts.withTools && !off.has('tools') ? { tools } : {}),
          ...tuning(opts.maxTokens, 'low'),
        };
        return client.chat.completions.create(params, opts.signal ? { signal: opts.signal } : undefined);
      });
      let text = '';
      let refusal = '';
      let finish: string | null = null;
      let usage: CompletionUsage | null = null;
      let answeredBy = model;
      const toolCalls: { name: string; args: string }[] = [];
      for await (const chunk of stream) {
        if (chunk.model) answeredBy = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        for (const choice of chunk.choices ?? []) {
          const piece = textOf(choice.delta?.content);
          if (piece) {
            text += piece;
            opts.onText?.(piece);
          }
          if (choice.delta?.refusal) refusal += choice.delta.refusal;
          for (const delta of choice.delta?.tool_calls ?? []) {
            // Arguments come in pieces under the call's index; a few servers send each call whole, without one.
            const index = typeof delta.index === 'number' ? delta.index : delta.id ? toolCalls.length : Math.max(toolCalls.length - 1, 0);
            const slot = (toolCalls[index] ??= { name: '', args: '' });
            if (delta.function?.name) slot.name = delta.function.name;
            if (delta.function?.arguments) slot.args += delta.function.arguments;
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      }
      call.answered(tokens(usage), answeredBy);
      if (refusal || finish === 'content_filter') throw refused();
      const calls = toolCalls.filter(Boolean).map((slot) => {
        try {
          return { name: slot.name, input: JSON.parse(slot.args || '{}') as unknown };
        } catch {
          return { name: slot.name, input: null };
        }
      });
      return { text, calls };
    } catch (error) {
      call.failed(error);
      throw mapError(error);
    }
  }

  /** Maps provider errors to the app's codes, and logs them: whoever hosts the server is the one who can fix them. */
  function mapError(error: unknown): unknown {
    const mapped = toHttpError(error);
    if (mapped !== error && !(error instanceof OpenAI.APIUserAbortError)) {
      console.warn(`AI: ${provider} · ${model}: ${(mapped as HttpError).code} (${error instanceof Error ? error.message : String(error)})`);
    }
    return mapped;
  }

  return {
    enabled: true,
    model,
    provider,

    async analyzeMeal(input) {
      let photos = input.photos;
      if (photos.length && !vision) {
        // A refinement can go on from the previous analysis; a new photo can't.
        if (!input.previous) throw noVision();
        photos = [];
      }
      const content: ChatCompletionContentPart[] = [];
      for (const photo of photos) {
        const caption = photoCaption(photo);
        if (caption) content.push({ type: 'text', text: caption });
        content.push({ type: 'image_url', image_url: { url: `data:${photo.mime};base64,${photo.base64}` } });
      }
      // The photos actually sent: a text-only model refining a photo meal reads the words as the meal's own.
      content.push({ type: 'text', text: mealText({ ...input, photos }) });
      return structured('meal', MEAL_ANALYST, content, MealAnalysisOut, 'meal_analysis', 'medium');
    },

    async draftPlan(input) {
      return structured('plan', GOAL_PLANNER, [{ type: 'text', text: planText(input) }], PlanOut, 'goal_plan', 'medium');
    },

    async coach(input, onText) {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: COACH },
        ...input.history.map((turn): ChatCompletionMessageParam => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: coachText(input) },
      ];
      const { text, calls } = await streamed('coach', messages, { maxTokens: 16000, withTools: true, onText });
      return coachOutput(text, calls);
    },

    async cravingTip(input, onText, signal) {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: CRAVING },
        { role: 'user', content: cravingText(input) },
      ];
      const { text } = await streamed('craving', messages, { maxTokens: 2000, onText, signal });
      return cravingOutput(text);
    },

    async review(input) {
      return structured('review', REVIEWER, [{ type: 'text', text: reviewText(input) }], ReviewSchema, 'review', 'medium');
    },

    async morning(input, onText) {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: MORNING },
        { role: 'user', content: morningText(input) },
      ];
      const { text } = await streamed('morning', messages, { maxTokens: 2000, onText });
      return morningOutput(text);
    },

    async cravingNudges(input) {
      return structured('nudges', NUDGES, [{ type: 'text', text: nudgesText(input) }], NudgesOut, 'nudges', 'low');
    },
  };
}

// Same codes as Claude's adapter: 424 so proxies keep the JSON body.
function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new HttpError(424, 'ai_misconfigured', 'The server AI key is invalid');
  }
  if (error instanceof OpenAI.NotFoundError) {
    return new HttpError(424, 'ai_misconfigured', 'The server AI model or URL was not found');
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new HttpError(429, 'ai_rate_limited', 'The AI is busy, retry in a moment');
  }
  if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError) {
    // A structured-output schema the provider won't take is an unusable answer, like invalid JSON.
    if (/schema|response_format/i.test(error.message)) return unusable();
    return new HttpError(424, 'ai_bad_request', error.message);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new HttpError(424, 'ai_unreachable', 'Could not reach the AI provider');
  }
  if (error instanceof OpenAI.APIError) {
    return new HttpError(424, 'ai_error', `AI provider error (${error.status ?? 'unknown'})`);
  }
  return error;
}
