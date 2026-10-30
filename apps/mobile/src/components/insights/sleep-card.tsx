import { SHORT_NIGHT_MIN, type SleepTrend } from '@symbiose/shared';
import { Moon } from 'lucide-react-native';

import { DayBars, MiniBars } from '@/components/insights/charts';
import { ExpandRow } from '@/components/insights/expand-row';
import { Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber, formatSleep, weekdayInitial } from '@/lib/format';
import { LIFE_COLORS, useTheme } from '@/theme';

/** How regular the hours are, from the spread of the middle of the night. */
function regularityKey(minutes: number): TranslationKey {
  if (minutes <= 30) return 'sleep.regular';
  if (minutes <= 60) return 'sleep.fairlyRegular';
  return 'sleep.irregular';
}

/** Nights of the period in one line (the average and the usual hours); the nights, their regularity and the link to cravings underneath. */
export function SleepTrendRow({ trend, dates, first }: { trend: SleepTrend; dates: string[]; first?: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const asleep = new Map(trend.nights.map((n) => [n.localDate, n.asleepMin]));
  const cravings = trend.cravingsAfterShortNights;
  const values = dates.map((date) => asleep.get(date) ?? null);

  return (
    <ExpandRow
      first={first}
      icon={<Moon size={17} color={colors.text} />}
      label={t('sleep.title')}
      value={trend.averageMin !== null ? t('life.perNight', { value: formatSleep(trend.averageMin, locale) }) : '—'}
      caption={trend.bedtime && trend.wakeTime ? t('sleep.schedule', { bedtime: trend.bedtime, wake: trend.wakeTime }) : null}
      chart={<MiniBars values={values} color={LIFE_COLORS.sleep} max={9 * 60} />}>
      <DayBars values={values} labels={dates.map((date) => weekdayInitial(date, locale))} target={SHORT_NIGHT_MIN} kind="min" color={LIFE_COLORS.sleep} softUnder />
      {trend.regularityMin !== null ? (
        <Txt variant="label" tone="secondary">
          {t(regularityKey(trend.regularityMin), { min: trend.regularityMin })}
        </Txt>
      ) : null}
      {cravings ? (
        <Txt variant="accent" tone="secondary" style={{ fontSize: 17, lineHeight: 24 }}>
          {t('sleep.cravings', { short: formatNumber(cravings.short, locale, 1), normal: formatNumber(cravings.normal, locale, 1) })}
        </Txt>
      ) : null}
    </ExpandRow>
  );
}
