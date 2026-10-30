import type { DaySummary, NutrientKey } from '@symbiose/shared';

import type { TranslationKey } from '@/i18n';

import { formatAmount, formatNumber } from './format';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function greeting(t: T, name: string, hour = new Date().getHours()): string {
  if (!name) return t('hello.anon');
  const key: TranslationKey = hour < 12 ? 'hello.morning' : hour < 18 ? 'hello.afternoon' : 'hello.evening';
  return t(key, { name });
}

/** One warm, specific sentence about where the day stands for the metric that matters; in the past tense for a past day. */
export function dayVoice(day: DaySummary, hero: NutrientKey, t: T, nutrientName: (k: NutrientKey) => string, locale: 'fr' | 'en', past = false): string {
  if (!day.meals.length) return past ? t('voice.past.empty') : t(new Date().getHours() < 11 ? 'voice.empty.morning' : 'voice.empty.later');
  const p = day.progress.find((x) => x.nutrient === hero);
  if (!p) return '';
  const left = p.target.value - p.consumed;
  const name = nutrientName(hero).toLowerCase();
  if (hero === 'kcal') {
    if (past) return left >= 0 ? t('voice.past.kcal.under', { left: formatNumber(left, locale) }) : t('voice.past.kcal.over', { over: formatNumber(-left, locale) });
    return left >= 0 ? t('voice.kcal.under', { left: formatNumber(left, locale) }) : t('voice.kcal.over', { over: formatNumber(-left, locale) });
  }
  const amount = (v: number) => formatAmount(hero, v, locale);
  if (past) {
    if (p.target.kind === 'min') return left <= 0 ? t('voice.past.min.reached', { nutrient: name }) : t('voice.past.min.under', { left: amount(left), nutrient: name });
    return left < 0 ? t('voice.past.max.over', { over: amount(-left), nutrient: name }) : t('voice.past.max.under', { left: amount(left), nutrient: name });
  }
  if (p.target.kind === 'min') {
    return left <= 0 ? t('voice.min.reached', { nutrient: name }) : t('voice.min.under', { left: amount(left), nutrient: name });
  }
  if (left < 0) return t('voice.max.over', { over: amount(-left), nutrient: name });
  if (p.ratio >= 0.8) return t('voice.max.close', { left: amount(left), nutrient: name });
  return t('voice.max.under', { left: amount(left), nutrient: name });
}
