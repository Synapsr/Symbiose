import type { Locale } from '@symbiose/shared';

import { formatNumber } from '@/lib/format';

const nbsp = (text: string) => text.replace(/ /g, ' ');

/** "3,42 $" / "$3.42"; "< 0,01 $" for a fraction of a cent. */
export function formatUsd(value: number, locale: Locale): string {
  if (value > 0 && value < 0.01) return locale === 'fr' ? '< 0,01 $' : '< $0.01';
  const amount = nbsp(new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value));
  return locale === 'fr' ? `${amount} $` : `$${amount}`;
}

/** "840", "12,4 k", "2,1 M". */
export function formatCompact(value: number, locale: Locale): string {
  if (value < 1000) return formatNumber(value, locale);
  if (value < 1_000_000) return `${formatNumber(value / 1000, locale, value < 10_000 ? 1 : 0)} k`;
  return `${formatNumber(value / 1_000_000, locale, value < 10_000_000 ? 1 : 0)} M`;
}

/** "62 %" / "62%"; one decimal under 10 %. */
export function formatShare(share: number, locale: Locale): string {
  const value = formatNumber(share * 100, locale, share > 0 && share < 0.1 ? 1 : 0);
  return locale === 'fr' ? `${value} %` : `${value}%`;
}

/** "850 ms", "4,2 s". */
export function formatMs(ms: number, locale: Locale): string {
  return ms < 1000 ? `${formatNumber(ms, locale)} ms` : `${formatNumber(ms / 1000, locale, 1)} s`;
}

/** "12,4 Mo" / "12.4 MB". */
export function formatBytes(bytes: number, locale: Locale): string {
  const units = locale === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${formatNumber(value, locale, unit && value < 100 ? 1 : 0)} ${units[unit]}`;
}

/** "3 j 4 h" / "3d 4h", "2 h 05" / "2h 05m", "12 min". */
export function formatUptime(seconds: number, locale: Locale): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const fr = locale === 'fr';
  if (days) return fr ? `${days} j ${hours % 24} h` : `${days}d ${hours % 24}h`;
  if (hours) return fr ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${minutes} min`;
}

/** "30 oct." / "Oct 30", from an ISO date-time. */
export function formatShortDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
}
