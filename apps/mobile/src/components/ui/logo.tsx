import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme';

/**
 * Two living things that meet: the circles glide together on mount, the core
 * appears. With `breathe`, the core pulses softly (the app is "thinking").
 */
export function Logo({ size = 40, animated = false, breathe = false }: { size?: number; animated?: boolean; breathe?: boolean }) {
  const { colors } = useTheme();
  const r = size * 0.275;
  const merge = useSharedValue(animated ? 0 : 1);
  const core = useSharedValue(animated ? 0 : 1);

  useEffect(() => {
    if (animated) {
      merge.set(withSpring(1, { damping: 14, stiffness: 90 }));
      core.set(withDelay(350, withSpring(1, { damping: 10, stiffness: 160 })));
    }
  }, [animated, merge, core]);
  useEffect(() => {
    if (breathe) core.set(withRepeat(withSequence(withTiming(0.6, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })), -1));
  }, [breathe, core]);

  const left = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - merge.value) * -size * 0.18 }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - merge.value) * size * 0.18 }] }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: core.value }] }));

  const circle = { position: 'absolute' as const, width: r * 2, height: r * 2, borderRadius: r, top: size / 2 - r };
  const coreSize = size * 0.26;
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[circle, { left: size * 0.375 - r, backgroundColor: colors.accent }, left]} />
      <Animated.View style={[circle, { left: size * 0.625 - r, backgroundColor: colors.text, opacity: 0.88 }, right]} />
      <Animated.View style={[{ position: 'absolute', width: coreSize, height: coreSize, borderRadius: coreSize / 2, left: size / 2 - coreSize / 2, top: size / 2 - coreSize / 2, backgroundColor: colors.bg }, dot]} />
    </View>
  );
}
