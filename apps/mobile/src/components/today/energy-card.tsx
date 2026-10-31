import { heroNutrient as sharedHero, type DaySummary, type GoalPlan, type NutrientKey, type NutrientProgress } from '@symbiose/shared';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { AnimatedNumber, Bar, Card, Dot, Glow, Ring, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, formatNumber, unitOf } from '@/lib/format';
import { NUTRIENT_COLORS, Space, useTheme } from '@/theme';

/** The goal decides the hero metric; shared with the server so the watch and widgets agree. */
export function heroNutrient(day: DaySummary, plan: GoalPlan | null, hideCalories: boolean): NutrientKey {
  return sharedHero(day.progress, plan, hideCalories);
}

const colorFor = (key: NutrientKey, accent: string) => (key === 'kcal' ? accent : NUTRIENT_COLORS[key]);

/** Under the hero: calories first (unless hidden or already the hero), then the plan's nutrients, protein and fibre. */
function secondary(day: DaySummary, plan: GoalPlan | null, hero: NutrientKey, hideCalories: boolean): NutrientProgress[] {
  const keys = new Set<NutrientKey>(['kcal', ...(plan?.focus ?? []), ...(plan?.rules.map((r) => r.nutrient) ?? []), 'protein', 'fiber']);
  return [...keys]
    .filter((key) => key !== hero && !(hideCalories && key === 'kcal'))
    .map((key) => day.progress.find((p) => p.nutrient === key))
    .filter((p): p is NutrientProgress => Boolean(p))
    .slice(0, 3);
}

/**
 * The hero: what's left today for the plan's first focus nutrient, with
 * calories and two other nutrients as quiet bars beside it. One card, not two.
 * Before the first meal there are no bars: a day starts with its budget, not a row of zeros.
 * A goal reached today lights the ring up for a moment (`glow`, from `useGoalRewards`).
 */
export function EnergyCard({
  day,
  plan,
  hero: heroKey,
  hideCalories,
  glow,
}: {
  day: DaySummary;
  plan: GoalPlan | null;
  hero: NutrientKey;
  hideCalories: boolean;
  glow?: SharedValue<number>;
}) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();

  const hero = day.progress.find((p) => p.nutrient === heroKey)!;
  const kcal = day.progress.find((p) => p.nutrient === 'kcal');
  const isKcal = heroKey === 'kcal';
  const fresh = day.meals.length === 0;
  const { kind } = hero.target;
  const over = hero.status === 'over' || (kind !== 'min' && hero.consumed > hero.target.value);
  const remaining = hero.target.value - hero.consumed;
  const heroColor = over && kind !== 'min' ? colors.warning : colorFor(heroKey, colors.accent);
  const amount = (value: number) => (isKcal ? `${formatNumber(value, locale)} kcal` : formatAmount(heroKey, value, locale));

  const reachedMin = kind === 'min' && remaining <= 0;
  const formatCenter = (v: number) => (isKcal ? formatNumber(v, locale) : formatAmount(heroKey, v, locale, false));
  const centerValue = formatCenter(Math.abs(remaining));
  const centerLabel = reachedMin
    ? t('status.reached')
    : `${isKcal ? 'kcal' : unitOf(heroKey)} ${over ? t('today.over') : kind === 'min' ? t('status.toGo') : isKcal ? t('today.left') : t('today.leftUnit')}`;
  // « 60 g · repère 25 g », « 1 395 / 1 840 kcal », or the day's budget before the first meal.
  const summary = fresh
    ? t(kind === 'max' ? 'hero.fresh.max' : kind === 'min' ? 'hero.fresh.min' : 'hero.fresh.target', { amount: amount(hero.target.value) })
    : isKcal
      ? `${formatNumber(hero.consumed, locale)} / ${amount(hero.target.value)}`
      : `${amount(hero.consumed)} · ${t(kind === 'max' ? 'hero.limit' : 'hero.goal', { amount: amount(hero.target.value) })}`;
  const rows = fresh ? [] : secondary(day, plan, heroKey, hideCalories);

  return (
    <Card style={{ overflow: 'hidden', padding: Space.lg + 2 }}>
      <Glow color={heroColor} size={260} opacity={0.2} style={{ left: -80, top: -80 }} />
      <Row gap={Space.lg + 2}>
        <RingSwell glow={glow}>
          <Ring progress={hero.ratio} size={118} stroke={11} color={heroColor}>
            {reachedMin ? (
              <Txt variant="display" style={{ fontSize: 34 }}>
                ✓
              </Txt>
            ) : (
              <AnimatedNumber value={Math.abs(remaining)} format={formatCenter} style={{ fontSize: centerValue.length > 4 ? 27 : 34, lineHeight: 40 }} />
            )}
            <Txt variant="caption" tone={over ? 'warning' : 'secondary'} numberOfLines={2} style={{ textAlign: 'center', fontSize: 12, lineHeight: 15, maxWidth: 84 }}>
              {centerLabel}
            </Txt>
          </Ring>
        </RingSwell>

        <View style={{ flex: 1, gap: Space.md }}>
          <View style={{ gap: 3 }}>
            <Row gap={6}>
              <Dot color={colorFor(heroKey, colors.accent)} />
              <Txt variant="overline" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                {nutrient(heroKey)}
              </Txt>
            </Row>
            <Txt variant="label" tone={over ? 'warning' : 'primary'} numberOfLines={2} style={{ fontVariant: ['tabular-nums'] }}>
              {summary}
            </Txt>
            {fresh && !isKcal && !hideCalories && kcal ? (
              <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {nutrient('kcal')} · {formatNumber(kcal.target.value, locale)} kcal
              </Txt>
            ) : null}
          </View>
          {rows.map((p) => (
            <MiniBar key={p.nutrient} progress={p} />
          ))}
        </View>
      </Row>
    </Card>
  );
}

