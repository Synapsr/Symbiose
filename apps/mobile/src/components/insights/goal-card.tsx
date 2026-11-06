import type { InsightsResponse, NutrientKey, TargetKind } from '@symbiose/shared';
import { Flame } from 'lucide-react-native';
import { View } from 'react-native';

import { DayBars } from '@/components/insights/charts';
import { Card, Dot, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, weekdayInitial } from '@/lib/format';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

const SIGN: Record<TargetKind, string> = { max: '≤', min: '≥', target: '≈' };

/**
 * The goal's own number over the period: the daily average, a bar per day against the limit,
 * how many days kept it (« Repères tenus »), then the plan's other guardrails in one line each.
 */
export function GoalCard({ data, hero, hideCalories }: { data: InsightsResponse; hero: NutrientKey; hideCalories: boolean }) {
  const { t, plural, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const motivation = useSettings((s) => s.motivation);
  const color = hero === 'kcal' ? colors.accent : NUTRIENT_COLORS[hero];
  const adherence = data.adherence.find((a) => a.nutrient === hero);
  const target = adherence?.target ?? data.days.at(-1)?.kcalTarget ?? 0;
  const kind = adherence?.kind ?? 'target';
  const rule = `${SIGN[kind]} ${formatAmount(hero, target, locale)}`;
  const others = data.adherence.filter((a) => a.nutrient !== hero && a.nutrient !== 'kcal');
  const kept = adherence && adherence.daysLogged ? adherence.daysOk / adherence.daysLogged : 0;
  // The rest of the plate, in one quiet line.
  const secondary = (['kcal', 'protein', 'fiber'] as NutrientKey[]).filter((k) => k !== hero && !(k === 'kcal' && hideCalories));

  return (
    <Card style={{ gap: Space.lg }}>
      <View style={{ gap: 2 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={6} style={{ flexShrink: 1 }}>
            <Dot color={color} />
            <Txt variant="label" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {nutrient(hero)} · {t('insights.average').toLowerCase()}
            </Txt>
          </Row>
          {target > 0 ? (
            <View style={{ paddingHorizontal: 10, height: 26, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.surface2 }}>
              <Txt variant="caption" style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                {rule}
              </Txt>
            </View>
          ) : null}
        </Row>
        <Txt variant="display" style={{ fontSize: 40 }}>
          {formatAmount(hero, data.averages[hero], locale)}
        </Txt>
      </View>

      <DayBars
        values={data.days.map((d) => (d.logged ? d.totals[hero] : null))}
        labels={data.days.map((d) => weekdayInitial(d.date, locale))}
        target={target}
        kind={kind}
        color={color}
      />

      <View style={{ gap: Space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="label" tone={adherence && kept >= 0.5 ? 'accent' : 'primary'} style={{ fontVariant: ['tabular-nums'] }}>
            {adherence ? plural('insights.kept', adherence.daysLogged, { ok: adherence.daysOk, total: adherence.daysLogged, rule }) : plural('insights.tracked', data.loggedDays)}
          </Txt>
          {motivation && data.streak > 1 ? (
            <Row gap={4} accessible accessibilityLabel={plural('today.streakLabel', data.streak)}>
              <Flame size={13} color={colors.warning} fill={colors.warning} />
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {plural('today.streakLabel', data.streak)}
              </Txt>
            </Row>
          ) : null}
        </Row>
        {others.map((a) => (
          <Row key={a.nutrient} gap={8}>
            <Dot color={NUTRIENT_COLORS[a.nutrient]} size={6} />
            <Txt variant="caption" tone="secondary" style={{ flex: 1, fontVariant: ['tabular-nums'] }}>
              {nutrient(a.nutrient)} {SIGN[a.kind]} {formatAmount(a.nutrient, a.target, locale)}
            </Txt>
            <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
              {a.daysOk}/{a.daysLogged}
            </Txt>
          </Row>
        ))}
        {secondary.length ? (
          <Txt variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {secondary.map((k) => (k === 'kcal' ? `${formatAmount(k, data.averages[k], locale)}` : `${formatAmount(k, data.averages[k], locale)} ${nutrient(k).toLowerCase()}`)).join(' · ')}
          </Txt>
        ) : null}
      </View>
    </Card>
  );
}
