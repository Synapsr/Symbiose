import type { AdaptiveEnergy, ExpenditureConfidence } from '@symbiose/shared';
import { Gauge } from 'lucide-react-native';
import { View } from 'react-native';

import { ExpandRow } from '@/components/insights/expand-row';
import { Bar, Dot, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { Space, useTheme } from '@/theme';

const FILLED: Record<ExpenditureConfidence, number> = { low: 1, medium: 2, high: 3 };

export const signed = (value: number, text: string) => (value > 0 ? `+${text}` : value < 0 ? `−${text}` : text);

/**
 * What the person really burns, measured from their meals and weight trend, next to the formula;
 * or, kindly, what's still missing to measure it. Read-only: the switch that lets the budget
 * follow it lives in Me, with the other goal settings.
 */
export function AdaptiveEnergyRow({ adaptive, enabled }: { adaptive: AdaptiveEnergy; enabled: boolean }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const { estimate, confidence, data, window } = adaptive;
  const kcal = (value: number) => formatNumber(value, locale);
  const measured = estimate !== null && confidence !== null;
  const applied = enabled && adaptive.enabled && adaptive.appliedKcal !== 0;

  return (
    <ExpandRow
      icon={<Gauge size={17} color={colors.text} />}
      label={measured ? t('energy.title') : t('energy.titleShort')}
      value={measured ? `${kcal(estimate)} ${t('energy.perDay')}` : missingText(adaptive, t)}
      caption={
        measured
          ? `${t('energy.formula', { kcal: kcal(adaptive.formula) })}${adaptive.difference ? ` · ${signed(adaptive.difference, kcal(Math.abs(adaptive.difference)))}` : ''}`
          : null
      }>
      {measured ? (
        <View style={{ gap: 6 }}>
          <Row gap={Space.sm}>
            <Row gap={3}>
              {[1, 2, 3].map((n) => (
                <Dot key={n} size={6} color={n <= FILLED[confidence] ? (confidence === 'low' ? colors.text2 : colors.accent) : colors.surface2} />
              ))}
            </Row>
            <Txt variant="caption" tone="secondary">
              {t(`energy.confidence.${confidence}` as TranslationKey)}
            </Txt>
          </Row>
          <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {t('energy.data', { days: window.days, complete: data.completeDays, weighIns: data.weighIns })}
            {data.trendKgPerWeek !== null ? ` · ${t('energy.trend', { value: signed(data.trendKgPerWeek, formatNumber(Math.abs(data.trendKgPerWeek), locale, 1)) })}` : ''}
          </Txt>
          {adaptive.clamped ? (
            <Txt variant="caption" tone="tertiary">
              {t('energy.clamped')}
            </Txt>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: Space.md }}>
          <Txt variant="caption" tone="secondary">
            {t('energy.how')}
          </Txt>
          <Progress label={t('energy.progress.weighIns')} done={data.weighIns} needed={data.weighIns + adaptive.missing.weighIns} />
          <Progress label={t('energy.progress.days')} done={data.completeDays} needed={data.completeDays + adaptive.missing.completeDays} />
        </View>
      )}
      {enabled ? (
        <Txt variant="caption" tone={applied ? 'accent' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
          {applied ? t('energy.autoApplied', { kcal: signed(adaptive.appliedKcal, kcal(Math.abs(adaptive.appliedKcal))) }) : t('energy.autoWaiting')}
        </Txt>
      ) : null}
    </ExpandRow>
  );
}

/** « Encore 5 pesées et 6 jours bien notés, sur les 11 prochains jours ». */
function missingText(adaptive: AdaptiveEnergy, t: ReturnType<typeof useI18n>['t']): string {
  const { missing } = adaptive;
  const parts = [
    missing.weighIns > 0 ? t(missing.weighIns === 1 ? 'energy.missing.weighIns.one' : 'energy.missing.weighIns.other', { count: missing.weighIns }) : null,
    missing.completeDays > 0 ? t(missing.completeDays === 1 ? 'energy.missing.days.one' : 'energy.missing.days.other', { count: missing.completeDays }) : null,
  ].filter((part) => part !== null);
  if (!parts.length) return t(missing.days === 1 ? 'energy.missing.wait.one' : 'energy.missing.wait.other', { count: Math.max(missing.days, 1) });
  return t('energy.missing.lead', { list: parts.join(t('energy.missing.and')) });
}

function Progress({ label, done, needed }: { label: string; done: number; needed: number }) {
  const { colors } = useTheme();
  const reached = done >= needed;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="secondary">
          {label}
        </Txt>
        <Txt variant="caption" tone={reached ? 'accent' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
          {done} / {needed}
          {reached ? ' ✓' : ''}
        </Txt>
      </Row>
      <Bar progress={needed ? done / needed : 0} color={colors.accent} height={6} />
    </View>
  );
}
