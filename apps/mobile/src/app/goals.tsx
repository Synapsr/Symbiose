import {
  ACTIVITY_BOUNDS,
  ACTIVITY_STEPS,
  activityGoalsFor,
  clampRuleValue,
  RULE_BOUNDS,
  ruleStep,
  type ActivityGoals,
  type GoalPlan,
  type GoalsResponse,
  type NutrientKey,
  type Targets,
} from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Check, Dumbbell, Footprints, Leaf, Minus, PenLine, Plus, Sparkles, SportShoe, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoalComposer } from '@/components/goal-composer';
import { PlanPreview } from '@/components/plan-preview';
import { Button, Card, Dot, IconButton, Row, Skeleton, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatAmount, formatNumber, unitOf } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { errorMessage, useToday } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useApi, useSetUser, useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme } from '@/theme';

type Editable = Exclude<NutrientKey, 'kcal'>;

/** The numbers a plan shows: its rules first, then the nutrients it focuses on. */
function editableNutrients(plan: GoalPlan): Editable[] {
  return [...new Set([...plan.rules.map((r) => r.nutrient), ...plan.focus])].filter((k): k is Editable => k !== 'kcal').slice(0, 5);
}

/** A rule's value, or the target the plan works out (a manual one wins). */
function valueOf(plan: GoalPlan, targets: Targets | null, key: Editable): number | null {
  const rule = plan.rules.find((r) => r.nutrient === key);
  return rule?.value ?? plan.overrides[key] ?? targets?.[key].value ?? null;
}

/** Sets a number in place: a rule's value, or a manual target for a nutrient the plan computes. */
function withValue(plan: GoalPlan, key: Editable, value: number): GoalPlan {
  if (plan.rules.some((r) => r.nutrient === key)) return { ...plan, rules: plan.rules.map((r) => (r.nutrient === key ? { ...r, value } : r)) };
  return { ...plan, overrides: { ...plan.overrides, [key]: value } };
}

/**
 * Goals open on the current plan: every number can be nudged in place and saved, no AI needed
 * (the server keeps its bounds and safety floors). Rewriting it in your own words stays one tap away.
 */
