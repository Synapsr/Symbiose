import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { NUTRIENT_COLORS, useTheme } from '@/theme';

import { Txt } from './index';

const PALETTE = [NUTRIENT_COLORS.fiber, NUTRIENT_COLORS.protein, NUTRIENT_COLORS.carbs, NUTRIENT_COLORS.fat, NUTRIENT_COLORS.sugar, '#5FD6B4', '#3CC8FF'];
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  angle: (i / 18) * Math.PI * 2 + (i % 2 ? 0.12 : -0.08),
  distance: 110 + (i % 3) * 34,
  size: 8 + (i % 4) * 3,
  color: PALETTE[i % PALETTE.length]!,
}));

function Particle({ angle, distance, size, color, spread = 1 }: (typeof PARTICLES)[number] & { spread?: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value * t.value,
    transform: [{ translateX: Math.cos(angle) * distance * spread * t.value }, { translateY: Math.sin(angle) * distance * spread * t.value + 40 * t.value * t.value }, { scale: 1 - t.value * 0.4 }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** The particles alone, bursting from the centre of their parent; `spread` sends them further, around something bigger than an emoji. */
export function Burst({ spread = 1 }: { spread?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 1, height: 1 }}>
      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} spread={spread} />
      ))}
    </View>
  );
}

/** A small, joyful moment: particles burst around a popping emoji. */
export function Celebration({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  const { colors } = useTheme();
  const pop = useSharedValue(0.25);
  useEffect(() => {
    pop.set(withDelay(60, withSpring(1, { damping: 12, stiffness: 180 })));
  }, [pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: Math.min(1, pop.value * 1.5) }));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 20 }]}>
      <View style={{ alignItems: 'center', justifyContent: 'center', width: 1, height: 1 }}>
        {PARTICLES.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </View>
      <Animated.View style={popStyle}>
        <Txt style={{ fontSize: 88, lineHeight: 100 }}>{emoji}</Txt>
      </Animated.View>
      <Animated.View entering={FadeIn.delay(250).duration(300)} style={{ alignItems: 'center', gap: 6, paddingHorizontal: 32 }}>
        <Txt variant="title">{title}</Txt>
        <Txt variant="accent" tone="secondary" style={{ fontSize: 19, textAlign: 'center' }}>
          {subtitle}
        </Txt>
      </Animated.View>
    </Animated.View>
  );
}
