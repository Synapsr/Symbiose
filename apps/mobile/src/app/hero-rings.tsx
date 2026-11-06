import { goalNutrient, type NutrientKey } from '@symbiose/shared';
import { Check } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Dot, Pressy, Reveal, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { HERO_MAX, HERO_ORDER, heroDefaults, toggleHero } from '@/lib/hero-logic';
import { useUser } from '@/lib/session';
import { useSettings } from '@/lib/stores';
import { NUTRIENT_COLORS, Space, useTheme } from '@/theme';

/**
 * A long press on Today's card: which small rings sit under the big one. The
 * goal's is always there; the others are ticked here, six rings at most, and
 * the card follows at once. « Par défaut » goes back to the simple set.
 */
export default function HeroRingsSheet() {
  const { t, nutrient } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const hideCalories = useSettings((s) => s.hideCalories);
  const chosen = useSettings((s) => s.heroRings);
  const set = useSettings((s) => s.set);

  const plan = user.plan ?? null;
  const goal = goalNutrient(plan, hideCalories);
  const selection = chosen ?? heroDefaults(plan, hideCalories);
  const others = HERO_ORDER.filter((key) => key !== goal && !(hideCalories && key === 'kcal'));
  const full = selection.filter((key) => key !== goal && !(hideCalories && key === 'kcal')).length >= HERO_MAX - 1;

  const toggle = (key: NutrientKey) => {
    const on = selection.includes(key);
    if (!on && full) {
      haptics.warning();
      return;
    }
    haptics.tap();
    set({ heroRings: toggleHero(selection, key, goal) });
  };

  const color = (key: NutrientKey) => (key === 'kcal' ? colors.accent : NUTRIENT_COLORS[key]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Space.xl, paddingTop: Space.xxl, paddingBottom: insets.bottom + Space.xxl, gap: Space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
      <Reveal index={0} style={{ gap: Space.sm }}>
        <Txt variant="title">{t('heroRings.title')}</Txt>
        <Txt tone="secondary">{t('heroRings.subtitle', { max: HERO_MAX })}</Txt>
      </Reveal>

      <Reveal index={1}>
        <Card padded={false} style={{ paddingVertical: Space.xs }}>
          <NutrientRow color={color(goal)} name={nutrient(goal)} hint={t('heroRings.goal')} />
          {others.map((key) => {
            const on = selection.includes(key);
            return (
              <NutrientRow
                key={key}
                color={color(key)}
                name={nutrient(key)}
                hint={t(`heroRings.about.${key}` as TranslationKey)}
                on={on}
                dimmed={!on && full}
                onPress={() => toggle(key)}
              />
            );
          })}
        </Card>
      </Reveal>

      {chosen ? (
        <Reveal index={2}>
          <Button
            variant="ghost"
            title={t('heroRings.reset')}
            onPress={() => {
              haptics.tap();
              set({ heroRings: null });
            }}
          />
        </Reveal>
      ) : null}
    </ScrollView>
  );
}

/** A nutrient, what it covers in a few words, and its tick; the goal's row has no tick: it stays. */
function NutrientRow({ color, name, hint, on, dimmed, onPress }: { color: string; name: string; hint: string; on?: boolean; dimmed?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const content = (
    <Row gap={Space.md} style={{ paddingHorizontal: Space.lg, paddingVertical: Space.md, minHeight: 56, opacity: dimmed ? 0.4 : 1 }}>
      <Dot color={color} size={10} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label">{name}</Txt>
        <Txt variant="caption" tone="secondary">
          {hint}
        </Txt>
      </View>
      {onPress ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: on ? colors.accent : 'transparent',
            borderWidth: on ? 0 : 1.5,
            borderColor: colors.text3,
          }}>
          {on ? <Check size={15} strokeWidth={3} color={colors.onAccent} /> : null}
        </View>
      ) : null}
    </Row>
  );
  if (!onPress) return <View accessible accessibilityLabel={`${name}, ${hint}`}>{content}</View>;
  return (
    <Pressy haptic={false} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: dimmed }} accessibilityLabel={`${name}, ${hint}`}>
      {content}
    </Pressy>
  );
}
