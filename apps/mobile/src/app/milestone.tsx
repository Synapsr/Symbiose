import { MILESTONE_STEPS, type MilestoneFamily } from '@symbiose/shared';
import { useLocalSearchParams } from 'expo-router';
import { Share2, Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GRADIENTS, ShareCard } from '@/components/progress/share-card';
import { Button, Glow, Row, Txt } from '@/components/ui';
import { Burst, Confetti } from '@/components/ui/celebration';
import { useI18n, type PluralKey, type TranslationKey } from '@/i18n';
import { feedback } from '@/lib/feedback';
import { FANFARE_BEATS } from '@/lib/feedback-logic';
import { useToday } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useProgress } from '@/lib/progress';
import { CAPTURE, shareCardImage } from '@/lib/share-image';
import { useToast } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

/** The screen's own fade comes first: the moment starts once it is in front. */
const START_MS = 250;
const LAND = START_MS + FANFARE_BEATS.land;

/** `streak.7` → its family and step, only for the steps that exist. */
function parse(id: string | undefined): { family: MilestoneFamily; value: number } | null {
  const [family, raw] = (id ?? '').split('.');
  const value = Number(raw);
  if (!family || !(family in MILESTONE_STEPS)) return null;
  return MILESTONE_STEPS[family as MilestoneFamily].includes(value) ? { family: family as MilestoneFamily, value } : null;
}

/** A band of light crossing the card once it has landed, like a new card caught by the light. */
function Shine({ width, height }: { width: number; height: number }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    // One pass as it lands, then one every few seconds: across, back out of sight, a pause.
    const pass = withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) });
    x.set(withDelay(LAND + 180, withRepeat(withSequence(pass, withTiming(-1, { duration: 0 }), withDelay(3500, withTiming(-1, { duration: 0 }))), -1)));
  }, [x]);
  const band = width * 0.55;
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (width + band) }, { rotate: '18deg' }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -height * 0.25, left: (width - band) / 2, width: band, height: height * 1.5 }, style]}>
      <Svg width={band} height={height * 1.5}>
        <Defs>
          <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.38} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={band} height={height * 1.5} fill="url(#shine)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * A milestone, full screen: the card that can be shared, what it counts, a
 * line about what it means. With `celebrate`, it was just reached and it is
 * an event: the card flies in and lands on the full chord of the fanfare,
 * confetti in its colours, a halo, a band of light across it, a haptic on
 * every note. From « Ta progression », the same card, quietly.
 */
