import type { HydrationTrend } from '@symbiose/shared';
import { GlassWater } from 'lucide-react-native';
import { View } from 'react-native';

import { DayBars } from '@/components/insights/charts';
import { Card, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatLiters, weekdayInitial } from '@/lib/format';
import { LIFE_COLORS, Space, useTheme } from '@/theme';

/** Drinks per day against the goal, the average, and where the goal comes from. */
export function HydrationCard({ trend }: { trend: HydrationTrend }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  // The goal grows a little on workout days; the line shows the everyday one.
  const baseGoal = Math.min(...trend.days.map((d) => d.goalMl));

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row gap={6}>
          <GlassWater size={14} color={colors.text2} />
          <Txt variant="label" tone="secondary">
            {t('water.title')}
          </Txt>
        </Row>
        {trend.averageMl !== null ? (
          <>
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {formatLiters(trend.averageMl, locale)}
              </Txt>
              <Txt tone="secondary">{t('water.average')}</Txt>
            </Row>
            <Txt variant="label" tone={trend.daysReached > 0 ? 'accent' : 'secondary'}>
              {t('water.daysReached', { count: trend.daysReached, total: trend.windowDays })}
            </Txt>
          </>
        ) : (
          <Txt tone="secondary" style={{ marginTop: Space.xs }}>
            {t('water.empty')}
          </Txt>
        )}
      </View>

      {trend.daysLogged ? (
        <DayBars
          values={trend.days.map((d) => (d.ml > 0 ? d.ml : null))}
          labels={trend.days.map((d) => weekdayInitial(d.date, locale))}
          target={baseGoal}
          kind="min"
          color={LIFE_COLORS.water}
          softUnder
        />
      ) : null}

      <Txt variant="caption" tone="tertiary">
        {t('water.goalHint', { goal: formatLiters(baseGoal, locale) })}
      </Txt>
    </Card>
  );
}
