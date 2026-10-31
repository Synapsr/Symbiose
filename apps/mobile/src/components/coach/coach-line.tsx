import { router, useIsFocused } from 'expo-router';
import { ChevronRight, Sparkle } from 'lucide-react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Pressy, Row, Txt } from '@/components/ui';
import { useI18n } from '@/i18n';
import { claimReward, feedback } from '@/lib/feedback';
import { formatClockTime } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { useToday } from '@/lib/hooks';
import { markMorningSeen, useAnswerOffer, useProactiveLine } from '@/lib/proactive';
import type { ProactiveLine } from '@/lib/proactive-plan';
import { Radius, Space, useTheme } from '@/theme';

/** The day line's look, kept for the proactive sentence that takes its place. */
const VOICE = { fontSize: 19, lineHeight: 26 } as const;
const SWIPE_AWAY = 90;

/**
 * Today's one coach sentence. Usually the day line; today, the proactive
 * coach may take the slot: the craving heads-up near the usual time, the
 * morning check-in until noon, the Monday review, or an offer. Swipe it
 * away for the day; tap it to answer the coach. A `celebrate`d day line (a
 * good day recognised) plays its note once it has been on screen a moment.
 */
export function CoachLine({ date, fallback, celebrate = false }: { date: string; fallback: string; celebrate?: boolean }) {
  const { line, nudge, dismiss } = useProactiveLine(date);
  const focused = useIsFocused();
  const shown = celebrate && focused && !line;
  useEffect(() => {
    if (!shown) return;
    // A proactive line may still take the slot: only a sentence that stays gets its note.
    const timer = setTimeout(() => claimReward(date, 'goodDay') && feedback.goodDay(), 900);
    return () => clearTimeout(timer);
  }, [shown, date]);
  if (!line) {
    return (
      <Txt variant="accent" tone="secondary" style={[VOICE, { paddingHorizontal: 6 }]}>
        {fallback}
      </Txt>
    );
  }
  return <Slot key={line.kind} line={line} nudge={nudge} onDismiss={() => dismiss(line.kind)} />;
}

/** The check-in's tip, its last line: the night already shows under the greeting, the rest is one tap away. */
const morningTip = (text: string) => text.split('\n').filter((l) => l.trim()).at(-1) ?? text;

/** "15:55" → "16:00": « vers 16 h ». */
const nearestHour = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return `${String((h + (m >= 30 ? 1 : 0)) % 24).padStart(2, '0')}:00`;
};

function Slot({ line, nudge, onDismiss }: { line: ProactiveLine; nudge: string | null; onDismiss: () => void }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const today = useToday();
  const answer = useAnswerOffer();

  // Read on Today: the morning notification isn't needed any more.
  const read = line.kind === 'morning' && !line.writing && Boolean(line.text);
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && read) markMorningSeen(today);
  }, [focused, read, today]);

  const x = useSharedValue(0);
  const buzz = () => haptics.soft();
  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      x.set(e.translationX);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_AWAY || Math.abs(e.velocityX) > 900) {
        const to = Math.sign(e.translationX || e.velocityX) * 420;
        x.set(
          withTiming(to, { duration: 200, easing: Easing.out(Easing.quad) }, (done) => {
            if (done) scheduleOnRN(onDismiss);
          }),
        );
        scheduleOnRN(buzz);
      } else {
        x.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
      }
    });
  const swiped = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], opacity: 1 - Math.min(Math.abs(x.value) / 260, 0.8) }));

  const text = (() => {
    switch (line.kind) {
      case 'morning':
        return line.text && !line.writing ? morningTip(line.text) : t('proactive.line.writing');
      case 'weekly':
        return t('proactive.line.weekly');
      case 'cravings':
        return nudge ?? t('proactive.line.cravings', { time: formatClockTime(line.start, locale) });
      case 'offer':
        return line.offer === 'morning' ? t('proactive.line.offerMorning') : t('proactive.line.offerCravings', { time: formatClockTime(nearestHour(line.start ?? '16:00'), locale) });
    }
  })();

  const open =
    line.kind === 'morning'
      ? () => {
          markMorningSeen(today);
          router.navigate({ pathname: '/coach', params: line.messageId ? { message: line.messageId } : {} });
        }
      : line.kind === 'weekly'
        ? () => router.navigate('/insights')
        : undefined;

  const sentence = (
    <Row gap={Space.sm} style={{ alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 5 }}>
        <Spark writing={line.kind === 'morning' && line.writing} />
      </View>
      <Txt variant="accent" style={[VOICE, { flex: 1 }]} numberOfLines={3}>
        {text}
        {open ? <ChevronRight size={16} color={colors.text3} style={{ marginLeft: 2, transform: [{ translateY: 2 }] }} /> : null}
      </Txt>
    </Row>
  );

  // Swiping has a spoken twin: « Masquer » among the sentence's actions.
  const a11y = {
    accessibilityLabel: text,
    accessibilityActions: [{ name: 'dismiss', label: t('proactive.hide') }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => e.nativeEvent.actionName === 'dismiss' && onDismiss(),
  };
  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={FadeIn.duration(260)}>
        <Animated.View style={[{ paddingHorizontal: 6, gap: Space.md }, swiped]}>
          {open ? (
            <Pressy onPress={open} accessibilityRole="button" {...a11y}>
              {sentence}
            </Pressy>
          ) : (
            <View accessible {...a11y}>
              {sentence}
            </View>
          )}
          {line.kind === 'cravings' ? (
            <Actions
              primary={{ label: t('proactive.notif.cravingAction'), onPress: () => router.push('/craving') }}
              secondary={{
                label: t('proactive.notif.fineAction'),
                onPress: () => {
                  haptics.soft();
                  onDismiss();
                },
              }}
            />
          ) : line.kind === 'offer' ? (
            <Actions primary={{ label: t('proactive.yes'), onPress: () => answer(line.offer, true) }} secondary={{ label: t('proactive.no'), onPress: () => answer(line.offer, false) }} />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** ✦ in the accent colour; it breathes while the check-in is being written. */
function Spark({ writing }: { writing: boolean }) {
  const { colors } = useTheme();
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(writing ? withRepeat(withTiming(0.3, { duration: 700 }), -1, true) : withTiming(1));
  }, [writing, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={style}>
      <Sparkle size={15} color={colors.accent} fill={colors.accent} />
    </Animated.View>
  );
}

type Action = { label: string; onPress: () => void };

function Actions({ primary, secondary }: { primary: Action; secondary: Action }) {
  const { colors } = useTheme();
  const pill = { height: 36, paddingHorizontal: Space.lg, borderRadius: Radius.pill, justifyContent: 'center' } as const;
  return (
    <Row gap={Space.sm} style={{ paddingLeft: 23 }}>
      <Pressy onPress={primary.onPress} accessibilityRole="button" style={[pill, { backgroundColor: colors.accent }]}>
        <Txt variant="label" color={colors.onAccent}>
          {primary.label}
        </Txt>
      </Pressy>
      <Pressy onPress={secondary.onPress} accessibilityRole="button" style={[pill, { backgroundColor: colors.surface2 }]}>
        <Txt variant="label">{secondary.label}</Txt>
      </Pressy>
    </Row>
  );
}
