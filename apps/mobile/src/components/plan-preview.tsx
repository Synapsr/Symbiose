import type { EnergyBreakdown, GoalPlan, NutrientKey, Targets } from '@symbiose/shared';
import { Check, Leaf, Watch } from 'lucide-react-native';
import { View } from 'react-native';

import { Card, Dot, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, formatNumber } from '@/lib/format';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

/** The plan as a readable, editable "contract": numbers, guardrails and habits. */
export function PlanPreview({ plan, targets, energy, aiGenerated = true }: { plan: GoalPlan; targets: Targets; energy: EnergyBreakdown; aiGenerated?: boolean }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const hideCalories = useSettings((s) => s.hideCalories);

  const mode =
    plan.calorieMode === 'deficit'
      ? t('plan.deficit', { pct: plan.caloriePercent })
      : plan.calorieMode === 'surplus'
        ? t('plan.surplus', { pct: plan.caloriePercent })
        : t('plan.maintain');

  const shown: NutrientKey[] = [...new Set<NutrientKey>([...plan.focus.filter((k) => k !== 'kcal'), ...plan.rules.map((r) => r.nutrient), 'protein'])].slice(0, 5);
  const kindLabel = (k: NutrientKey) => t(targets[k].kind === 'max' ? 'plan.kind.max' : targets[k].kind === 'min' ? 'plan.kind.min' : 'plan.kind.target');

  return (
    <View style={{ gap: Space.lg }}>
      <View style={{ gap: Space.sm }}>
        <Txt variant="title">{plan.title}</Txt>
        <Txt tone="secondary">{plan.summary}</Txt>
        {!aiGenerated ? (
          <Txt variant="caption" tone="warning">
            {t('plan.noAi')}
          </Txt>
        ) : null}
      </View>

      {!hideCalories ? (
        <Card style={{ gap: 4 }}>
          <Txt variant="overline" tone="secondary">
            {t('plan.energy')}
          </Txt>
          <Row gap={6} style={{ alignItems: 'baseline' }}>
            <Txt variant="display" style={{ fontSize: 44 }}>
              {formatNumber(energy.goalKcal, locale)}
            </Txt>
            <Txt tone="secondary">kcal {t('plan.perDay')}</Txt>
          </Row>
          <Txt variant="caption" tone="secondary">
            {plan.calorieMode === 'maintain' ? t('plan.atMaintenance') : `${mode} · ${t('plan.maintenance', { kcal: formatNumber(energy.tdee, locale) })}`}
          </Txt>
          {plan.adjustForActivity ? (
            <Row gap={6} style={{ marginTop: Space.sm }}>
              <Watch size={14} color={colors.accent} />
              <Txt variant="caption" tone="accent">
                {t('plan.activityOn')}
              </Txt>
            </Row>
          ) : null}
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
        {shown.map((key) => (
          <View key={key} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: colors.border, padding: Space.lg, gap: 4 }}>
            <Row gap={6}>
              <Dot color={NUTRIENT_COLORS[key]} />
              <Txt variant="caption" tone="secondary" numberOfLines={1}>
                {nutrient(key)}
              </Txt>
            </Row>
            <Txt variant="number">{formatAmount(key, targets[key].value, locale)}</Txt>
            <Txt variant="caption" tone="tertiary">
              {kindLabel(key)}
            </Txt>
          </View>
        ))}
      </View>

      {plan.rules.length ? (
        <Card style={{ gap: Space.md }}>
          <Txt variant="overline" tone="secondary">
            {t('plan.rules')}
          </Txt>
          {plan.rules.map((rule) => (
            <Row key={rule.nutrient} gap={Space.md} style={{ alignItems: 'flex-start' }}>
              <View style={{ marginTop: 6 }}>
                <Dot color={NUTRIENT_COLORS[rule.nutrient]} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="label">
                  {nutrient(rule.nutrient)} · {t(rule.kind === 'max' ? 'plan.max' : 'plan.min')} {formatAmount(rule.nutrient, rule.value, locale)}
                </Txt>
                {rule.reason ? (
                  <Txt variant="caption" tone="secondary">
                    {rule.reason}
                  </Txt>
                ) : null}
              </View>
            </Row>
          ))}
        </Card>
      ) : null}

      {plan.habits.length ? (
        <Card style={{ gap: Space.md }}>
          <Txt variant="overline" tone="secondary">
            {t('plan.habits')}
          </Txt>
          {plan.habits.map((habit) => (
            <Row key={habit.id} gap={Space.md} style={{ alignItems: 'flex-start' }}>
              {habit.kind === 'do' ? <Check size={18} color={colors.accent} /> : <Leaf size={18} color={colors.warning} />}
              <Txt style={{ flex: 1 }}>{habit.label}</Txt>
            </Row>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
