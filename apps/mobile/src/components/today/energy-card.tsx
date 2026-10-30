import { heroNutrient as sharedHero, type DaySummary, type GoalPlan, type NutrientKey, type NutrientProgress } from '@symbiose/shared';
import { Flame, Watch } from 'lucide-react-native';
import { View } from 'react-native';

import { AnimatedNumber, Bar, Card, Dot, Glow, Ring, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount, formatNumber, unitOf } from '@/lib/format';
import { NUTRIENT_COLORS, Space, useTheme } from '@/theme';

/** The goal decides the hero metric; shared with the server so the watch and widgets agree. */
export function heroNutrient(day: DaySummary, plan: GoalPlan | null, hideCalories: boolean): NutrientKey {
  return sharedHero(day.progress, plan, hideCalories);
}

const colorFor = (key: NutrientKey, accent: string) => (key === 'kcal' ? accent : NUTRIENT_COLORS[key]);

/** The hero: what's left today for the metric that matters, plus the watch's contribution. */
export function EnergyCard({ day, hero: heroKey, hideCalories }: { day: DaySummary; hero: NutrientKey; hideCalories: boolean }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();

  const hero = day.progress.find((p) => p.nutrient === heroKey)!;
  const kcal = day.progress.find((p) => p.nutrient === 'kcal')!;
  const isKcal = heroKey === 'kcal';
  const over = hero.status === 'over' || (hero.target.kind !== 'min' && hero.consumed > hero.target.value);
  const remaining = hero.target.value - hero.consumed;
  const heroColor = over && hero.target.kind !== 'min' ? colors.warning : colorFor(heroKey, colors.accent);
  const amount = (value: number) => (isKcal ? formatNumber(value, locale) : formatAmount(heroKey, value, locale));

  const reachedMin = hero.target.kind === 'min' && remaining <= 0;
  const formatCenter = (v: number) => (isKcal ? formatNumber(v, locale) : formatAmount(heroKey, v, locale, false));
  const centerValue = reachedMin ? '✓' : formatCenter(Math.abs(remaining));
  const centerLabel =
    hero.target.kind === 'min' && remaining <= 0
      ? t('status.reached')
      : `${isKcal ? 'kcal' : unitOf(heroKey)} ${over ? t('today.over') : hero.target.kind === 'min' ? t('status.toGo') : isKcal ? t('today.left') : t('today.leftUnit')}`;

  return (
    <Card style={{ gap: Space.lg, overflow: 'hidden' }}>
      <Glow color={heroColor} size={300} opacity={0.22} style={{ left: -90, top: -90 }} />
      <Row gap={Space.xl}>
        <Ring progress={hero.ratio} size={140} stroke={13} color={heroColor}>
          {reachedMin ? (
            <Txt variant="display" style={{ fontSize: 38 }}>
              ✓
            </Txt>
          ) : (
            <AnimatedNumber value={Math.abs(remaining)} format={formatCenter} style={{ fontSize: centerValue.length > 4 ? 32 : 40 }} />
          )}
          <Txt variant="caption" tone={over ? 'warning' : 'secondary'} style={{ textAlign: 'center' }}>
            {centerLabel}
          </Txt>
        </Ring>

        <View style={{ flex: 1, gap: Space.md }}>
          <Row gap={6}>
            <Dot color={colorFor(heroKey, colors.accent)} />
            <Txt variant="overline" tone="secondary" numberOfLines={1}>
              {nutrient(heroKey)}
            </Txt>
          </Row>
          <Stat label={t('today.eaten')} value={amount(hero.consumed)} />
          <Stat label={hero.target.kind === 'max' ? t('plan.kind.max') : hero.target.kind === 'min' ? t('plan.kind.min') : t('today.goal')} value={amount(hero.target.value)} />
        </View>
      </Row>

      {!isKcal && !hideCalories ? <KcalLine progress={kcal} /> : null}
      <ActivityLine day={day} hideCalories={hideCalories} />
    </Card>
  );
}

function KcalLine({ progress }: { progress: NutrientProgress }) {
  const { locale } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="secondary">
          {formatNumber(progress.consumed, locale)} / {formatNumber(progress.target.value, locale)} kcal
        </Txt>
      </Row>
      <Bar progress={progress.ratio} color={progress.status === 'over' ? colors.warning : colors.accent} height={6} />
    </View>
  );
}

/** Energy burned today, from the watch or the day's sessions. Steps live in the Movement card. */
function ActivityLine({ day, hideCalories }: { day: DaySummary; hideCalories: boolean }) {
  const { locale, t } = useI18n();
  const { colors } = useTheme();
  const activeKcal = day.activity?.activeKcal ?? (day.energy.source === 'activity' ? day.energy.activeKcal : null);
  if (activeKcal === null || hideCalories) return null;
  return (
    <Row gap={Space.lg}>
      <Row gap={5}>
        <Flame size={14} color={colors.warning} />
        <Txt variant="caption" tone="secondary">
          {formatNumber(activeKcal, locale)} kcal {t('today.burned').toLowerCase()}
        </Txt>
      </Row>
      {day.energy.source === 'activity' ? <Watch size={14} color={colors.accent} /> : null}
    </Row>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Txt variant="caption" tone="secondary">
        {label}
      </Txt>
      <Txt variant="number" style={{ fontSize: 20 }}>
        {value}
      </Txt>
    </View>
  );
}

/** Only what matters for the person's goals: focus nutrients, then protein and fibre. */
export function NutrientBars({ day, plan, hero, count = 3 }: { day: DaySummary; plan: GoalPlan | null; hero: NutrientKey; count?: number }) {
  const { t, locale, nutrient } = useI18n();
  const { colors } = useTheme();
  const wanted = [...new Set<NutrientKey>([...(plan?.focus ?? []), ...(plan?.rules.map((r) => r.nutrient) ?? []), 'protein', 'fiber'])].filter(
    (k) => k !== 'kcal' && k !== hero,
  );
  const rows = wanted
    .map((key) => day.progress.find((p) => p.nutrient === key))
    .filter((p): p is NutrientProgress => Boolean(p))
    .slice(0, count);
  if (!rows.length) return null;

  return (
    <Card style={{ gap: Space.lg }}>
      {rows.map((p) => {
        const color = NUTRIENT_COLORS[p.nutrient];
        const over = p.status === 'over';
        return (
          <View key={p.nutrient} style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={8}>
                <Dot color={color} />
                <Txt variant="label">{nutrient(p.nutrient)}</Txt>
              </Row>
              <Txt variant="label" tone={over ? 'warning' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
                {formatAmount(p.nutrient, p.consumed, locale, false)} / {formatAmount(p.nutrient, p.target.value, locale)}
                {p.target.kind === 'min' && p.status === 'reached' ? ' ✓' : ''}
                {over ? ` · ${t('status.over')}` : ''}
              </Txt>
            </Row>
            <Bar progress={p.ratio} color={over ? colors.warning : color} />
          </View>
        );
      })}
    </Card>
  );
}
