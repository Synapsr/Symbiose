/** USD per million tokens. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A model's rates; some models charge more once the prompt passes `LONG_PROMPT_TOKENS`. */
export type ModelPrice = Rates & { long?: Rates };

export const LONG_PROMPT_TOKENS = 100_000;

/** Cache reads cost a tenth of the input unless the model says otherwise; writes 1.25× (the 5-minute cache Symbiose uses). */
function claude(input: number, output: number, cacheRead = input * 0.1): Rates {
  return { input, output, cacheRead, cacheWrite: input * 1.25 };
}

/** Claude's published prices (Anthropic's model catalog). Other models only get a cost through `AI_PRICES`. */
const CLAUDE_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': claude(10, 50, 0.25),
  'claude-mythos-5-1': claude(10, 50, 0.25),
  'claude-fable-5': claude(10, 50, 1),
  'claude-mythos-5': claude(10, 50, 1),
  'claude-opus-5-5': claude(4, 20, 0.2),
  'claude-opus-5': claude(5, 25),
  'claude-opus-4-8': claude(5, 25),
  'claude-sonnet-5-5': claude(2, 10, 0.2),
  'claude-sonnet-5': claude(2, 10, 0.2),
  'claude-haiku-5-5': { ...claude(0.1, 0.5), long: claude(0.5, 2.5) },
};

/**
 * `AI_PRICES`: `model=input/output[/cacheRead[/cacheWrite]]`, USD per million
 * tokens, comma-separated (`my-model=1.25/10/0.125,gemma4=0/0`).
 * Cache tokens cost the input price unless given. Wins over the built-in prices.
 */
export function parsePrices(value: string | undefined): { prices: Record<string, Rates>; invalid: string[] } {
  const prices: Record<string, Rates> = {};
  const invalid: string[] = [];
  for (const entry of (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.lastIndexOf('=');
    const model = entry.slice(0, at).trim();
    const numbers = entry.slice(at + 1).split('/').map((n) => (n.trim() === '' ? NaN : Number(n)));
    if (at <= 0 || numbers.length < 2 || numbers.length > 4 || numbers.some((n) => !Number.isFinite(n) || n < 0)) {
      invalid.push(entry);
      continue;
    }
    const [input, output, cacheRead = input, cacheWrite = input] = numbers as [number, number, number?, number?];
    prices[model] = { input, output, cacheRead, cacheWrite };
  }
  return { prices, invalid };
}

/** The price of a model: an override first, then Claude's; a dated id (`-20261001`, `-2026-09-01`) is priced as its alias. */
export function priceOf(model: string, overrides: Record<string, Rates> = {}): ModelPrice | null {
  const alias = model.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return overrides[model] ?? overrides[alias] ?? CLAUDE_PRICES[alias] ?? null;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD for these tokens at these rates. */
export function costOf(tokens: TokenCounts, rates: Rates): number {
  return (tokens.inputTokens * rates.input + tokens.outputTokens * rates.output + tokens.cacheReadTokens * rates.cacheRead + tokens.cacheWriteTokens * rates.cacheWrite) / 1_000_000;
}
