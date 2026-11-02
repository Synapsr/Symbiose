import { Mic } from 'lucide-react-native';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useI18n } from '@/i18n';
import type { Dictation } from '@/lib/dictation';
import { useTheme, type Palette } from '@/theme';

import { Pressy } from './index';

const SWAP = { duration: 300, easing: Easing.bezier(0.2, 0, 0, 1) };
/** Each bar's share of the voice, and its place in the idle sway. */
const BARS = [0.55, 1, 0.8, 0.45];
const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' } as const;

/**
 * The microphone of a text field. Tapped, it fills with the accent and its
 * icon turns into four bars that move with the voice, inside a halo that
 * swells as the person speaks and a ring that keeps breathing out, so it
 * looks alive before the first word. Hidden where dictation isn't available.
 */
/**
 * `tint` colours the resting icon, for fields on a dark camera screen, and `palette` the accent
 * (`NIGHT` on the always-dark camera). `glyph`: the icon's size, half the button's by default.
 */
export function MicButton({
  dictation,
  size = 40,
  glyph,
  tint,
  palette,
  label,
  style,
}: {
  dictation: Dictation;
  size?: number;
  glyph?: number;
  tint?: string;
  palette?: Palette;
  /** What a screen reader says at rest, « Dicter » by default. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const colors = palette ?? theme.colors;
  const reduced = useReducedMotion();
  const { listening, level } = dictation;
  const on = useSharedValue(listening ? 1 : 0);
  const breath = useSharedValue(0);
  const sway = useSharedValue(0);

  useEffect(() => {
    on.set(withTiming(listening ? 1 : 0, SWAP));
    if (listening && !reduced) {
      breath.set(0);
      breath.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false));
      sway.set(0);
      sway.set(withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(breath);
      cancelAnimation(sway);
      breath.set(withTiming(0, { duration: 200 }));
    }
  }, [listening, reduced, on, breath, sway]);

  const halo = useAnimatedStyle(() => ({
    opacity: on.value * (0.16 + 0.14 * level.value),
    transform: [{ scale: 1 + 0.45 * level.value * on.value }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: on.value * 0.4 * (1 - breath.value),
    transform: [{ scale: 1 + 0.75 * breath.value }],
  }));
  const disc = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.55 + 0.45 * on.value }] }));
  const idle = useAnimatedStyle(() => ({ opacity: 1 - on.value, transform: [{ scale: 1 - 0.75 * on.value }] }));
  const live = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.25 + 0.75 * on.value }] }));

  if (!dictation.available) return null;
  const round = { width: size, height: size, borderRadius: size / 2 };
  const barHeight = Math.round(size * 0.45);
  return (
    <Pressy
      haptic={false}
      onPress={dictation.toggle}
      accessibilityRole="button"
      accessibilityLabel={listening ? t('dictation.stop') : (label ?? t('dictation.start'))}
      accessibilityState={{ selected: listening }}
      hitSlop={6}
      style={[round, style]}>
      <Animated.View pointerEvents="none" style={[fill, round, { backgroundColor: colors.accent }, halo]} />
      <Animated.View pointerEvents="none" style={[fill, round, { borderWidth: 1.5, borderColor: colors.accent }, ring]} />
      <Animated.View pointerEvents="none" style={[fill, round, { backgroundColor: colors.accent }, disc]} />
      <Animated.View pointerEvents="none" style={[fill, idle]}>
        <Mic size={glyph ?? Math.round(size * 0.5)} color={tint ?? colors.text2} strokeWidth={2} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[fill, { flexDirection: 'row', gap: 2.5 }, live]}>
        {BARS.map((share, i) => (
          <Bar key={i} index={i} share={share} level={level} sway={sway} height={barHeight} color={colors.onAccent} />
        ))}
      </Animated.View>
    </Pressy>
  );
}

function Bar({ index, share, level, sway, height, color }: { index: number; share: number; level: SharedValue<number>; sway: SharedValue<number>; height: number; color: string }) {
  const style = useAnimatedStyle(() => {
    // A gentle sway while waiting, the voice on top of it once there is one.
    const wave = Math.sin((sway.value + index * 0.22) * Math.PI * 2);
    const amount = 0.36 + 0.16 * wave + 0.64 * share * level.value;
    return { transform: [{ scaleY: Math.min(Math.max(amount, 0.2), 1) }] };
  });
  return <Animated.View style={[{ width: 3, height, borderRadius: 1.5, backgroundColor: color }, style]} />;
}

