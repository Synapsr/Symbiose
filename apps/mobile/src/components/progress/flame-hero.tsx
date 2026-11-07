import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { Glow, Txt } from '@/components/ui';
import { Burst } from '@/components/ui/celebration';
import { haptics } from '@/lib/haptics';

/** The flame's own colours, from its core to its edge: its sparks and embers take them too. */
export const EMBER_COLORS = ['#FFF1C4', '#FFD066', '#FFB547', '#FF8A3D', '#F2652A'];

// A 100 × 120 flame: a main tongue and a smaller lick on its left, the inner flame inside it, a bright core at the base.
const OUTER = 'M50 2C62 24 88 42 88 74C88 99 71 118 50 118C29 118 12 99 12 74C12 56 22 44 30 34C31 46 35 54 42 58C40 38 42 20 50 2Z';
const INNER = 'M52 44C60 58 73 70 73 88C73 104 63 113 50 113C37 113 27 104 27 90C27 78 35 70 41 64C42 72 45 77 50 79C48 66 49 55 52 44Z';

const EMBERS = Array.from({ length: 12 }, (_, i) => ({
  x: ((i * 37) % 56) - 28,
  rise: 110 + ((i * 53) % 80),
  sway: 5 + ((i * 29) % 9),
  size: 3 + (i % 3) * 1.5,
  duration: 1300 + ((i * 211) % 900),
  delay: (i * 170) % 1100,
  color: EMBER_COLORS[i % EMBER_COLORS.length]!,
}));

/** An ember: rises from inside the flame, sways, shrinks and fades, again and again. */
function Ember({ x, rise, sway, size, duration, delay, color, startAt }: (typeof EMBERS)[number] & { startAt: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(startAt + delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false)));
  }, [p, startAt, delay, duration]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value === 0 ? 0 : p.value < 0.15 ? p.value / 0.15 : 1 - (p.value - 0.15) / 0.85,
    transform: [{ translateX: x + Math.sin(p.value * Math.PI * 2 + x) * sway }, { translateY: -p.value * rise }, { scale: 1 - 0.6 * p.value }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, boxShadow: `0 0 6px ${color}` }, style]} />;
}

/**
 * The flame, alive: a spark that gathers, then catches at `igniteAt` (ms after
 * mount) with a burst of sparks and a warm halo, and keeps flickering, its
 * embers rising. A tap fans it. The day's first meal makes it grow (`/streak`).
 */