export default function Goals() {
  const params = useLocalSearchParams<{ intentions?: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const user = useUser();
  const setUser = useSetUser();
  const today = useToday();
  const queryClient = useQueryClient();
  // Coming from the coach with new intentions: straight to the rewrite.
  const [rewriting, setRewriting] = useState(Boolean(params.intentions) || !user.plan);
  const [edited, setEdited] = useState<GoalPlan | null>(null);
  const [intentions, setIntentions] = useState(params.intentions ?? user.plan?.intentions ?? '');
  const [draft, setDraft] = useState<(GoalsResponse & { aiGenerated: boolean }) | null>(null);
  const current = useQuery({ queryKey: ['goals', today], queryFn: () => api.goals(today) });

  const afterSave = async () => {
    setUser(await api.me());
    for (const key of ['day', 'insights', 'weekly-review', 'goals']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const plan = useMutation({
    mutationFn: () => api.draftGoals(intentions.trim()),
    onSuccess: (res) => {
      haptics.soft();
      setDraft(res);
    },
  });
  const save = useMutation({
    mutationFn: async (next: GoalPlan) => {
      await api.saveGoals(next);
      await afterSave();
    },
    onSuccess: () => {
      haptics.soft();
      dismiss();
    },
    onError: () => haptics.warning(),
  });

  useEffect(() => {
    if (params.intentions) plan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const error = plan.error ?? save.error;
  const shown = edited ?? user.plan;
  const dirty = edited !== null && !save.isPending;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Row style={{ justifyContent: 'space-between', padding: Space.lg, paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + Space.lg }}>
        <Txt variant="heading">{t('me.goals')}</Txt>
        <Row gap={Space.sm}>
          {/* Saving sits at the top, where the keyboard never hides it. */}
          {!rewriting && (dirty || save.isPending) ? <Button title={t('common.save')} size="md" variant="accent" loading={save.isPending} onPress={() => edited && save.mutate(edited)} /> : null}
          <IconButton label={t('common.close')} icon={<X size={20} color={colors.text} />} onPress={() => dismiss()} />
        </Row>
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Space.xl, paddingTop: 0, gap: Space.xl, paddingBottom: insets.bottom + Space.xxxl, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        {!rewriting && shown ? (
          <CurrentPlan plan={shown} targets={current.data?.targets ?? null} goalKcal={current.data?.energy?.goalKcal ?? null} onChange={setEdited} />
        ) : draft?.plan && draft.targets && draft.energy ? (
          <PlanPreview plan={draft.plan} targets={draft.targets} energy={draft.energy} aiGenerated={draft.aiGenerated} />
        ) : (
          <GoalComposer value={intentions} onChange={setIntentions} />
        )}
        {error ? (
          <Txt variant="caption" tone="warning">
            {errorMessage(error, t('common.error'), t('common.offline'))}
          </Txt>
        ) : null}
        <View style={{ gap: Space.sm }}>
          {!rewriting ? (
            <Button title={t('goals.rephrase')} variant="secondary" icon={<PenLine size={18} color={colors.text} />} onPress={() => setRewriting(true)} />
          ) : draft?.plan ? (
            <>
              <Button title={t('common.save')} onPress={() => save.mutate(draft.plan!)} loading={save.isPending} />
              <Button title={t('onb.plan.adjust')} variant="ghost" onPress={() => setDraft(null)} />
            </>
          ) : (
            <>
              <Button
                title={plan.isPending ? t('onb.goals.generating') : t('onb.goals.generate')}
                icon={<Sparkles size={18} color={colors.onInverted} />}
                onPress={() => plan.mutate()}
                loading={plan.isPending}
                disabled={intentions.trim().length < 3}
              />
              {user.plan ? <Button title={t('common.cancel')} variant="ghost" onPress={() => setRewriting(false)} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The plan as it is, with a stepper on each number. */
function CurrentPlan({ plan, targets, goalKcal, onChange }: { plan: GoalPlan; targets: Targets | null; goalKcal: number | null; onChange: (plan: GoalPlan) => void }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const hideCalories = useSettings((s) => s.hideCalories);
  const nutrients = editableNutrients(plan);
  const activity = activityGoalsFor(plan);
  const setActivity = (patch: Partial<ActivityGoals>) => onChange({ ...plan, activity: { ...activity, ...patch } });
  const mode =
    plan.calorieMode === 'deficit' ? t('plan.deficit', { pct: plan.caloriePercent }) : plan.calorieMode === 'surplus' ? t('plan.surplus', { pct: plan.caloriePercent }) : t('plan.maintain');
  const kindKey = (key: Editable): TranslationKey => {
    const kind = plan.rules.find((r) => r.nutrient === key)?.kind ?? targets?.[key].kind ?? 'target';
    return kind === 'max' ? 'plan.kind.max' : kind === 'min' ? 'plan.kind.min' : 'plan.kind.target';
  };
  const activityRows: { key: keyof ActivityGoals; icon: ReactNode; label: string; unit: string; value: number | null }[] = [
    { key: 'weeklyActiveMinutes', icon: <SportShoe size={18} color={colors.accent} />, label: t('goals.activeTime'), unit: t('goals.unit.minutes'), value: activity.weeklyActiveMinutes },
    { key: 'dailySteps', icon: <Footprints size={18} color={colors.accent} />, label: t('goals.steps'), unit: t('goals.unit.steps'), value: activity.dailySteps },
    { key: 'weeklyStrengthSessions', icon: <Dumbbell size={18} color={colors.accent} />, label: t('goals.strength'), unit: t('goals.unit.strength'), value: activity.weeklyStrengthSessions },
  ];

  return (
    <View style={{ gap: Space.lg }}>
      <View style={{ gap: Space.sm }}>
        <Txt variant="title">{plan.title}</Txt>
        {plan.summary ? <Txt tone="secondary">{plan.summary}</Txt> : null}
      </View>

      {!hideCalories ? (
        <Card style={{ gap: 4 }}>
          <Txt variant="overline" tone="secondary">
            {t('plan.energy')}
          </Txt>
          {goalKcal !== null ? (
            <Row gap={6} style={{ alignItems: 'baseline' }}>
              <Txt variant="display" style={{ fontSize: 40 }}>
                {formatNumber(goalKcal, locale)}
              </Txt>
              <Txt tone="secondary">kcal {t('plan.perDay')}</Txt>
            </Row>
          ) : (
            <Skeleton width={160} height={44} />
          )}
          <Txt variant="caption" tone="secondary">
            {plan.calorieMode === 'maintain' ? t('plan.atMaintenance') : mode}
          </Txt>
        </Card>
      ) : null}

      {nutrients.length ? (
        <Card padded={false}>
          <Txt variant="overline" tone="secondary" style={{ paddingHorizontal: Space.xl, paddingTop: Space.lg }}>
            {t('plan.rules')}
          </Txt>
          {nutrients.map((key, i) => {
            const value = valueOf(plan, targets, key);
            const reason = plan.rules.find((r) => r.nutrient === key)?.reason;
            const [min, max] = RULE_BOUNDS[key];
            return (
              <EditRow
                key={key}
                first={i === 0}
                icon={<Dot color={NUTRIENT_COLORS[key]} />}
                label={nutrient(key)}
                hint={reason ? `${t(kindKey(key))} · ${reason}` : t(kindKey(key))}
                value={value === null ? null : formatAmount(key, value, locale, false)}
                unit={unitOf(key)}
                canLower={value !== null && value > min}
                canRaise={value !== null && value < max}
                onStep={(direction) => value !== null && onChange(withValue(plan, key, clampRuleValue(key, value + direction * ruleStep(key))))}
              />
            );
          })}
        </Card>
      ) : null}

      <Card padded={false}>
        <Txt variant="overline" tone="secondary" style={{ paddingHorizontal: Space.xl, paddingTop: Space.lg }}>
          {t('plan.activity')}
        </Txt>
        {activityRows
          .filter((row) => row.value !== null)
          .map((row, i) => {
            const [min, max] = ACTIVITY_BOUNDS[row.key];
            const value = row.value!;
            return (
              <EditRow
                key={row.key}
                first={i === 0}
                icon={row.icon}
                label={row.label}
                hint={row.unit}
                value={formatNumber(value, locale)}
                canLower={value > min}
                canRaise={value < max}
                onStep={(direction) => setActivity({ [row.key]: Math.min(max, Math.max(min, value + direction * ACTIVITY_STEPS[row.key])) })}
              />
            );
          })}
      </Card>

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

/** A number with − and + on each side: one tap, one step, within bounds. */
function EditRow({
  icon,
  label,
  hint,
  value,
  unit,
  canLower,
  canRaise,
  onStep,
  first,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: string | null;
  unit?: string;
  canLower: boolean;
  canRaise: boolean;
  onStep: (direction: 1 | -1) => void;
  first: boolean;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const step = (direction: 1 | -1) => {
    haptics.tap();
    onStep(direction);
  };
  return (
    <Row gap={Space.md} style={{ paddingHorizontal: Space.xl, paddingVertical: Space.md, minHeight: 64, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <View style={{ width: 20, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" style={{ fontSize: 15 }} numberOfLines={1}>
          {label}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={2}>
          {hint}
        </Txt>
      </View>
      <Row gap={6}>
        <IconButton label={t('goals.lower', { what: label })} size={34} icon={<Minus size={16} color={canLower ? colors.text : colors.text3} />} onPress={() => (canLower ? step(-1) : haptics.warning())} />
        <View style={{ minWidth: 58, alignItems: 'center' }}>
          {value === null ? (
            <Skeleton width={40} height={18} radius={Radius.sm} />
          ) : (
            <Txt variant="label" style={{ fontSize: 17, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
              {value}
              {unit ? <Txt variant="caption" tone="secondary">{` ${unit}`}</Txt> : null}
            </Txt>
          )}
        </View>
        <IconButton label={t('goals.raise', { what: label })} size={34} icon={<Plus size={16} color={canRaise ? colors.text : colors.text3} />} onPress={() => (canRaise ? step(1) : haptics.warning())} />
      </Row>
    </Row>
  );
}
