import { beforeEach, describe, expect, it } from 'vitest';

import { HttpError } from '../errors';
import { createChatGptAi } from './chatgpt';
import { coachInput, cravingInput, mealInput, mealOutput, planInput, planOutput } from './test-fixtures';
import type { AiUsage } from './types';

/** The ChatGPT plan adapter against a fake Responses API: no network, no account. */

type Body = Record<string, unknown>;

let requests: { url: string; body: Body | null; token: string | null }[] = [];
let usage: AiUsage[] = [];
let respond: (url: string, body: Body | null) => Response | Promise<Response>;
let tokenCalls: { fresh?: boolean }[] = [];
let token = 'token-1';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const USAGE = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 } };

/** A Responses stream: each event as `event:` and `data:` lines. */
function stream(events: { type: string; [key: string]: unknown }[]) {
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

const completed = { type: 'response.completed', response: { model: 'gpt-6.1-sol-2026-10-01', usage: USAGE } };
const textEvents = (text: string) => text.split(/(?<= )/).map((delta) => ({ type: 'response.output_text.delta', delta }));

function ai(model: string | null = 'gpt-6.1-sol') {
  return createChatGptAi(
    {
      model,
      accessToken: async (options) => {
        tokenCalls.push(options ?? {});
        if (options?.fresh) token = 'token-2';
        return token;
      },
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(String(init.body)) as Body) : null;
        const headers = new Headers(init?.headers);
        requests.push({ url: String(url), body, token: headers.get('authorization') });
        return respond(String(url), body);
      }) as typeof fetch,
    },
    (u) => usage.push(u),
  );
}

beforeEach(() => {
  requests = [];
  usage = [];
  tokenCalls = [];
  token = 'token-1';
});

