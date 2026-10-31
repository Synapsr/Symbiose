import { useEffect } from 'react';
import Animated, { Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { BOURGEON, bourgeonPath } from '@/components/ui/bourgeon-path';
import { useTheme } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Emerald to acid lime, fixed in user space: as the bud grows out it travels into the lime and seems to ripen. */
const STOPS = {
  light: ['#00934A', '#0DC466', '#5BE65E', '#C2FF2E'],
  dark: ['#00B85C', '#1FE584', '#8DFF62', '#E2FF4D'],
} as const;
const OFFSETS = [0, 0.48, 0.76, 1];
/** Cell → bud, on the 45° diagonal. */
const UX = Math.SQRT1_2;
const UY = -Math.SQRT1_2;
const { c1x, c1y, r1, c2x, c2y, r2, rf } = BOURGEON;

/**
 * « Bourgeon »: a cell and the bud that grows out of it. With `animated`, the
 * cell swells in and the bud pushes out on a soft spring. With `breathe`, the
 * bud inhales and the neck thickens while the AI thinks. Reduced motion: the
 * mark is drawn at rest and only its opacity pulses.
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

  const animatedProps = useAnimatedProps(() => {
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
  const pulse = useAnimatedStyle(() => ({ opacity: reduced ? 1 - 0.25 * breath.value : 1 }));

  const id = `bourgeon-${scheme}`;
  return (
    <Animated.View style={[{ width: size, height: size }, pulse]}>
      {/* 4 units of margin all round, so the bud's overshoot on mount is never clipped. */}
      <Svg width={size} height={size} viewBox="12.5 12 76.5 76.5">
        <Defs>
          <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1="27" y1="80" x2="78" y2="21">
            {STOPS[scheme].map((color, i) => (
              <Stop key={color} offset={OFFSETS[i]} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <AnimatedPath animatedProps={animatedProps} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
