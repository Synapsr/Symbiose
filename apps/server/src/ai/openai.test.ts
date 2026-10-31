import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleAi, type OpenAiCompatibleOptions } from './openai';
import { AI_PROVIDERS } from './providers';
import { coachInput, cravingInput, mealCorrectionInput, mealInput, mealOutput, morningInput, nudgesInput, planInput, planOutput, reviewInput, reviewOutput } from './test-fixtures';
import type { AiUsage } from './types';

/** The OpenAI-compatible adapter against a fake Chat Completions API: no network, no key. */

type Body = Record<string, unknown> & { messages: { role: string; content: unknown }[] };

let requests: { url: string; body: Body }[] = [];
let usage: AiUsage[] = [];
let respond: (body: Body) => Response | Promise<Response>;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

/** An API error the SDK won't retry. */
const failure = (status: number, message: string) => json({ error: { message, type: 'invalid_request_error' } }, status, { 'x-should-retry': 'false' });

const USAGE = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 600 } };

const completion = (content: unknown, extra: { finish_reason?: string; refusal?: string | null } = {}) =>
  json({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1793400000,
    model: 'gpt-6-astra-2026-09-01',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: extra.refusal ?? null }, finish_reason: extra.finish_reason ?? 'stop' }],
    usage: USAGE,
  });

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1793400000,
  model: 'gpt-6-astra-2026-09-01',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** A server-sent stream; `usage` ends it in its own chunk without choices, as OpenAI does. */
function sse(chunks: unknown[], withUsage: unknown = USAGE) {
  const all = withUsage ? [...chunks, { ...chunk({}), choices: [], usage: withUsage }] : chunks;
  return new Response(`${all.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}

const words = (text: string) => text.split(/(?<= )/).map((part) => chunk({ content: part }));

const options = (overrides: Partial<OpenAiCompatibleOptions> = {}): OpenAiCompatibleOptions => ({
  provider: 'openai',
  model: 'gpt-6-astra',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.test/v1',
  vision: true,
  traits: AI_PROVIDERS.openai.traits!,
  fetch: (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    requests.push({ url: String(url), body });
    return respond(body);
  }) as typeof fetch,
  ...overrides,
});

const ai = (overrides: Partial<OpenAiCompatibleOptions> = {}) => createOpenAiCompatibleAi(options(overrides), (u) => usage.push(u));

const MEAL_ACTION = { action: 'add', mealId: null, description: 'un yaourt', mealType: 'snack', localDate: null, time: '16:00', summary: 'Ajouter : yaourt, 16 h' };

beforeEach(() => {
  requests = [];
  usage = [];
  respond = () => {
    throw new Error('unexpected request');
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structured answers', () => {
  it('analyses a photo meal with a strict JSON schema, and reads the answer with zod', async () => {
    respond = () => completion(JSON.stringify(mealOutput));
    expect(await ai().analyzeMeal(mealInput)).toEqual(mealOutput);

    const [{ url, body }] = requests as [{ url: string; body: Body }];
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect(body.model).toBe('gpt-6-astra');
    expect(body.max_completion_tokens).toBe(16000);
    expect(body.reasoning_effort).toBe('medium');
    expect(body.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('nutrition analyst') });
    const content = body.messages[1]!.content as { type: string; image_url?: { url: string }; text?: string }[];
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } });
    expect(content[1]!.text).toContain('What I ate: Pâtes carbonara et un coca');
    const format = body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { required: string[]; additionalProperties: boolean } } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.name).toBe('meal_analysis');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect(format.json_schema.schema.required).toContain('clarification');
    expect(format.json_schema.schema.required).toEqual(expect.arrayContaining(['courses', 'reusedMeal']));
  });

  it('labels each course’s photo on a whole-meal correction, with the last days’ meals', async () => {
    respond = () => completion(JSON.stringify(mealOutput));
    await ai().analyzeMeal(mealCorrectionInput);
    const content = (requests[0]!.body.messages[1]!.content as { type: string; text?: string }[]).map((p) => p.text ?? p.type);
    expect(content.slice(0, 4)).toEqual(['Photo of course 1:', 'image_url', 'Photo of course 3:', 'image_url']);
    expect(content[4]).toContain('"history"');
    expect(content[4]).toContain('Correction to apply: le gratin c’était le reste d’hier soir');
  });

  it('drafts plans, reviews and nudges the same way', async () => {
    const answers: Record<string, unknown> = { goal_plan: planOutput, review: reviewOutput, nudges: { lines: ['Un fruit ?'] } };
    respond = (body) => completion(JSON.stringify(answers[(body.response_format as { json_schema: { name: string } }).json_schema.name]));
    const openai = ai();
    expect(await openai.draftPlan(planInput)).toEqual(planOutput);
    expect(await openai.review(reviewInput)).toEqual(reviewOutput);
    expect(await openai.cravingNudges(nudgesInput)).toEqual({ lines: ['Un fruit ?'] });
    expect(requests.map((r) => r.body.reasoning_effort)).toEqual(['medium', 'medium', 'low']);
  });

  it('forgives the fences and the reasoning local models print around the JSON', async () => {
    respond = () => completion(`<think>Hmm.</think>\n\`\`\`json\n${JSON.stringify(reviewOutput)}\n\`\`\``);
    expect(await ai().review(reviewInput)).toEqual(reviewOutput);
  });

  it('reads Mistral’s chunked content, keeping the text and leaving out the thinking', async () => {
    respond = () => completion([{ type: 'thinking', thinking: [{ type: 'text', text: '{"nope":1}' }] }, { type: 'text', text: JSON.stringify(reviewOutput) }]);
    expect(await ai().review(reviewInput)).toEqual(reviewOutput);
  });

  it('turns invalid JSON, a wrong shape or a refused schema into ai_bad_output', async () => {
    const openai = ai();
    respond = () => completion('Voici votre bilan : super semaine !');
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_output' });
    respond = () => completion(JSON.stringify({ headline: 'ok' }));
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_output' });
    respond = () => failure(400, "Invalid schema for response_format 'review': 'format' is not permitted.");
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_output' });
    respond = () => completion('{"headline":', { finish_reason: 'length' });
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_output' });
  });

  it('maps a refusal to ai_refused', async () => {
    respond = () => completion(null, { refusal: 'I can’t help with that.' });
    await expect(ai().review(reviewInput)).rejects.toMatchObject({ status: 422, code: 'ai_refused' });
  });
});