describe('ChatGPT plan adapter', () => {
  it('asks for a structured meal analysis, streamed and not stored', async () => {
    respond = () => stream([...textEvents(JSON.stringify(mealOutput)), completed]);
    const result = await ai().analyzeMeal({ ...mealInput, photos: [{ base64: 'AAAA', mime: 'image/jpeg' }] });
    expect(result.title).toBe(mealOutput.title);

    const { url, body, token: auth } = requests[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(auth).toBe('Bearer token-1');
    expect(body).toMatchObject({ model: 'gpt-6.1-sol', stream: true, store: false, reasoning: { effort: 'medium' } });
    expect(typeof body!.instructions).toBe('string');
    expect((body!.text as { format: { type: string; name: string } }).format).toMatchObject({ type: 'json_schema', name: 'meal_analysis' });
    const content = (body!.input as { content: { type: string }[] }[])[0]!.content;
    expect(content.map((part) => part.type)).toEqual(['input_image', 'input_text']);
    // None of the fields the preview refuses.
    for (const field of ['max_output_tokens', 'temperature', 'metadata', 'previous_response_id', 'prompt_cache_retention', 'user']) expect(body).not.toHaveProperty(field);

    expect(usage).toEqual([
      expect.objectContaining({ feature: 'meal', provider: 'chatgpt', model: 'gpt-6.1-sol-2026-10-01', inputTokens: 600, cacheReadTokens: 400, outputTokens: 200, ok: true }),
    ]);
  });

  it('streams the coach and reads its proposals', async () => {
    respond = () =>
      stream([
        ...textEvents('Bonne idée, '),
        ...textEvents('je te propose ça.'),
        {
          type: 'response.output_item.done',
          item: { type: 'function_call', name: 'propose_plan_change', arguments: JSON.stringify({ intentions: 'Moins de sucre le soir', rationale: 'Tu l’as demandé' }) },
        },
        completed,
      ]);
    const deltas: string[] = [];
    const reply = await ai().coach(coachInput, (d) => deltas.push(d));
    expect(deltas.join('')).toBe('Bonne idée, je te propose ça.');
    expect(reply.reply).toBe('Bonne idée, je te propose ça.');
    expect(reply.planChange?.intentions).toBe('Moins de sucre le soir');
    expect((requests[0]!.body!.tools as unknown[]).length).toBe(2);
  });

  it('says the plan limit is reached, even when it comes in the middle of the stream', async () => {
    respond = () =>
      stream([
        ...textEvents('Une '),
        { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached' } } },
      ]);
    await expect(ai().cravingTip(cravingInput)).rejects.toMatchObject({ status: 429, code: 'ai_plan_limit' });
    respond = () => json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } }, 429);
    await expect(ai().draftPlan(planInput)).rejects.toMatchObject({ code: 'ai_plan_limit' });
    expect(usage.map((u) => u.error)).toEqual(['ai_plan_limit', 'ai_plan_limit']);
  });

  it('says when the plan can’t be used in other apps', async () => {
    respond = () => json({ error: { code: 'subscription_sharing_user_not_eligible', message: 'not eligible' } }, 403);
    await expect(ai().draftPlan(planInput)).rejects.toMatchObject({ code: 'ai_not_eligible' });
  });

  it('asks for a fresh token once after a 401, then asks to sign in again', async () => {
    let first = true;
    respond = () => {
      if (first) {
        first = false;
        return json({ error: { code: 'invalid_token' } }, 401);
      }
      return stream([...textEvents(JSON.stringify(planOutput)), completed]);
    };
    await ai().draftPlan(planInput);
    expect(requests.map((r) => r.token)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(tokenCalls).toEqual([{ fresh: false }, { fresh: true }]);

    respond = () => json({ error: { code: 'subscription_sharing_invalid_user' } }, 401);
    await expect(ai().draftPlan(planInput)).rejects.toMatchObject({ code: 'ai_reconnect' });
  });

  it('treats a stream that stops before `response.completed` as a lost connection', async () => {
    respond = () => stream(textEvents('Une pomme'));
    await expect(ai().cravingTip(cravingInput)).rejects.toMatchObject({ code: 'ai_unreachable' });
    respond = () => {
      throw new TypeError('Network request failed');
    };
    await expect(ai().cravingTip(cravingInput)).rejects.toMatchObject({ code: 'ai_unreachable' });
  });

  it('sends the schema as a forced function call when `text.format` is refused', async () => {
    respond = (_url, body) =>
      body?.text
        ? json({ error: { code: 'subscription_sharing_unsupported_capability', message: 'Unsupported parameter: text.format', param: 'text.format' } }, 400)
        : stream([{ type: 'response.output_item.done', item: { type: 'function_call', name: 'goal_plan', arguments: JSON.stringify(planOutput) } }, completed]);
    const adapter = ai();
    const plan = await adapter.draftPlan(planInput);
    expect(plan.calorieMode).toBe(planOutput.calorieMode);
    expect(requests[1]!.body).toMatchObject({ tool_choice: { type: 'function', name: 'goal_plan' } });
    // And straight away from then on.
    await adapter.draftPlan(planInput);
    expect(requests).toHaveLength(3);
  });

  it('uses the first model the account lists when none is chosen', async () => {
    respond = (url) =>
      url.endsWith('/models')
        ? json({ models: [{ id: 'gpt-hidden', visibility: 'hide' }, { id: 'gpt-6.1-sol', visibility: 'list' }] })
        : stream([...textEvents(JSON.stringify(planOutput)), completed]);
    const adapter = ai(null);
    await adapter.draftPlan(planInput);
    expect(requests[1]!.body!.model).toBe('gpt-6.1-sol');
    expect(adapter.model).toBe('gpt-6.1-sol');
  });

  it('turns a refusal into ai_refused', async () => {
    respond = () => stream([{ type: 'response.refusal.delta', delta: 'Je ne peux pas.' }, completed]);
    await expect(ai().draftPlan(planInput)).rejects.toBeInstanceOf(HttpError);
    await expect(ai().draftPlan(planInput)).rejects.toMatchObject({ code: 'ai_refused' });
  });
});
