import type { MealType } from './schemas';

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the runtime's local time zone. */
export function toLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO 8601 timestamp in local time with its UTC offset (2026-10-30T16:05:00+01:00). */
export function toLocalDateTime(date: Date = new Date()): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${toLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Local hour (0..23) of a timestamp produced by `toLocalDateTime`. */
export function localHour(localDateTime: string): number {
  const hour = Number(localDateTime.slice(11, 13));
  return Number.isFinite(hour) ? hour : 12;
}

/** Local "HH:MM" of a timestamp produced by `toLocalDateTime`. */
export function localTime(localDateTime: string): string {
  return localDateTime.slice(11, 16);
}

/** Calendar arithmetic on YYYY-MM-DD strings, independent of time zones. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** Monday of the week containing `localDate`. */
export function startOfWeek(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(localDate, -weekday);
}

export function mealTypeForHour(hour: number): MealType {
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'snack';
}