describe('streamed answers', () => {
  it('streams the coach’s reply, then validates its tool calls', async () => {
    const args = JSON.stringify(MEAL_ACTION);
    respond = () =>
      sse([
        chunk({ role: 'assistant', content: '' }),
        ...words('Avec plaisir, je l’ajoute dès que tu confirmes.'),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'propose_meal_action', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, 20) } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] }),
        // Invalid: no intentions. Dropped, like Claude's.
        chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'propose_plan_change', arguments: '{"rationale":"x"}' } }] }),
        chunk({}, 'tool_calls'),
      ]);
    const deltas: string[] = [];
    const output = await ai().coach(coachInput, (d) => deltas.push(d));
    expect(output).toEqual({ reply: 'Avec plaisir, je l’ajoute dès que tu confirmes.', planChange: null, mealActions: [MEAL_ACTION] });
    expect(deltas.join('')).toBe(output.reply);

    const { body } = requests[0]!;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.reasoning_effort).toBe('low');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.tools).toEqual([
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'propose_plan_change', strict: true }) }),
      expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'propose_meal_action', strict: true }) }),
    ]);
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('streams the craving tip and the morning check-in as plain text', async () => {
    const openai = ai();
    respond = () => sse(words('Bois un grand verre d’eau.\nUn carré de chocolat noir.'));
    expect(await openai.cravingTip(cravingInput)).toEqual({ tip: 'Bois un grand verre d’eau.', alternative: 'Un carré de chocolat noir.' });
    respond = () => sse(words('Nuit courte, vas-y en douceur.\nPrévois un en-cas à 16 h. '));
    expect(await openai.morning(morningInput)).toEqual({ text: 'Nuit courte, vas-y en douceur.\nPrévois un en-cas à 16 h.' });
    expect(requests.map((r) => [r.body.max_completion_tokens, r.body.tools])).toEqual([
      [2000, undefined],
      [2000, undefined],
    ]);
  });

  it('answers in plain text when the model can’t call tools, and stops offering them', async () => {
    respond = (body) => (body.tools ? failure(400, 'registry.ollama.ai/library/gemma:2b does not support tools') : sse(words('Bonne idée, note-le dans l’app.')));
    const openai = ai({ provider: 'ollama', traits: AI_PROVIDERS.ollama.traits! });
    expect(await openai.coach(coachInput)).toEqual({ reply: 'Bonne idée, note-le dans l’app.', planChange: null, mealActions: [] });
    await openai.coach(coachInput);
    expect(requests.map((r) => Boolean(r.body.tools))).toEqual([true, false, false]);
  });

  it('drops reasoning_effort for a model that refuses it', async () => {
    respond = (body) => (body.reasoning_effort ? failure(400, "Unsupported value: 'reasoning_effort' does not support 'low' with this model.") : sse(words('Ok.')));
    const openai = ai();
    expect(await openai.morning(morningInput)).toEqual({ text: 'Ok.' });
    await openai.morning(morningInput);
    expect(requests.map((r) => r.body.reasoning_effort ?? null)).toEqual(['low', null, null]);
  });

  it('speaks Mistral’s dialect: no stream_options, max_tokens, usage and chunks in the stream anyway', async () => {
    respond = () =>
      sse(
        [chunk({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Short night…' }] }] }), chunk({ content: [{ type: 'thinking', thinking: [] }, { type: 'text', text: 'Nuit courte.' }] }), chunk({ content: ' Douceur.' }, 'stop')],
        { prompt_tokens: 800, completion_tokens: 90, total_tokens: 890, num_cached_tokens: 300 },
      );
    const deltas: string[] = [];
    const openai = ai({ provider: 'mistral', model: 'mistral-large-4', traits: AI_PROVIDERS.mistral.traits! });
    expect(await openai.morning(morningInput, (d) => deltas.push(d))).toEqual({ text: 'Nuit courte. Douceur.' });
    expect(deltas).toEqual(['Nuit courte.', ' Douceur.']);
    const { body } = requests[0]!;
    expect(body).not.toHaveProperty('stream_options');
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body.max_tokens).toBe(2000);
    expect(usage[0]).toMatchObject({ provider: 'mistral', inputTokens: 500, cacheReadTokens: 300, outputTokens: 90 });
  });
});

