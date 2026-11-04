import { courseItems, localTime, mealCourses, type CarbLoad, type Meal } from '@symbiose/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { RotateCw, Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Dot, IconButton, Pressy, Row, Txt } from '@/components/ui';
import { useI18n, type TranslationKey } from '@/i18n';
import { formatAmount, formatNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PendingMeal } from '@/lib/stores';
import { NUTRIENT_COLORS, Radius, Space, useTheme, verdictColor } from '@/theme';

export const THUMB = 60;
export const PAD = Space.md;
// Concentric radii: the thumbnail's corner follows the card's corner minus the padding.
export const THUMB_RADIUS = Radius.lg - PAD;

/** Back to front, a few degrees apart, like prints on a table: the cover in front. */
const FAN = {
  2: [
    { left: 12, top: 0, rotate: '6deg' },
    { left: 0, top: 12, rotate: '-3deg' },
  ],
  3: [
    { left: 14, top: 0, rotate: '9deg' },
    { left: 7, top: 6, rotate: '3deg' },
    { left: 0, top: 14, rotate: '-4deg' },
  ],
} as const;

/** One course's face: its photo, else its first emoji. */
function Face({ photoId, emoji, size, style }: { photoId: string | null; emoji: string; size: number; style: object }) {
  const { api } = useSession();
  const { colors, imageOutline } = useTheme();
  const frame = { position: 'absolute' as const, width: size, height: size, borderRadius: THUMB_RADIUS - 2, borderCurve: 'continuous' as const, borderWidth: 2, borderColor: colors.surface, overflow: 'hidden' as const };
  return (
    <View style={[frame, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, style]}>
      {photoId && api ? (
        <Image source={{ uri: api.photoUrl(photoId), headers: api.authHeaders }} style={[{ width: '100%', height: '100%' }, imageOutline]} contentFit="cover" transition={250} recyclingKey={photoId} />
      ) : (
        <Txt style={{ fontSize: 22 }}>{emoji}</Txt>
      )}
    </View>
  );
}

/** A meal in courses: its courses fanned out, the cover in front. */
function CourseThumbs({ meal }: { meal: Meal }) {
  const courses = mealCourses(meal);
  const coverIndex = Math.max(0, courses.findIndex((c) => c.photoId));
  // The cover, then the courses after it: at most three faces.
  const shown = [courses[coverIndex]!, ...courses.filter((_, i) => i !== coverIndex)].slice(0, 3);
  const fan = FAN[shown.length as 2 | 3];
  return (
    <View style={{ width: THUMB, height: THUMB }}>
      {shown
        .map((course, i) => ({ course, place: fan[shown.length - 1 - i]! }))
        .reverse()
        .map(({ course, place }) => (
          <Face
            key={course.id}
            photoId={course.photoId}
            emoji={courseItems(meal, course.id).find((i) => i.emoji)?.emoji ?? '🍽️'}
            size={THUMB - (shown.length === 3 ? 14 : 12)}
            style={{ left: place.left, top: place.top, transform: [{ rotate: place.rotate }] }}
          />
        ))}
    </View>
  );
}

function Thumb({ meal }: { meal: Meal }) {
  const { api } = useSession();
  const { colors, imageOutline } = useTheme();
  if (mealCourses(meal).length > 1) return <CourseThumbs meal={meal} />;
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

const openMeal = (meal: Meal) => router.push({ pathname: '/meal/[id]', params: { id: meal.id } });

/**
 * One meal of the day. In blood-sugar mode (`carbs`) its line says its carbs
 * against the per-meal guide, calmly: only a big single load turns warm.
 */
export function MealCard({ meal, hideCalories, carbs }: { meal: Meal; hideCalories: boolean; carbs?: CarbLoad | null }) {
  const { t, plural, locale, nutrient } = useI18n();
  const { colors, elevation } = useTheme();
  const flag = carbs ? null : meal.insight?.flags.find((f) => f.nutrient !== 'kcal' && f.share >= 0.15);
  const question = meal.insight?.clarification?.question;
  // « Déjeuner · 3 plats »: one row for the whole meal.
  const courses = mealCourses(meal).length;
  const kind = [t(`meal.${meal.mealType}`), ...(courses > 1 ? [plural('courses.count', courses)] : [])].join(' · ');

  return (
    <Animated.View entering={FadeInDown.duration(320).easing(Easing.out(Easing.cubic))} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(250)}>
      <Pressy
        onPress={() => openMeal(meal)}
        accessibilityRole="button"
        accessibilityLabel={`${meal.title}, ${kind}${question ? `. ${t('today.question')} : ${question}` : ''}`}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: PAD, backgroundColor: colors.surface, borderRadius: Radius.lg }, elevation]}>
        <Thumb meal={meal} />
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="label" numberOfLines={1} style={{ fontSize: 16 }}>
            {meal.title}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {localTime(meal.eatenAt)} · {kind}
          </Txt>
          {carbs ? (
            <Row gap={6}>
              <Dot color={NUTRIENT_COLORS.carbs} size={6} />
              <Txt variant="caption" tone={carbs.level === 'high' ? 'warning' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
                {t('sugars.mealCarbs', { carbs: formatAmount('carbs', carbs.carbs, locale), guide: formatAmount('carbs', carbs.guide, locale) })}
              </Txt>
            </Row>
          ) : null}
          {flag ? (
            <Row gap={6}>
              <Dot color={NUTRIENT_COLORS[flag.nutrient]} size={6} />
              <Txt variant="caption" tone={flag.kind === 'max' && flag.share >= 0.5 ? 'warning' : 'secondary'}>
                {nutrient(flag.nutrient)} {formatAmount(flag.nutrient, meal.totals[flag.nutrient], locale)} · {Math.round(flag.share * 100)} %
              </Txt>
            </Row>
          ) : null}
          {question ? (
            // The AI's pending question, said in words: the row's one tap opens it with its answers.
            <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, height: 24, paddingHorizontal: 9, borderRadius: Radius.pill, backgroundColor: colors.accentSoft }}>
              <Sparkles size={12} color={colors.accentText} />
              <Txt variant="caption" tone="accent" style={{ fontSize: 12, fontWeight: '700' }}>
                {t('today.question')}
              </Txt>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {!hideCalories ? (
            <Txt variant="number" style={{ fontSize: 18 }}>
              {formatNumber(meal.totals.kcal, locale)}
            </Txt>
          ) : null}
          {meal.insight ? <Dot color={verdictColor(meal.insight.verdict, colors)} /> : null}
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
          {failed ? pending.error : pending.joining ? `${t('courses.joining', { meal: pending.joining })} · ${pending.label}` : pending.label}
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
