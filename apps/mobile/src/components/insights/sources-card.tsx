import type { InsightsResponse, NutrientKey } from '@symbiose/shared';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { HourBars } from '@/components/insights/charts';
import { Bar, Card, Row, Segmented, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { NUTRIENT_COLORS, Space, useTheme } from '@/theme';

type Tab = 'foods' | 'hours' | 'cravings';

/** « D'où ça vient »: what brings the goal's nutrient, at what time of day, and the cravings, in one card. */
export function SourcesCard({ data, hero }: { data: InsightsResponse; hero: NutrientKey }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const color = hero === 'kcal' ? colors.accent : NUTRIENT_COLORS[hero];
  const sources = data.topSources[hero] ?? [];
  const hours = data.byHour.nutrient === hero && data.byHour.hours.some((h) => h > 0) ? data.byHour.hours : null;
  const tabs = [sources.length ? 'foods' : null, hours ? 'hours' : null, data.cravings.total > 0 ? 'cravings' : null].filter((tab): tab is Tab => tab !== null);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked && tabs.includes(picked) ? picked : tabs[0];
  if (!tab) return null;

  const peak = hours ? hours.indexOf(Math.max(...hours)) : 0;

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: Space.md }}>
        <Txt variant="label" tone="secondary" numberOfLines={1}>
          {t('insights.sources')}
          {tab !== 'cravings' ? ` · ${nutrient(hero).toLowerCase()}` : ''}
        </Txt>
        {tabs.length > 1 ? <Segmented value={tab} onChange={setPicked} options={tabs.map((value) => ({ value, label: t(`insights.tab.${value}`) }))} /> : null}
      </View>

      <Animated.View key={tab} entering={FadeIn.duration(200)} style={{ gap: Space.md }}>
        {tab === 'foods'
          ? sources.map((s) => (
              <View key={s.name} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                    {s.emoji} {s.name}{' '}
                    <Txt variant="caption" tone="tertiary">
                      ×{s.count}
                    </Txt>
                  </Txt>
                  <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                    {formatAmount(hero, s.amount, locale)}
                  </Txt>
                </Row>
                <Bar progress={s.amount / (sources[0]?.amount || 1)} color={color} height={6} />
              </View>
            ))
          : null}

        {tab === 'hours' && hours ? (
          <>
            <HourBars hours={hours} color={color} />
            <Txt variant="caption" tone="secondary">
              {t('insights.peak', { hour: peak })}
            </Txt>
          </>
        ) : null}

        {tab === 'cravings' ? (
          <View style={{ gap: 4 }}>
            <Txt variant="number">{t('insights.cravingsBody', { resisted: data.cravings.resisted, total: data.cravings.total })}</Txt>
            <Bar progress={data.cravings.resisted / data.cravings.total} color={colors.accent} height={6} />
            {data.cravings.topWhat.length ? (
              <Txt variant="caption" tone="tertiary" style={{ marginTop: Space.xs }}>
                {t('insights.cravingsTop', { list: data.cravings.topWhat.join(', ') })}
              </Txt>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </Card>
  );
}
