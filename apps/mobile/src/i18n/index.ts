import { NUTRIENT_META, type Locale, type NutrientKey } from '@symbiose/shared';
import { getLocales } from 'expo-localization';
import { createContext, useContext } from 'react';

import { en } from './en';
import { fr, type TranslationKey } from './fr';

const dictionaries = { fr, en } as const;

export function deviceLocale(): Locale {
  return getLocales()[0]?.languageCode === 'fr' ? 'fr' : 'en';
}

export function translate(locale: Locale, key: TranslationKey, params?: Record<string, string | number>): string {
  let text: string = dictionaries[locale][key] ?? fr[key];
  if (params) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

/** Keys that come in `.one` / `.other` forms, without the suffix. */
export type PluralKey = { [K in TranslationKey]: K extends `${infer Base}.one` ? Base : never }[TranslationKey];

/** French keeps 0 and 1 singular (« 0 jour », « 1 jour »); English only 1. */
export function pluralForm(locale: Locale, count: number): 'one' | 'other' {
  return (locale === 'fr' ? Math.abs(count) < 2 : count === 1) ? 'one' : 'other';
}

export const LocaleContext = createContext<Locale>(deviceLocale());

export function useI18n() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    /** « 1 jour », « 3 jours »: `{count}` is filled in. */
    plural: (key: PluralKey, count: number, params?: Record<string, string | number>) =>
      translate(locale, `${key}.${pluralForm(locale, count)}` as TranslationKey, { count, ...params }),
    nutrient: (key: NutrientKey) => NUTRIENT_META[key].label[locale],
    nutrientShort: (key: NutrientKey) => NUTRIENT_META[key].short[locale],
  };
}

export type { TranslationKey };
