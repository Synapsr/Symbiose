import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClaudeAi } from './claude';
import { COACH, CRAVING, GOAL_PLANNER, MEAL_ANALYST, MORNING, NUDGES, REVIEWER } from './prompts';
import { coachInput, courseInput, cravingInput, mealCorrectionInput, mealInput, mealOutput, morningInput, nudgesInput, planInput, planOutput, reviewInput, reviewOutput } from './test-fixtures';
import type { AiUsage } from './types';

/**
 * The Claude adapter against a fake Anthropic API. The snapshot pins every
 * request body and the headers that matter, so a refactor can't change what
 * Claude receives (prompt caching, fallbacks, effort, tools).
 */

interface Recorded {
  url: string;
  headers: Record<string, string | null>;
  /** Pins the exact bytes, key order included. */
  sha256: string;
  body: Record<string, unknown>;
}

let requests: Recorded[] = [];
let usage: AiUsage[] = [];
let respond: (body: Record<string, unknown>) => Response;

const sse = (events: Record<string, unknown>[]) =>
  new Response(events.map((data) => `event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const message = (content: unknown[], stopReason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 },
});

/** A streamed answer: text, then each tool call as streamed JSON. */
function stream(text: string, tools: { name: string; input: unknown }[] = []) {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { ...message([]), stop_reason: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...text.split(/(?<= )/).map((part) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } })),
    { type: 'content_block_stop', index: 0 },
  ];
  tools.forEach((tool, i) => {
    events.push(
      { type: 'content_block_start', index: i + 1, content_block: { type: 'tool_use', id: `toolu_${i}`, name: tool.name, input: {} } },
      { type: 'content_block_delta', index: i + 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } },
      { type: 'content_block_stop', index: i + 1 },
    );
  });
  events.push({ type: 'message_delta', delta: { stop_reason: tools.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } }, { type: 'message_stop' });
  return sse(events);
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Answers each feature from its system prompt. */
function defaultResponse(body: Record<string, unknown>): Response {
  const system = (body.system as { text: string }[])[0]!.text;
  const structured = (output: unknown) => json(message([{ type: 'text', text: JSON.stringify(output) }]));
  if (system === MEAL_ANALYST) return structured(mealOutput);
  if (system === GOAL_PLANNER) return structured(planOutput);
  if (system === REVIEWER) return structured(reviewOutput);
  if (system === NUDGES) return structured({ lines: ['Un fruit ?', 'Un verre d’eau ?'] });
  if (system === COACH) {
    return stream('Avec plaisir, je l’ajoute dès que tu confirmes.', [
      {
        name: 'propose_meal_action',
        input: { action: 'add', mealId: null, description: 'un yaourt', mealType: 'snack', localDate: null, time: '16:00', summary: 'Ajouter : yaourt, 16 h' },
      },
    ]);
  }
  if (system === CRAVING) return stream('Bois un grand verre d’eau.\nUn carré de chocolat noir.');
  if (system === MORNING) return stream('Nuit courte, vas-y en douceur.\nPrévois un en-cas à 16 h.');
  throw new Error('unexpected request');
}

beforeEach(() => {
  requests = [];
  usage = [];
  respond = defaultResponse;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({
      url: String(url),
      headers: Object.fromEntries(['anthropic-beta', 'anthropic-version', 'anthropic-workspace-id', 'x-api-key'].map((name) => [name, headers.get(name)])),
      sha256: createHash('sha256').update(String(init?.body)).digest('hex'),
      body,
    });
    return respond(body);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ai = () => createClaudeAi('sk-ant-test', 'claude-opus-5-5', 'wrk_test', (u) => usage.push(u));

describe('Claude adapter', () => {
  it('sends exactly the same requests for every feature', async () => {
    const claude = ai();
    const deltas: string[] = [];

    expect(await claude.analyzeMeal(mealInput)).toEqual(mealOutput);
    // A course joining a meal, then a whole-meal correction: each photo labelled with its course, the last days' meals.
    expect(await claude.analyzeMeal(courseInput)).toEqual(mealOutput);
    expect(await claude.analyzeMeal(mealCorrectionInput)).toEqual(mealOutput);
    expect(await claude.draftPlan(planInput)).toEqual(planOutput);
    expect(await claude.review(reviewInput)).toEqual(reviewOutput);
    expect(await claude.cravingNudges(nudgesInput)).toEqual({ lines: ['Un fruit ?', 'Un verre d’eau ?'] });
    const coach = await claude.coach(coachInput, (d) => deltas.push(d));
    expect(coach).toEqual({
      reply: 'Avec plaisir, je l’ajoute dès que tu confirmes.',
      planChange: null,
      mealActions: [{ action: 'add', mealId: null, description: 'un yaourt', mealType: 'snack', localDate: null, time: '16:00', summary: 'Ajouter : yaourt, 16 h' }],
    });
    expect(deltas.join('')).toBe(coach.reply);
    expect(await claude.cravingTip(cravingInput)).toEqual({ tip: 'Bois un grand verre d’eau.', alternative: 'Un carré de chocolat noir.' });
    expect(await claude.morning(morningInput)).toEqual({ text: 'Nuit courte, vas-y en douceur.\nPrévois un en-cas à 16 h.' });

    expect(requests).toMatchSnapshot();
  });

  it('reports each call once, with Anthropic’s token counts', async () => {
    const claude = ai();
    await claude.analyzeMeal(mealInput);
    await claude.coach(coachInput);
    expect(usage).toEqual([
      { feature: 'meal', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 40, durationMs: 0, ok: true },
      { feature: 'coach', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 40, durationMs: 0, ok: true },
    ]);
  });

  it('maps an answer that isn’t the schema’s JSON to ai_bad_output', async () => {
    respond = () => json(message([{ type: 'text', text: 'Je ne peux pas analyser ce repas.' }], 'refusal'));
    await expect(ai().analyzeMeal(mealInput)).rejects.toMatchObject({ status: 424, code: 'ai_bad_output' });
    expect(usage.map((u) => [u.feature, u.ok, u.error])).toEqual([['meal', false, 'ai_bad_output']]);
  });

  it('maps a bad key to the app’s code', async () => {
    const claude = ai();
    respond = () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    await expect(claude.draftPlan(planInput)).rejects.toMatchObject({ status: 424, code: 'ai_misconfigured' });
    expect(usage.map((u) => [u.feature, u.ok, u.error])).toEqual([['plan', false, 'ai_misconfigured']]);
  });
});
