/**
 * How dictated words land in a field, kept free of React Native so it can be
 * unit tested on its own (`pnpm --filter @symbiose/mobile test`).
 */
import type { Locale } from '@symbiose/shared';

/**
 * The field's text while dictating: what was there before, then every
 * finished stretch of speech, then the one still being heard. Recognisers cut
 * a long dictation into stretches at each pause (iOS 18, Android, the web),
 * some with a leading space and some without; they are joined with one.
 */
export function dictated(base: string, segments: readonly string[], partial: string): string {
  const spoken = [...segments, partial]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
  if (!spoken) return base;
  if (!base.trim()) return capitalize(spoken);
  const sentenceEnded = /[.!?…]\s*$/.test(base);
  const words = sentenceEnded ? capitalize(spoken) : spoken;
  return /\s$/.test(base) ? `${base}${words}` : `${base} ${words}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * The recogniser's language: the app's, in the person's own region when the
 * device has one for it (fr-BE, en-GB), so accents and spellings match.
 */
export function speechLocale(locale: Locale, deviceTags: readonly string[]): string {
  const regional = deviceTags.find((tag) => tag.toLowerCase().startsWith(`${locale}-`));
  return regional ?? (locale === 'fr' ? 'fr-FR' : 'en-US');
}
