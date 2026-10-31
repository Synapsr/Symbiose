import type { AdminOverview, AiTotals } from '@symbiose/shared';
import { View } from 'react-native';

import { formatCompact, formatMs, formatShare, formatUsd } from '@/components/admin/format';
import { CardTitle, Rule, Stats } from '@/components/admin/parts';
import { DayBars } from '@/components/insights/charts';
import { AnimatedNumber, Bar, Card, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber, weekdayInitial } from '@/lib/format';
import { Space, useTheme } from '@/theme';

const FEATURES: Record<string, TranslationKey> = {
  meal: 'admin.feature.meal',
  plan: 'admin.feature.plan',
  coach: 'admin.feature.coach',
  craving: 'admin.feature.craving',
  review: 'admin.feature.review',
  morning: 'admin.feature.morning',
  nudges: 'admin.feature.nudges',
};

const tokensOf = (totals: AiTotals) => totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;

/**
 * What the AI costs over the period: the estimated cost (tokens when no price is known), a bar a
 * day against the daily average, what it is spent on, and how well it answers.
 */
export function AiCard({ ai }: { ai: AdminOverview['ai'] }) {
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const priced = ai.costUsd !== null;
  // Cost when it is known, tokens otherwise: the same measure for the number, the bars and the uses.
  const measure = (totals: AiTotals) => (priced ? (totals.costUsd ?? 0) : tokensOf(totals));
  const format = (value: number) => (priced ? formatUsd(value, locale) : formatCompact(value, locale));
  const calls = (count: number) => plural('admin.calls', count, { count: formatNumber(count, locale) });

  if (!ai.calls) {
    return (
      <Card style={{ gap: Space.md }}>
        <CardTitle color={colors.accent} label={t('admin.ai')} />
        <Txt tone="secondary">{t('admin.aiNone')}</Txt>
      </Card>
    );
  }

  const values = ai.daily.map((day) => (day.calls ? measure(day) : null));
  const average = measure(ai) / ai.daily.length;
  const top = Math.max(...ai.byFeature.map(measure), Number.MIN_VALUE);

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <CardTitle color={colors.accent} label={priced ? t('admin.aiCost') : t('admin.aiTokens')} right={calls(ai.calls)} />
        <AnimatedNumber value={measure(ai)} format={format} style={{ fontSize: 40 }} />
        <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {priced ? `${t('admin.tokens', { count: formatCompact(tokensOf(ai), locale) })} · ` : ''}
          {ai.cacheHitShare !== null ? t('admin.cache', { share: formatShare(ai.cacheHitShare, locale) }) : null}
        </Txt>
      </View>

      <View style={{ gap: Space.sm }}>
        <DayBars values={values} labels={ai.daily.map((day) => weekdayInitial(day.date, locale))} target={average} kind="target" color={colors.accent} />
        <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
          {t('admin.perDay', { value: format(average) })}
        </Txt>
      </View>

      <Rule />

      <View style={{ gap: Space.md }}>
        {ai.byFeature.map((feature) => (
          <View key={feature.feature} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                {FEATURES[feature.feature] ? t(FEATURES[feature.feature]!) : feature.feature}{' '}
                <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
                  {calls(feature.calls)}
                </Txt>
              </Txt>
              <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {priced && feature.costUsd === null ? '—' : format(measure(feature))}
              </Txt>
            </Row>
            <Bar progress={measure(feature) / top} color={colors.accent} height={6} />
          </View>
        ))}
      </View>

      <Rule />

      <View style={{ gap: Space.md }}>
        <Stats
          items={[
            { label: t('admin.latency'), value: ai.latencyMs.p50 !== null ? formatMs(ai.latencyMs.p50, locale) : '—' },
            { label: t('admin.latency95'), value: ai.latencyMs.p95 !== null ? formatMs(ai.latencyMs.p95, locale) : '—' },
            { label: t('admin.errors'), value: formatShare(ai.errorRate, locale), tone: ai.errorRate >= 0.05 ? 'warning' : undefined },
          ]}
        />
        {ai.topErrors.length ? (
          <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
            {ai.topErrors.map((error) => `${error.code} ×${formatNumber(error.count, locale)}`).join(' · ')}
          </Txt>
        ) : null}
      </View>

      {ai.byModel.length > 1 ? (
        <View style={{ gap: 6 }}>
          {ai.byModel.map((model) => (
            <Row key={`${model.provider}/${model.model}`} style={{ justifyContent: 'space-between' }} gap={Space.md}>
              <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                {model.model} · {calls(model.calls)}
              </Txt>
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {model.costUsd !== null ? formatUsd(model.costUsd, locale) : t('admin.noPrice')}
              </Txt>
            </Row>
          ))}
        </View>
      ) : null}

      {ai.unpricedCalls ? (
        <Txt variant="caption" tone="tertiary">
          {priced ? plural('admin.unpriced', ai.unpricedCalls, { count: formatNumber(ai.unpricedCalls, locale) }) : t('admin.unpricedAll')}
        </Txt>
      ) : null}
    </Card>
  );
}