export function FlameHero({ size = 150, igniteAt = 0 }: { size?: number; igniteAt?: number }) {
  const height = size * 1.2;
  const spark = useSharedValue(0);
  const grow = useSharedValue(0);
  const flicker = useSharedValue(0);
  const lick = useSharedValue(0);
  const fan = useSharedValue(1);
  const [caught, setCaught] = useState(false);

  useEffect(() => {
    spark.set(withTiming(1, { duration: igniteAt, easing: Easing.in(Easing.quad) }));
    // Under-damped: it flares past its size as it catches, then settles.
    grow.set(withDelay(igniteAt, withSpring(1, { damping: 11.5, stiffness: 170, mass: 0.9 })));
    flicker.set(withDelay(igniteAt + 200, withRepeat(withTiming(1, { duration: 430, easing: Easing.inOut(Easing.sin) }), -1, true)));
    lick.set(withDelay(igniteAt + 290, withRepeat(withTiming(1, { duration: 310, easing: Easing.inOut(Easing.sin) }), -1, true)));
    const timer = setTimeout(() => setCaught(true), igniteAt);
    return () => clearTimeout(timer);
  }, [spark, grow, flicker, lick, igniteAt]);

  const outer = useAnimatedStyle(() => ({
    opacity: Math.min(1, grow.value * 3),
    transform: [{ scaleX: grow.value * fan.value * (1 - 0.03 * flicker.value) }, { scaleY: grow.value * fan.value * (1 + 0.05 * flicker.value) }, { rotate: `${(flicker.value - 0.5) * 3}deg` }],
  }));
  const inner = useAnimatedStyle(() => ({
    opacity: Math.min(1, grow.value * 2),
    transform: [{ scaleX: grow.value * (1 - 0.05 * lick.value) }, { scaleY: grow.value * fan.value * (1 + 0.09 * lick.value) }],
  }));
  const ember = useAnimatedStyle(() => ({
    opacity: spark.value * (1 - Math.min(1, grow.value * 2.5)),
    transform: [{ scale: 0.2 + spark.value * 0.8 }],
  }));
  const halo = useAnimatedStyle(() => ({
    opacity: Math.min(1, grow.value),
    transform: [{ scale: 0.35 + 0.65 * Math.min(grow.value, 1.15) + 0.06 * flicker.value }],
  }));

  const fanIt = () => {
    haptics.soft();
    fan.set(withSequence(withTiming(1.14, { duration: 110, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 11, stiffness: 160 })));
  };

  return (
    <Pressable onPress={fanIt} accessible={false} style={{ width: size * 2, height: height * 1.5, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, halo]}>
        <Glow color="#FF9A3D" size={size * 2.3} opacity={0.42} />
      </Animated.View>

      <View style={{ width: size, height, marginBottom: height * 0.18 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: 'center bottom' }, outer]}>
          <Svg width={size} height={height} viewBox="0 0 100 120">
            <Defs>
              <LinearGradient id="flameOuter" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFB547" />
                <Stop offset="0.55" stopColor="#FF7A2E" />
                <Stop offset="1" stopColor="#E8501A" />
              </LinearGradient>
            </Defs>
            <Path d={OUTER} fill="url(#flameOuter)" />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: 'center bottom' }, inner]}>
          <Svg width={size} height={height} viewBox="0 0 100 120">
            <Defs>
              <LinearGradient id="flameInner" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFE08A" />
                <Stop offset="1" stopColor="#FFB547" />
              </LinearGradient>
              <RadialGradient id="flameCore" cx="50%" cy="60%" r="50%">
                <Stop offset="0" stopColor="#FFFBEA" stopOpacity={1} />
                <Stop offset="0.55" stopColor="#FFF0C2" stopOpacity={0.75} />
                <Stop offset="1" stopColor="#FFE08A" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Path d={INNER} fill="url(#flameInner)" />
            {/* The hottest part, white at the base, melting into the inner flame. */}
            <Ellipse cx={50} cy={95} rx={17} ry={21} fill="url(#flameCore)" />
          </Svg>
        </Animated.View>

        {/* The spark that gathers before it catches, at the flame's base. */}
        <Animated.View style={[{ position: 'absolute', left: size / 2 - 9, top: height * 0.78, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFD066', boxShadow: '0 0 16px #FFB547' }, ember]} />

        <View pointerEvents="none" style={{ position: 'absolute', left: size / 2, top: height * 0.55 }}>
          {EMBERS.map((e, i) => (
            <Ember key={i} {...e} startAt={igniteAt} />
          ))}
        </View>
        {caught ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: size / 2, top: height * 0.6 }}>
            <Burst spread={1.4} colors={EMBER_COLORS} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A number that turns from `from` to `to` at `at` ms, like a counter's wheel:
 * the old one rises away, the new one comes up from below, then it pulses.
 */
export function RollingNumber({ from, to, at, fontSize = 92, color }: { from: number; to: number; at: number; fontSize?: number; color?: string }) {
  const p = useSharedValue(0);
  const pulse = useSharedValue(1);
  useEffect(() => {
    // A quick, firm turn that starts just ahead of the beat, so the new number is in place on the note.
    p.set(withDelay(Math.max(0, at - 50), withSpring(1, { damping: 17, stiffness: 280 })));
    pulse.set(withDelay(at + 20, withSequence(withTiming(1.12, { duration: 130, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 10, stiffness: 180 }))));
  }, [p, pulse, at]);
  const lineHeight = Math.round(fontSize * 1.12);
  const travel = lineHeight * 0.75;
  const leaving = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, p.value * 1.5), transform: [{ translateY: -p.value * travel }] }));
  const arriving = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.5), transform: [{ translateY: (1 - p.value) * travel }] }));
  const wrap = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const number = (n: number) => (
    <Txt variant="display" color={color} style={{ fontSize, lineHeight, textAlign: 'center', letterSpacing: -2 }}>
      {n}
    </Txt>
  );
  return (
    <Animated.View accessible accessibilityLabel={String(to)} style={[{ height: lineHeight, minWidth: fontSize * 2.6 }, wrap]}>
      <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }, leaving]}>{number(from)}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: 'center' }, arriving]}>{number(to)}</Animated.View>
    </Animated.View>
  );
}
