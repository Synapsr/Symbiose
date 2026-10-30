import { addDays, NUTRIENT_META, roundNutrient, toLocalDate, type Locale, type NutrientKey } from '@symbiose/shared';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * "1 880", "2,5". French groups thousands with a narrow no-break space
 * (U+202F) that Fraunces barely draws, so it becomes a regular no-break space.
 */
export function formatNumber(value: number, locale: Locale, decimals = 0): string {
  const key = `${locale}:${decimals}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
    formatters.set(key, formatter);
  }
  return formatter.format(value).replace(/\u202F/g, '\u00A0');
}

/** "12 g", "1 240 kcal", "830 mg". */
export function formatAmount(key: NutrientKey, value: number, locale: Locale, withUnit = true): string {
  const rounded = roundNutrient(key, value);
  const text = formatNumber(rounded, locale, rounded < 10 && key !== 'kcal' && key !== 'sodium' ? 1 : 0);
  return withUnit ? `${text} ${NUTRIENT_META[key].unit}` : text;
}

export function unitOf(key: NutrientKey): string {
  return NUTRIENT_META[key].unit;
}

/** "7 h 05" / "7h 05m", "45 min". */
export function formatSleep(minutes: number, locale: Locale): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, '0');
  if (h === 0) return `${total} min`;
  if (locale === 'fr') return total % 60 ? `${h} h ${m}` : `${h} h`;
  return total % 60 ? `${h}h ${m}m` : `${h}h`;
}

/** "1,25 L", "0.5 L". */
export function formatLiters(ml: number, locale: Locale): string {
  return `${formatNumber(ml / 1000, locale, 2)} L`;
}

/** "Aujourd'hui", "Hier", "jeudi 30 oct." */
export function formatDay(localDate: string, locale: Locale, labels: { today: string; yesterday: string }): string {
  const today = toLocalDate();
  if (localDate === today) return labels.today;
  if (localDate === addDays(today, -1)) return labels.yesterday;
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

export function weekdayInitial(localDate: string, locale: Locale): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'narrow' }).toUpperCase();
}

export function dayOfMonth(localDate: string): string {
  return String(Number(localDate.slice(8, 10)));
}
