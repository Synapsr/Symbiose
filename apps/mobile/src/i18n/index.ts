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

export const LocaleContext = createContext<Locale>(deviceLocale());

export function useI18n() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    nutrient: (key: NutrientKey) => NUTRIENT_META[key].label[locale],
    nutrientShort: (key: NutrientKey) => NUTRIENT_META[key].short[locale],
  };
}

export type { TranslationKey };
