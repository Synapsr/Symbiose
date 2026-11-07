import { NUTRIENT_META, roundNutrient, type Locale, type NutrientKey, type Target } from '@symbiose/shared';

import type { PluralKey, TranslationKey } from '@/i18n';

import { formatClockTime, formatNumber, formatSleep } from '../format';
import { frenchTypography } from '../french';
import { CONTENT_WIDTH, esc, lineCount, SECTION_GAP, type Block } from './layout';

/** The words of the report, in the person's language (the app's dictionaries). */
export interface Copy {
  locale: Locale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  plural: (key: PluralKey, count: number, params?: Record<string, string | number>) => string;
}

/** Formatting in the report's language, with French typography applied before escaping. */
export function formatters(copy: Copy) {
  const { locale } = copy;
  const tag = locale === 'fr' ? 'fr-FR' : 'en-US';
  const typo = (text: string) => (locale === 'fr' ? frenchTypography(text, '\u202F') : text);
  const dateOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, 12);
  };
  const num = (value: number, decimals = 0) => formatNumber(value, locale, decimals);
  /** Always one decimal (« 77,0 kg »), so a column of weights lines up. */
  const fixed = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const one = (value: number) => fixed.format(value).replace(/\u202F/g, '\u00A0');
  return {
    /** Copy or the person's words, typeset and escaped. */
    text: (text: string) => esc(typo(text)),
    t: (key: TranslationKey, params?: Record<string, string | number>) => esc(typo(copy.t(key, params))),
    plural: (key: PluralKey, count: number, params?: Record<string, string | number>) => esc(typo(copy.plural(key, count, params))),
    num,
    /** « 25 g », « 1 850 kcal », « 830 mg ». */
    amount: (key: NutrientKey, value: number) => {
      const rounded = roundNutrient(key, value);
      return `${num(rounded, rounded < 10 && key !== 'kcal' && key !== 'sodium' ? 1 : 0)}\u00A0${NUTRIENT_META[key].unit}`;
    },
    nutrient: (key: NutrientKey) => NUTRIENT_META[key].label[locale],
    kg: (value: number) => `${one(value)}\u00A0kg`,
    signedKg: (value: number) => `${value > 0.05 ? '+' : value < -0.05 ? '−' : ''}${one(Math.abs(value))}\u00A0kg`,
    /** « 7 h 40 », « 7:40 »: never split across lines. */
    clock: (time: string) => formatClockTime(time, locale).replaceAll(' ', '\u00A0'),
    /** « 6 h 41 », « 6h 41m ». */
    sleep: (minutes: number) => formatSleep(minutes, locale).replaceAll(' ', '\u00A0'),
    /** « 3 nov. ». */
    short: (date: string) => dateOf(date).toLocaleDateString(tag, { day: 'numeric', month: 'short' }),
    /** « 10 août – 7 nov. 2026 », « Aug 10 – Nov 7, 2026 »: the period in a running header. */
    span: (from: string, to: string) => {
      const year = to.slice(0, 4);
      if (from.slice(0, 4) !== year) return `${dateOf(from).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' })} – ${dateOf(to).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' })}`;
      const short = (date: string) => dateOf(date).toLocaleDateString(tag, { day: 'numeric', month: 'short' });
      return `${short(from)} – ${short(to)}${locale === 'en' ? ',' : ''} ${year}`;
    },
    /** « 3 novembre 2026 ». */
    long: (date: string) => dateOf(date).toLocaleDateString(tag, { day: 'numeric', month: 'long', year: 'numeric' }),
    /** « lundi 3 novembre ». */
    weekday: (date: string) => {
      const text = dateOf(date).toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' });
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
    /** « ≤ 25 g », « ≥ 90 g », « ≈ 2 150 kcal ». */
    target: (key: NutrientKey, target: Target) => {
      const sign = target.kind === 'max' ? '≤' : target.kind === 'min' ? '≥' : '≈';
      const rounded = roundNutrient(key, target.value);
      return `${sign}\u00A0${num(rounded, rounded < 10 && key !== 'kcal' && key !== 'sodium' ? 1 : 0)}\u00A0${NUTRIENT_META[key].unit}`;
    },
  };
}
export type Formatters = ReturnType<typeof formatters>;

/** A section's heading, with what it shows in a line or two; it opens the section in the contents. */
export function sectionHead(anchor: string, title: string, subtitle?: string): Block {
  const lines = subtitle ? Math.min(3, lineCount(subtitle, CONTENT_WIDTH - 12, 11)) : 0;
  const height = 25 + (lines ? 3 + lines * 16 : 0) + 10;
  return {
    height,
    anchor,
    keepWithNext: true,
    gapBefore: SECTION_GAP,
    html: `<div class="sec"><div class="t"><i></i>${title}</div>${subtitle ? `<div class="s" style="-webkit-line-clamp:${lines};height:${lines * 16}px">${subtitle}</div>` : ''}</div>`,
  };
}

/** A smaller heading inside a section (« Principales sources »). */
export function subHead(title: string): Block {
  return { height: 18, keepWithNext: true, tightAfter: true, html: `<div class="sub">${title}</div>` };
}

export interface Kpi {
  label: string;
  value: string;
  /** A unit or a short qualifier after the value, smaller. */
  unit?: string;
  sub?: string;
}

/** A row of key figures: label, value, and what it is measured against. */
export function kpis(items: readonly Kpi[]): Block {
  const tiles = items
    .map((k) => `<div class="kpi"><div class="l">${k.label}</div><div class="v">${k.value}${k.unit ? ` <small>${k.unit}</small>` : ''}</div>${k.sub ? `<div class="s">${k.sub}</div>` : ''}</div>`)
    .join('');
  return { height: 66, keepWithNext: true, html: `<div class="kpis">${tiles}</div>` };
}

/** A chart with its title and a one-line summary on the right. */
export function chartBlock(title: string, summary: string, svg: string, svgHeight: number, width = CONTENT_WIDTH, legend?: string): Block {
  const legendRow = legend ? `<div class="legend" style="margin-top:6px">${legend}</div>` : '';
  return {
    height: 18 + 6 + svgHeight + (legend ? 20 : 0),
    html: `<div class="chart" style="width:${width}px"><div class="head"><span class="t">${title}</span><span class="s">${summary}</span></div>${svg}${legendRow}</div>`,
  };
}

/** Legend entries: a mark and its name. */
export function legend(entries: readonly { mark: string; label: string }[]): string {
  return entries.map((e) => `<span>${e.mark}${e.label}</span>`).join('');
}

/** A soft panel with a short title and a paragraph. */
export function noteBlock(title: string, body: string, rawBody: string, width = CONTENT_WIDTH): Block {
  const lines = Math.min(8, lineCount(rawBody, width - 32, 10.5));
  return {
    height: 24 + 14 + 3 + lines * 15,
    html: `<div class="panel note"><div class="over">${title}</div><div class="p" style="-webkit-line-clamp:${lines};height:${lines * 15}px">${body}</div></div>`,
  };
}
