import type { AdaptiveEnergy, BloodPressureTrend, GoalPlan, WeightTrend } from '@symbiose/shared';
import { HeartPulse, Scale } from 'lucide-react-native';
import { View } from 'react-native';

import { AdaptiveEnergyRow } from '@/components/insights/adaptive-energy-card';
import { BpChart, categoryColor, DIASTOLIC, LatestReading, needsDoctor } from '@/components/insights/blood-pressure-card';
import { MiniLine } from '@/components/insights/charts';
import { ExpandRow, RowsCard } from '@/components/insights/expand-row';
import { WeightChart } from '@/components/insights/weight-card';
import { Dot, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { Space, useTheme } from '@/theme';

/** Where a day sits in the period, for the mini charts. */
const placeIn = (from: string, to: string) => (date: string) => (Date.parse(date) - Date.parse(from)) / Math.max(1, Date.parse(to) - Date.parse(from));

/**
 * « Corps », read-only: weight over the period, blood pressure when it's tracked, and the measured
 * expenditure for weight goals. Weigh-ins and readings are added from Today.
 */
export function BodyCard({
  weight,
  bloodPressure,
  adaptive,
  plan,
  from,
  to,
}: {
  weight: WeightTrend | null;
  /** Undefined when blood pressure isn't tracked. */
  bloodPressure: BloodPressureTrend | null | undefined;
  /** Null when it shouldn't show (not a weight goal yet, calories hidden). */
  adaptive: AdaptiveEnergy | null;
  plan: GoalPlan | null;
  from: string;
  to: string;
}) {
  const { t } = useI18n();
  return (
    <RowsCard title={t('insights.body')}>
      {weight ? <WeightRow weight={weight} plan={plan} from={from} to={to} /> : null}
      {bloodPressure !== undefined ? <BloodPressureRow trend={bloodPressure} from={from} to={to} first={!weight} /> : null}
      {adaptive ? <AdaptiveEnergyRow adaptive={adaptive} enabled={Boolean(plan?.adaptiveEnergy)} /> : null}
    </RowsCard>
  );
}

function WeightRow({ weight, plan, from, to }: { weight: WeightTrend; plan: GoalPlan | null; from: string; to: string }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  // The server keeps a longer window for the trend; the card follows the period on screen.
  const points = weight.points.filter((p) => p.date >= from);
  const first = points[0];
  const last = points.at(-1);
  const change = first && last && last.date > first.date ? Math.round((last.kg - first.kg) * 10) / 10 : null;
  // Green when it goes the way the plan wants, neutral otherwise.
  const wanted = plan?.calorieMode === 'deficit' ? -1 : plan?.calorieMode === 'surplus' ? 1 : 0;
  const changeColor = change === null || Math.abs(change) < 0.2 || wanted === 0 ? colors.text2 : Math.sign(change) === wanted ? colors.accent : colors.warning;
  const latest = last ?? weight.latest;
  const date = (localDate: string) => {
    const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' });
  };
  const caption = change !== null
    ? `${change > 0 ? '+' : change < 0 ? '−' : '±'}${formatNumber(Math.abs(change), locale, 1)} kg · ${t('weight.window', { days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 })}`
    : !last && weight.latest
      ? t('weight.last', { date: date(weight.latest.date) })
      : !latest
        ? t('weight.empty')
        : null;
  const x = placeIn(from, to);

  return (
    <ExpandRow
      first
      icon={<Scale size={17} color={colors.text} />}
      label={t('insights.weight')}
      value={latest ? `${formatNumber(latest.kg, locale, 1)} kg` : '—'}
      caption={caption}
      captionColor={change !== null ? changeColor : undefined}
      chart={points.length > 1 ? <MiniLine points={points.map((p) => ({ x: x(p.date), y: p.kg }))} color={colors.accent} /> : null}>
      {points.length > 1 ? <WeightChart points={points} color={colors.accent} /> : null}
    </ExpandRow>
  );
}

function BloodPressureRow({ trend, from, to, first }: { trend: BloodPressureTrend | null; from: string; to: string; first: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const points = trend?.points.filter((p) => p.date >= from) ?? [];
  const shown = trend?.average7 ?? (trend?.latest ? { systolic: trend.latest.systolic, diastolic: trend.latest.diastolic } : null);
  const category = trend?.category ?? null;
  const x = placeIn(from, to);
  const caption = category ? `${t(`bp.category.${category}` as TranslationKey)}${needsDoctor(category) ? ` · ${t('bp.doctor')}` : trend?.average7 ? ` · ${t('bp.average7').toLowerCase()}` : ''}` : t('bp.none');

  return (
    <ExpandRow
      first={first}
      icon={<HeartPulse size={17} color={colors.text} />}
      label={t('bp.title')}
      value={shown ? `${Math.round(shown.systolic)}/${Math.round(shown.diastolic)} mmHg` : '—'}
      caption={caption}
      captionColor={category && needsDoctor(category) ? colors.warning : undefined}
      chart={points.length > 1 ? <MiniLine points={points.map((p) => ({ x: x(p.date), y: p.systolic }))} color={category ? categoryColor(category, colors) : colors.accent} /> : null}>
      {points.length > 1 || trend?.latest ? (
        <View style={{ gap: Space.sm }}>
          {points.length > 1 ? (
            <>
              <BpChart points={points} color={colors.accent} />
              <Row gap={Space.lg}>
                <Row gap={6}>
                  <Dot color={colors.accent} size={6} />
                  <Txt variant="caption" tone="secondary">
                    {t('bp.systolic')}
                  </Txt>
                </Row>
                <Row gap={6}>
                  <Dot color={DIASTOLIC} size={6} />
                  <Txt variant="caption" tone="secondary">
                    {t('bp.diastolic')}
                  </Txt>
                </Row>
              </Row>
            </>
          ) : null}
          {trend?.latest ? <LatestReading reading={trend.latest} /> : null}
        </View>
      ) : null}
    </ExpandRow>
  );
}
