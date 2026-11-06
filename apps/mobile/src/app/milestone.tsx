import { MILESTONE_STEPS, type MilestoneFamily } from '@symbiose/shared';
import { useLocalSearchParams } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Share, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import type Svg from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShareCard } from '@/components/progress/share-card';
import { Button, Txt } from '@/components/ui';
import { Burst } from '@/components/ui/celebration';
import { useI18n, type PluralKey, type TranslationKey } from '@/i18n';
import { feedback } from '@/lib/feedback';
import { useToday } from '@/lib/hooks';
import { dismiss } from '@/lib/nav';
import { useProgress } from '@/lib/progress';
import { shareCardImage } from '@/lib/share-image';
import { useToast } from '@/lib/stores';
import { Space, useTheme } from '@/theme';

/** `streak.7` → its family and step, only for the steps that exist. */
function parse(id: string | undefined): { family: MilestoneFamily; value: number } | null {
  const [family, raw] = (id ?? '').split('.');
  const value = Number(raw);
  if (!family || !(family in MILESTONE_STEPS)) return null;
  return MILESTONE_STEPS[family as MilestoneFamily].includes(value) ? { family: family as MilestoneFamily, value } : null;
}

/**
 * A milestone, full screen: the card that can be shared, what it counts, a
 * line about what it means. With `celebrate`, it was just reached: particles,
 * and the bloom. From « Ta progression », the same card, quietly.
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
  const card = useRef<Svg>(null);
  const [sharing, setSharing] = useState(false);
  const milestone = parse(id);
  const live = celebrate === '1';

  const pop = useSharedValue(live ? 0.6 : 1);
  useEffect(() => {
    if (!live) return;
    feedback.milestone();
    pop.set(withDelay(60, withSpring(1, { damping: 12, stiffness: 160 })));
  }, [live, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

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
  const cardWidth = Math.min(width - Space.xxxl * 2, (height - insets.top - insets.bottom - 330) * 0.8, 340);

  const share = async () => {
    const message = t('milestone.shareText', { title });
    setSharing(true);
    try {
      await shareCardImage(card.current, { name: `symbiose-${family}-${value}`, title: t('milestone.shareTitle'), message });
    } catch {
      // No image (an older build, a browser without it): the words alone.
      await Share.share({ message }).catch(() => showToast({ message: t('milestone.shareFailed') }));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + Space.xl, paddingBottom: insets.bottom + Space.lg, paddingHorizontal: Space.xl, alignItems: 'center', justifyContent: 'center', gap: Space.xl }}>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        {live ? <Burst spread={2.3} /> : null}
        {/* The shadow outside, the rounded clip inside: one view can't do both on iOS. */}
        <Animated.View style={[{ borderRadius: 24, boxShadow: '0 18px 40px rgba(0,0,0,0.18)' }, popStyle]}>
          <View style={{ borderRadius: 24, overflow: 'hidden' }}>
            <ShareCard ref={card} family={family} value={value} unit={unit} date={date} width={cardWidth} />
          </View>
        </Animated.View>
      </View>

      <Animated.View entering={live ? FadeIn.delay(250).duration(300) : undefined} style={{ alignItems: 'center', gap: 6, maxWidth: 420 }}>
        <Txt variant="title" style={{ textAlign: 'center' }}>
          {title}
        </Txt>
        <Txt variant="accent" tone="secondary" style={{ fontSize: 19, lineHeight: 25, textAlign: 'center' }}>
          {t(`milestone.line.${family}.${value}` as TranslationKey)}
        </Txt>
      </Animated.View>

      <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: Space.xs }}>
        <Button title={t('milestone.share')} icon={<Share2 size={18} color={colors.onInverted} />} loading={sharing} onPress={() => void share()} style={{ alignSelf: 'stretch', maxWidth: 420 }} />
        <Button title={t('milestone.continue')} variant="ghost" onPress={dismiss} style={{ alignSelf: 'stretch', maxWidth: 420 }} />
      </View>
    </View>
  );
}
