import { useEffect } from 'react';
import Animated, { Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { BOURGEON, bourgeonPath } from '@/components/ui/bourgeon-path';
import { useTheme } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Graphite: the body is the theme's ink (graphite on cream, silver on night), the bud is the only light. */
const INK = { light: ['#0E1012', '#3A4048'], dark: ['#B9BEC4', '#F5F5F3'] } as const;
const BUD = { light: ['#D9FFEE', '#4BE0A6', '#12A27A'], dark: ['#F0FFF7', '#6FF2BE', '#1DBF8A'] } as const;
const BUD_OFFSETS = [0, 0.55, 1];
/** Cell → bud, on the 45° diagonal. */
const UX = Math.SQRT1_2;
const UY = -Math.SQRT1_2;
const { c1x, c1y, r1, c2x, c2y, r2, rf } = BOURGEON;

/**
 * « Bourgeon »: a cell in ink and the bud of light that grows out of it. With
 * `animated`, the cell swells in and the light pushes out into the bud on a soft
 * spring. With `breathe`, the bud inhales and the neck thickens while the AI
 * thinks. Reduced motion: the mark is drawn at rest and only its opacity pulses.
 */
export function Logo({ size = 40, animated = false, breathe = false }: { size?: number; animated?: boolean; breathe?: boolean }) {
  const scheme = useTheme().scheme === 'dark' ? 'dark' : 'light';
  const reduced = useReducedMotion();
  const grow = useSharedValue(animated && !reduced ? 0 : 1);
  const bud = useSharedValue(animated && !reduced ? 0 : 1);
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!animated || reduced) return;
    grow.set(withSpring(1, { stiffness: 196, damping: 19.6, mass: 1 }));
    bud.set(withDelay(160, withSpring(1, { stiffness: 100, damping: 12, mass: 1 })));
  }, [animated, reduced, grow, bud]);

  // The breath keeps running under reduced motion (ReduceMotion.Never), where it only drives a soft opacity pulse.
  useEffect(() => {
    breath.set(
      breathe
        ? withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.Never }), -1, true, undefined, ReduceMotion.Never)
        : withTiming(0, { duration: 400, reduceMotion: ReduceMotion.Never }),
    );
  }, [breathe, breath]);

  const bodyProps = useAnimatedProps(() => {
    const g = grow.value;
    const b = bud.value;
    const s = reduced ? 0 : breath.value;
    return {
      d: bourgeonPath(
        c1x,
        c1y,
        r1 * (0.62 + 0.38 * g) - 0.6 * s,
        c1x + (c2x - c1x) * b + UX * 0.9 * s,
        c1y + (c2y - c1y) * b + UY * 0.9 * s,
        r2 * (0.45 + 0.55 * Math.min(b, 1.08)) + 1.5 * s,
        rf + 2.8 * s,
      ),
    };
  });
  // The light sits exactly on the bud of the path: it glows inside the cell first, then pushes out.
  const budProps = useAnimatedProps(() => {
    const b = bud.value;
    const s = reduced ? 0 : breath.value;
    return {
      cx: c1x + (c2x - c1x) * b + UX * 0.9 * s,
      cy: c1y + (c2y - c1y) * b + UY * 0.9 * s,
      r: r2 * (0.45 + 0.55 * Math.min(b, 1.08)) + 1.5 * s,
    };
  });
  // The sheen follows the cell, so it never shows outside it while the cell swells in.
  const sheenProps = useAnimatedProps(() => ({ opacity: grow.value }));
  const pulse = useAnimatedStyle(() => ({ opacity: reduced ? 1 - 0.25 * breath.value : 1 }));

  const ink = `graphite-ink-${scheme}`;
  const light = `graphite-bud-${scheme}`;
  return (
    <Animated.View style={[{ width: size, height: size }, pulse]}>
      {/* 4 units of margin all round, so the bud's overshoot on mount is never clipped. */}
      <Svg width={size} height={size} viewBox="12.5 12 76.5 76.5">
        <Defs>
          <LinearGradient id={ink} gradientUnits="userSpaceOnUse" x1="27" y1="80" x2="78" y2="21">
            <Stop offset={0} stopColor={INK[scheme][0]} />
            <Stop offset={1} stopColor={INK[scheme][1]} />
          </LinearGradient>
          <RadialGradient id={light} cx="0.38" cy="0.34" r="0.72">
            {BUD[scheme].map((color, i) => (
              <Stop key={color} offset={BUD_OFFSETS[i]} stopColor={color} />
            ))}
          </RadialGradient>
          <RadialGradient id="graphite-sheen" cx="0.5" cy="0.5" r="0.5">
            <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <AnimatedPath animatedProps={bodyProps} fill={`url(#${ink})`} />
        {scheme === 'light' ? <AnimatedCircle cx={36} cy={51} r={13} fill="url(#graphite-sheen)" animatedProps={sheenProps} /> : null}
        <AnimatedCircle animatedProps={budProps} fill={`url(#${light})`} />
      </Svg>
    </Animated.View>
  );
}