const RING = 118;
const HALO = 300;

/** The ring with its reward: a halo of the accent blooms behind it and the ring swells a hair, then both settle. */
function RingSwell({ glow, children }: { glow?: SharedValue<number>; children: ReactNode }) {
  const { colors, scheme } = useTheme();
  const halo = useAnimatedStyle(() => {
    const g = glow?.value ?? 0;
    return { opacity: g, transform: [{ scale: 0.55 + 0.45 * g }] };
  });
  const swell = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.045 * (glow?.value ?? 0) }] }));
  if (!glow) return children;
  return (
    <View style={{ width: RING, height: RING }}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (RING - HALO) / 2, top: (RING - HALO) / 2, width: HALO, height: HALO }, halo]}>
        {/* The dark accent is brighter: a lighter touch there. */}
        <Glow color={colors.accent} size={HALO} opacity={scheme === 'dark' ? 0.36 : 0.55} />
      </Animated.View>
      <Animated.View style={swell}>{children}</Animated.View>
    </View>
  );
}

/** « Protéines  65 / 120 g », a thin bar under it. */
function MiniBar({ progress: p }: { progress: NutrientProgress }) {
  const { locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const over = p.status === 'over';
  const isKcal = p.nutrient === 'kcal';
  const value = isKcal
    ? `${formatNumber(p.consumed, locale)} / ${formatNumber(p.target.value, locale)}`
    : `${formatAmount(p.nutrient, p.consumed, locale, false)} / ${formatAmount(p.nutrient, p.target.value, locale)}`;
  return (
    <View style={{ gap: 5 }} accessible accessibilityLabel={`${nutrient(p.nutrient)} ${value}`}>
      <Row style={{ justifyContent: 'space-between' }} gap={6}>
        <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, lineHeight: 15 }}>
          {nutrient(p.nutrient)}
        </Txt>
        <Txt variant="caption" tone={over ? 'warning' : 'secondary'} style={{ fontSize: 12, lineHeight: 15, fontVariant: ['tabular-nums'] }}>
          {value}
          {p.target.kind === 'min' && p.status === 'reached' ? ' ✓' : ''}
        </Txt>
      </Row>
      <Bar progress={p.ratio} color={over ? colors.warning : colorFor(p.nutrient, colors.accent)} height={5} />
    </View>
  );
}