export default function MilestoneScreen() {
  const { id, celebrate } = useLocalSearchParams<{ id?: string; celebrate?: string }>();
  const { t, plural, locale } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const today = useToday();
  const showToast = useToast((s) => s.show);
  const progress = useProgress().data;
  const capture = useRef<Svg>(null);
  const [sharing, setSharing] = useState(false);
  const [landed, setLanded] = useState(false);
  const milestone = parse(id);
  const live = celebrate === '1';

  const fly = useSharedValue(live ? 0 : 1);
  const halo = useSharedValue(live ? 0 : 1);
  useEffect(() => {
    if (!live) return;
    const timers = [setTimeout(() => feedback.milestoneReached(), START_MS), setTimeout(() => setLanded(true), LAND)];
    // Thrown from below, it lands on the chord, a little past its size, and settles.
    fly.set(withDelay(LAND - 260, withSpring(1, { damping: 11, stiffness: 120, mass: 0.9 })));
    halo.set(withDelay(LAND, withSequence(withTiming(1.15, { duration: 420, easing: Easing.out(Easing.cubic) }), withRepeat(withTiming(0.95, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true))));
    return () => timers.forEach(clearTimeout);
  }, [live, fly, halo]);
  const flyStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, fly.value * 2),
    transform: [{ translateY: (1 - fly.value) * 220 }, { scale: 0.7 + 0.3 * fly.value }, { rotate: `${(1 - fly.value) * -9}deg` }],
  }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, halo.value), transform: [{ scale: 0.4 + 0.6 * halo.value }] }));

  useEffect(() => {
    if (!milestone) dismiss();
  }, [milestone]);
  if (!milestone) return null;

  const { family, value } = milestone;
  const title = plural(`milestone.title.${family}` as PluralKey, value);
  const unit = plural(`progress.unit.${family}` as PluralKey, value);
  const reachedAt = progress?.reached.find((m) => m.id === id)?.reachedAt ?? today;
  const date = new Date(`${reachedAt}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  // The card takes what the screen leaves around the words and buttons.
  const cardWidth = Math.min(width - Space.xxxl * 2, (height - insets.top - insets.bottom - 370) * 0.8, 340);
  const cardHeight = (cardWidth * 1350) / 1080;
  const [from, to] = GRADIENTS[family];
  const confetti = [from, to, '#FFFFFF', '#FFD066', from];

  const share = async () => {
    const message = t('milestone.shareText', { title });
    setSharing(true);
    try {
      await shareCardImage(capture.current, { name: `symbiose-${family}-${value}`, title: t('milestone.shareTitle'), message });
    } catch {
      // No image (an older build, a browser without it): the words alone.
      await Share.share({ message }).catch(() => showToast({ message: t('milestone.shareFailed') }));
    } finally {
      setSharing(false);
    }
  };

  // Each part comes in on its beat after the card has landed.
  const after = (ms: number) => (live ? FadeInDown.delay(LAND + ms).duration(380) : undefined);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + Space.xl, paddingBottom: insets.bottom + Space.lg, paddingHorizontal: Space.xl, alignItems: 'center', justifyContent: 'center', gap: Space.xl }}>
      {/* The card as it is shared, laid out at the image's own size (`CAPTURE`), out of sight. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: -CAPTURE.width - width }}>
        <ShareCard ref={capture} family={family} value={value} unit={unit} date={date} width={CAPTURE.width} />
      </View>

      {live ? (
        <Animated.View entering={ZoomIn.delay(LAND + 60).springify().damping(18).stiffness(220)}>
          <Row gap={6} style={{ backgroundColor: colors.warningSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: Space.md }}>
            <Sparkles size={14} color={colors.warning} fill={colors.warning} />
            <Txt variant="label" color={colors.warning} style={{ fontWeight: '700' }}>
              {t('milestone.new')}
            </Txt>
          </Row>
        </Animated.View>
      ) : null}

      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, haloStyle]}>
          <Glow color={to} size={cardWidth * 2.2} opacity={0.5} />
        </Animated.View>
        {/* The shadow outside, the rounded clip inside: one view can't do both on iOS. */}
        <Animated.View style={[{ borderRadius: 24, boxShadow: '0 18px 40px rgba(0,0,0,0.18)' }, flyStyle]}>
          <View style={{ borderRadius: 24, overflow: 'hidden' }}>
            <ShareCard family={family} value={value} unit={unit} date={date} width={cardWidth} />
            {live ? <Shine width={cardWidth} height={cardHeight} /> : null}
          </View>
        </Animated.View>
        {landed ? (
          <>
            <Burst spread={2.3} colors={confetti} />
            <Confetti colors={confetti} />
          </>
        ) : null}
      </View>

      <Animated.View entering={after(220)} style={{ alignItems: 'center', gap: 6, maxWidth: 420 }}>
        <Txt variant="title" style={{ textAlign: 'center' }}>
          {title}
        </Txt>
        <Txt variant="accent" tone="secondary" style={{ fontSize: 19, lineHeight: 25, textAlign: 'center' }}>
          {t(`milestone.line.${family}.${value}` as TranslationKey)}
        </Txt>
      </Animated.View>

      <Animated.View entering={live ? FadeIn.delay(LAND + 520).duration(300) : undefined} style={{ alignSelf: 'stretch', alignItems: 'center', gap: Space.xs }}>
        <Button title={t('milestone.share')} icon={<Share2 size={18} color={colors.onInverted} />} loading={sharing} onPress={() => void share()} style={{ alignSelf: 'stretch', maxWidth: 420 }} />
        <Button title={t('milestone.continue')} variant="ghost" onPress={dismiss} style={{ alignSelf: 'stretch', maxWidth: 420 }} />
      </Animated.View>
    </View>
  );
}
