import { localTime, type Meal } from '@symbiose/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { RotateCw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Dot, IconButton, Pressy, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatAmount, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PendingMeal } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme, verdictColor } from '@/theme';

const THUMB = 60;
const PAD = Space.md;
// Concentric radii: the thumbnail's corner follows the card's corner minus the padding.
const THUMB_RADIUS = Radius.lg - PAD;

function Thumb({ meal }: { meal: Meal }) {
  const { api } = useSession();
  const { colors, imageOutline } = useTheme();
  if (meal.photoId && api) {
    return (
      <Image
        source={{ uri: api.photoUrl(meal.photoId), headers: api.authHeaders }}
        style={[{ width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS }, imageOutline]}
        contentFit="cover"
        transition={250}
        recyclingKey={meal.photoId}
      />
    );
  }
  const emoji = meal.items.find((i) => i.emoji)?.emoji ?? '🍽️';
  return (
    <View style={{ width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontSize: 28 }}>{emoji}</Txt>
    </View>
  );
}

export function MealCard({ meal, hideCalories }: { meal: Meal; hideCalories: boolean }) {
  const { t, locale, nutrient } = useI18n();
  const { colors, elevation } = useTheme();
  const flag = meal.insight?.flags.find((f) => f.nutrient !== 'kcal' && f.share >= 0.15);
  const asking = Boolean(meal.insight?.clarification);

  return (
    <Animated.View entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(250)}>
      <Pressy
        onPress={() => router.push({ pathname: '/meal/[id]', params: { id: meal.id } })}
        accessibilityRole="button"
        accessibilityLabel={meal.title}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: PAD, backgroundColor: colors.surface, borderRadius: Radius.lg }, elevation]}>
        <Thumb meal={meal} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="label" numberOfLines={1} style={{ fontSize: 16 }}>
            {meal.title}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {localTime(meal.eatenAt)} · {t(`meal.${meal.mealType}`)}
          </Txt>
          {flag ? (
            <Row gap={6}>
              <Dot color={NUTRIENT_COLORS[flag.nutrient]} size={6} />
              <Txt variant="caption" tone={flag.kind === 'max' && flag.share >= 0.5 ? 'warning' : 'secondary'}>
                {nutrient(flag.nutrient)} {formatAmount(flag.nutrient, meal.totals[flag.nutrient], locale)} · {Math.round(flag.share * 100)} %
              </Txt>
            </Row>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {!hideCalories ? (
            <Txt variant="number" style={{ fontSize: 18 }}>
              {formatNumber(meal.totals.kcal, locale)}
            </Txt>
          ) : null}
          <Row gap={6}>
            {asking ? (
              <View style={{ backgroundColor: colors.accentSoft, borderRadius: Radius.pill, paddingHorizontal: 7, height: 20, justifyContent: 'center' }}>
                <Txt variant="caption" tone="accent" style={{ fontSize: 11, fontWeight: '700' }}>
                  ?
                </Txt>
              </View>
            ) : null}
            {meal.insight ? <Dot color={verdictColor(meal.insight.verdict, colors)} /> : null}
          </Row>
        </View>
      </Pressy>
    </Animated.View>
  );
}

const STEPS: TranslationKey[] = ['analyzing.1', 'analyzing.2', 'analyzing.3', 'analyzing.4'];

/** A meal being analysed: a scan line sweeps the photo while the AI says what it's doing. */
export function PendingMealCard({ pending, onRetry, onDismiss }: { pending: PendingMeal; onRetry: () => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const { colors, elevation, imageOutline } = useTheme();
  const failed = pending.status === 'error';
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (failed) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1700);
    return () => clearInterval(timer);
  }, [failed]);

  const scan = useSharedValue(0);
  useEffect(() => {
    scan.set(failed ? 0 : withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [failed, scan]);
  const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateY: scan.value * (THUMB - 3) }] }));

  return (
    <Animated.View
      entering={FadeInDown.duration(320)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.duration(250)}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: PAD, backgroundColor: colors.surface, borderRadius: Radius.lg }, elevation, failed ? { borderWidth: 1, borderColor: colors.warning } : null]}>
      <View style={{ width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        {pending.photoUri ? <Image source={{ uri: pending.photoUri }} style={[{ width: THUMB, height: THUMB, borderRadius: THUMB_RADIUS }, imageOutline]} contentFit="cover" /> : <Txt style={{ fontSize: 26 }}>✍️</Txt>}
        {!failed ? (
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, backgroundColor: colors.accent, boxShadow: `0 0 12px ${colors.accent}` }, scanStyle]} />
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        {failed ? (
          <Txt variant="label" style={{ fontSize: 16 }}>
            {t('today.failed')}
          </Txt>
        ) : (
          <Animated.View key={step} entering={FadeIn.duration(300)}>
            <Txt variant="label" style={{ fontSize: 16 }} numberOfLines={1}>
              {t(STEPS[step]!)}
            </Txt>
          </Animated.View>
        )}
        <Txt variant="caption" tone={failed ? 'warning' : 'secondary'} numberOfLines={2}>
          {failed ? pending.error : pending.label}
        </Txt>
      </View>
      {failed ? (
        <Row gap={6}>
          <IconButton label={t('common.retry')} size={40} icon={<RotateCw size={18} color={colors.text} />} onPress={onRetry} />
          <IconButton label={t('common.delete')} size={40} icon={<X size={18} color={colors.text2} />} onPress={onDismiss} />
        </Row>
      ) : null}
    </Animated.View>
  );
}
