/**
 * The words said or typed with a photo, kept free of React Native so they can
 * be unit tested on their own (`pnpm --filter @symbiose/mobile test`).
 */

/** How many times the camera says, beside its mic, that words can go with the photo. Using it once is enough. */
export const DESCRIBE_HINTS = 3;

/**
 * The caption over the viewfinder: what was said, on one line or a few, and
 * for a long description its end, where the voice is, cut at a word.
 */
export function captionTail(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const end = clean.slice(-max);
  const space = end.indexOf(' ');
  // One very long word: cut inside it rather than lose the whole line.
  return `…${space >= 0 && space < max / 4 ? end.slice(space + 1) : end}`;
}
