import type { AdaptiveEnergy, ExpenditureConfidence } from '@symbiose/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge } from 'lucide-react-native';
import { Switch, View } from 'react-native';

import { Bar, Card, Dot, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useToday } from '@/lib/hooks';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { Space, useTheme } from '@/theme';

const FILLED: Record<ExpenditureConfidence, number> = { low: 1, medium: 2, high: 3 };

const signed = (value: number, text: string) => (value > 0 ? `+${text}` : value < 0 ? `−${text}` : text);

/**
 * What the person really burns, measured from their meals and weight trend,
 * next to the formula; or, kindly, what's still missing to measure it.
 */
export function AdaptiveEnergyCard({ adaptive }: { adaptive: AdaptiveEnergy }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const today = useToday();
  const queryClient = useQueryClient();
  const plan = user.plan;

  // Opting in starts a gradual ramp from today; the server keeps the date.
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      await api.saveGoals({ ...plan!, adaptiveEnergy: on ? { since: today } : null });
      return api.me();
    },
    onSuccess: (saved) => {
      haptics.success();
      setUser(saved);
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['day'] });
    },
    onError: () => haptics.warning(),
  });
  const enabled = toggle.isPending ? toggle.variables : Boolean(plan?.adaptiveEnergy);
  const { estimate, confidence, data, window } = adaptive;
  const kcal = (value: number) => formatNumber(value, locale);
  const applied = enabled && adaptive.enabled && adaptive.appliedKcal !== 0;

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row gap={6}>
          <Gauge size={14} color={colors.text2} />
          <Txt variant="label" tone="secondary">
            {estimate !== null ? t('energy.title') : t('energy.titleShort')}
          </Txt>
        </Row>
        {estimate !== null && confidence ? (
          <>
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 36 }}>
                {kcal(estimate)}
              </Txt>
              <Txt tone="secondary">{t('energy.perDay')}</Txt>
            </Row>
            <Txt variant="label" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
              {t('energy.formula', { kcal: kcal(adaptive.formula) })}
              {adaptive.difference ? ` · ${signed(adaptive.difference, kcal(Math.abs(adaptive.difference)))}` : ''}
            </Txt>
          </>
        ) : (
          <Txt variant="heading" style={{ marginTop: Space.xs, lineHeight: 24 }}>
            {missingText(adaptive, t)}
          </Txt>
        )}
      </View>

      {estimate !== null && confidence ? (
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

      {plan ? (
        <Row gap={Space.md} style={{ paddingTop: Space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="label">{t('energy.auto')}</Txt>
            <Txt variant="caption" tone={applied ? 'accent' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
              {applied
                ? t('energy.autoApplied', { kcal: signed(adaptive.appliedKcal, kcal(Math.abs(adaptive.appliedKcal))) })
                : enabled
                  ? t('energy.autoWaiting')
                  : t('energy.autoHint')}
            </Txt>
          </View>
          <Switch value={enabled} disabled={toggle.isPending} onValueChange={(on) => toggle.mutate(on)} accessibilityLabel={t('energy.auto')} />
        </Row>
      ) : null}
    </Card>
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
  const within = missing.days > missing.completeDays ? t('energy.missing.within', { count: missing.days }) : '';
  return `${t('energy.missing.lead', { list: parts.join(t('energy.missing.and')) })}${within}`;
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
