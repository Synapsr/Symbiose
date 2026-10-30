import { SHORT_NIGHT_MIN, type SleepTrend } from '@symbiose/shared';
import { Moon } from 'lucide-react-native';
import { View } from 'react-native';

import { DayBars } from '@/components/insights/charts';
import { Card, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber, formatSleep, weekdayInitial } from '@/lib/format';
import { health } from '@/lib/health';
import { LIFE_COLORS, Space, useTheme } from '@/theme';

/** How regular the hours are, from the spread of the middle of the night. */
function regularityKey(minutes: number): TranslationKey {
  if (minutes <= 30) return 'sleep.regular';
  if (minutes <= 60) return 'sleep.fairlyRegular';
  return 'sleep.irregular';
}

/** Nights of the period: the average, the usual hours and how regular they are, and how short nights relate to cravings. */
export function SleepCard({ trend, dates }: { trend: SleepTrend; dates: string[] }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const asleep = new Map(trend.nights.map((n) => [n.localDate, n.asleepMin]));
  const cravings = trend.cravingsAfterShortNights;

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row gap={6}>
          <Moon size={14} color={colors.text2} />
          <Txt variant="label" tone="secondary">
            {t('sleep.title')}
          </Txt>
        </Row>
        {trend.averageMin !== null ? (
          <>
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {formatSleep(trend.averageMin, locale)}
              </Txt>
              <Txt tone="secondary">{t('sleep.average')}</Txt>
            </Row>
            {trend.bedtime && trend.wakeTime ? (
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {t('sleep.schedule', { bedtime: trend.bedtime, wake: trend.wakeTime })}
              </Txt>
            ) : null}
          </>
        ) : (
          <Txt tone="secondary" style={{ marginTop: Space.xs }}>
            {health.source ? t('sleep.empty', { store: health.storeName[locale] }) : t('sleep.emptyNoStore')}
          </Txt>
        )}
      </View>

      {trend.nights.length ? (
        <DayBars
          values={dates.map((date) => asleep.get(date) ?? null)}
          labels={dates.map((date) => weekdayInitial(date, locale))}
          target={SHORT_NIGHT_MIN}
          kind="min"
          color={LIFE_COLORS.sleep}
          softUnder
        />
      ) : null}

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
    </Card>
  );
}
