import type { HydrationTrend } from '@symbiose/shared';
import { GlassWater } from 'lucide-react-native';

import { DayBars, MiniBars } from '@/components/insights/charts';
import { ExpandRow } from '@/components/insights/expand-row';
import { Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatLiters, weekdayInitial } from '@/lib/format';
import { LIFE_COLORS, useTheme } from '@/theme';

/** Drinks of the period in one line: the average and the days the goal was reached; the days and the goal underneath. */
export function WaterTrendRow({ trend, today, first }: { trend: HydrationTrend; today: string; first?: boolean }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  // The goal grows a little on workout days: the line shows the everyday one, and today's when it differs (as on Today).
  const baseGoal = Math.min(...trend.days.map((d) => d.goalMl));
  const todayGoal = trend.days.find((d) => d.date === today)?.goalMl;
  const values = trend.days.map((d) => (d.ml > 0 ? d.ml : null));

  return (
    <ExpandRow
      first={first}
      icon={<GlassWater size={17} color={colors.text} />}
      label={t('water.title')}
      value={trend.averageMl !== null ? t('life.perDay', { value: formatLiters(trend.averageMl, locale) }) : '—'}
      caption={plural('water.daysReached', trend.daysReached, { total: trend.windowDays })}
      captionColor={trend.daysReached > 0 ? colors.accent : undefined}
      chart={<MiniBars values={values} color={LIFE_COLORS.water} max={baseGoal} />}>
      <DayBars values={values} labels={trend.days.map((d) => weekdayInitial(d.date, locale))} target={baseGoal} kind="min" color={LIFE_COLORS.water} softUnder />
      <Txt variant="caption" tone="tertiary">
        {t('water.goalLine', { goal: formatLiters(baseGoal, locale) })}
        {todayGoal && todayGoal !== baseGoal ? ` ${t('water.goalToday', { goal: formatLiters(todayGoal, locale) })}` : ''}
      </Txt>
    </ExpandRow>
  );
}
