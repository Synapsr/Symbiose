import type { Nutrients } from '@symbiose/shared';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmount } from '@/lib/format';
import { Motion, NUTRIENT_COLORS, useTheme } from '@/theme';

const HEIGHT = 6;

/** « Glucides 62 g · Sucres 18 g dont ajoutés 12 g »: what the sugar hierarchy says, in one line. */
export function sugarLine(t: ReturnType<typeof useI18n>['t'], locale: 'fr' | 'en', n: Pick<Nutrients, 'carbs' | 'sugar' | 'addedSugar'>, withCarbs = true): string {
  const sugars = t('sugars.line', { sugar: formatAmount('sugar', n.sugar, locale), added: formatAmount('addedSugar', n.addedSugar, locale) });
  return withCarbs ? `${t('sugars.carbs', { carbs: formatAmount('carbs', n.carbs, locale) })} · ${sugars}` : sugars;
}

/**
 * The sugars inside the carbs, at a glance: one thin bar for the carbs, total
 * sugars drawn inside it, added sugars inside those (added ⊂ total ⊂ carbs),
 * with the same thing said in words under it.
 */
export function SugarLadder({ nutrients }: { nutrients: Pick<Nutrients, 'carbs' | 'sugar' | 'addedSugar'> }) {
  const { t, locale } = useI18n();
  const line = sugarLine(t, locale, nutrients);
  const carbs = Math.max(nutrients.carbs, 0.001);
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={line}>
      <View style={{ height: HEIGHT, borderRadius: HEIGHT / 2, overflow: 'hidden' }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: NUTRIENT_COLORS.carbs, opacity: 0.32 }]} />
        <Segment share={nutrients.sugar / carbs} color={NUTRIENT_COLORS.sugar} opacity={0.55} />
        <Segment share={nutrients.addedSugar / carbs} color={NUTRIENT_COLORS.addedSugar} />
      </View>
      <Txt variant="caption" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
        {line}
      </Txt>
    </View>
  );
}

/** One level of the ladder, from the left, grown in like the app's other bars. */
function Segment({ share, color, opacity = 1 }: { share: number; color: string; opacity?: number }) {
  const { colors } = useTheme();
  const value = useSharedValue(0);
  useEffect(() => {
    value.set(withTiming(Math.max(0, Math.min(share, 1)), { duration: Motion.dataDuration, easing: Easing.out(Easing.cubic) }));
  }, [share, value]);
  const width = useAnimatedStyle(() => ({ width: `${value.value * 100}%` }));
  // A hairline in the card's colour sets each level apart from the one around it.
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: HEIGHT / 2, backgroundColor: color, opacity, borderRightWidth: 1, borderRightColor: colors.surface }, width]} />;
}