describe('photos', () => {
  it('answers ai_no_vision for a photo when the model can’t see, and still reads text meals', async () => {
    respond = () => completion(JSON.stringify(mealOutput));
    const openai = ai({ vision: false });
    await expect(openai.analyzeMeal(mealInput)).rejects.toMatchObject({ status: 424, code: 'ai_no_vision' });
    expect(requests).toHaveLength(0);

    expect(await openai.analyzeMeal({ ...mealInput, photos: [] })).toEqual(mealOutput);
    // A correction goes on from the previous analysis, without the photo.
    await openai.analyzeMeal({ ...mealInput, previous: { title: 'Pâtes', items: [] }, correction: 'sans coca' });
    expect(requests.map((r) => (r.body.messages[1]!.content as { type: string }[]).map((p) => p.type))).toEqual([['text'], ['text']]);
  });

  it('learns it when the server says so', async () => {
    respond = (body) => ((body.messages[1]!.content as { type: string }[]).some((p) => p.type === 'image_url') ? failure(400, 'image input is not supported - hint: you may need to provide the mmproj') : completion(JSON.stringify(mealOutput)));
    const openai = ai({ provider: 'openai-compatible', traits: AI_PROVIDERS['openai-compatible'].traits! });
    await expect(openai.analyzeMeal(mealInput)).rejects.toMatchObject({ code: 'ai_no_vision' });
    await expect(openai.analyzeMeal(mealInput)).rejects.toMatchObject({ code: 'ai_no_vision' });
    expect(requests).toHaveLength(1);
  });

  it('doesn’t take a too-large photo for a blind model', async () => {
    respond = () => failure(400, 'Image exceeds the 20 MB limit');
    await expect(ai().analyzeMeal(mealInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_request' });
  });
});

describe('errors and usage', () => {
  it('maps provider errors to the app’s codes', async () => {
    const openai = ai();
    respond = () => failure(401, 'Incorrect API key provided');
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_misconfigured' });
    respond = () => failure(404, 'The model `gpt-7` does not exist');
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_misconfigured' });
    respond = () => failure(429, 'Rate limit reached');
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 429, code: 'ai_rate_limited' });
    respond = () => failure(500, 'The server had an error');
    await expect(openai.coach(coachInput)).rejects.toMatchObject({ status: 424, code: 'ai_error' });
    expect(usage.map((u) => [u.feature, u.ok, u.error])).toEqual([
      ['review', false, 'ai_misconfigured'],
      ['review', false, 'ai_misconfigured'],
      ['review', false, 'ai_rate_limited'],
      ['coach', false, 'ai_error'],
    ]);
  });

  it('maps an unreachable server to ai_unreachable', async () => {
    const openai = ai({
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(openai.review(reviewInput)).rejects.toMatchObject({ status: 424, code: 'ai_unreachable' });
  });

  it('reports each call once, with Anthropic’s token split', async () => {
    const openai = ai();
    respond = () => completion(JSON.stringify(reviewOutput));
    await openai.review(reviewInput);
    respond = () => sse(words('Ok.'), { ...USAGE, prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 50 } });
    await openai.morning(morningInput);
    expect(usage).toEqual([
      { feature: 'review', provider: 'openai', model: 'gpt-6-astra-2026-09-01', inputTokens: 400, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 0, durationMs: expect.any(Number), ok: true },
      { feature: 'morning', provider: 'openai', model: 'gpt-6-astra-2026-09-01', inputTokens: 850, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 50, durationMs: expect.any(Number), ok: true },
    ]);
  });
});
