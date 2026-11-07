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

function Particle({ angle, distance, size, color, spread = 1 }: Omit<(typeof PARTICLES)[number], 'color'> & { color: string; spread?: number }) {
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

/** The particles alone, bursting from the centre of their parent; `spread` sends them further, around something bigger than an emoji, and `colors` gives them a moment's own. */
export function Burst({ spread = 1, colors }: { spread?: number; colors?: readonly string[] }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 1, height: 1 }}>
      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} color={colors ? colors[i % colors.length]! : p.color} spread={spread} />
      ))}
    </View>
  );
}

/** A repeatable pseudo-random number in [0, 1): the confetti fall the same way every time, and render purely. */
const hash = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const PIECES = Array.from({ length: 42 }, (_, i) => ({
  vx: (hash(i, 1) * 2 - 1) * 540,
  vy: -(800 + hash(i, 2) * 650),
  spin: (hash(i, 3) * 2 - 1) * 560,
  flip: 5 + hash(i, 4) * 9,
  width: 7 + hash(i, 5) * 4,
  height: 10 + hash(i, 6) * 7,
  round: hash(i, 7) < 0.25,
  delay: Math.round(hash(i, 8) * 160),
  duration: 3000 + Math.round(hash(i, 9) * 600),
}));

/** Air drag (1/s) and gravity (px/s²): thrown up fast, the pieces slow, then drift down at about 1 000 px/s. */
const DRAG = 1.2;
const GRAVITY = 1250;

function Piece({ vx, vy, spin, flip, width, height, round, delay, duration, color }: (typeof PIECES)[number] & { color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(delay, withTiming(1, { duration, easing: Easing.linear })));
  }, [t, delay, duration]);
  const style = useAnimatedStyle(() => {
    const s = (t.value * duration) / 1000;
    const drift = (1 - Math.exp(-DRAG * s)) / DRAG;
    return {
      opacity: t.value === 0 ? 0 : t.value > 0.85 ? (1 - t.value) / 0.15 : 1,
      transform: [
        { translateX: vx * drift },
        { translateY: vy * drift + (GRAVITY / DRAG) * (s - drift) },
        { rotate: `${spin * s}deg` },
        // A paper turning over as it falls.
        { scaleY: Math.cos(flip * s) },
      ],
    };
  });
  return <Animated.View style={[{ position: 'absolute', width, height: round ? width : height, borderRadius: round ? width / 2 : 2, backgroundColor: color }, style]} />;
}

/** Confetti thrown up from the centre of their parent, falling with air and gravity, in the moment's `colors`. Once. */
export function Confetti({ colors }: { colors: readonly string[] }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 1, height: 1 }}>
      {PIECES.map((p, i) => (
        <Piece key={i} {...p} color={colors[i % colors.length]!} />
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
