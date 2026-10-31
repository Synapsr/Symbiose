import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { BOURGEON, bourgeonPath } from '@/components/ui/bourgeon-path';
import { useTheme } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const { c1x, c1y, r1, c2x, c2y, r2, rf } = BOURGEON;
const INK = { light: ['#0E1012', '#3A4048'], dark: ['#B9BEC4', '#F5F5F3'] } as const;
const BUD = { light: ['#D9FFEE', '#4BE0A6', '#12A27A'], dark: ['#F0FFF7', '#6FF2BE', '#1DBF8A'] } as const;
const HALO = { light: '#4BE0A6', dark: '#6FF2BE' } as const;

/**
 * The geometry shared with the native splash (assets/images/splash-icon*.png draw this
 * component's first frame): a 120 pt box centred on the screen, 95.5 units wide, centred
 * on the cell. The overlay draws a box twice as big around the same centre, so the mark
 * has room to grow and glow, at exactly the same scale.
 */
export const SPLASH = { box: 120, units: 95.5, seed: 0.18, seedHalo: 0.9, haloScale: 2 } as const;
const PPU = SPLASH.box / SPLASH.units;
const SIZE = SPLASH.box * 2;
const VIEW = `${c1x - SPLASH.units} ${c1y - SPLASH.units} ${SPLASH.units * 2} ${SPLASH.units * 2}`;
/** As the bud grows up-right, the cell drifts down-left so the finished mark sits centred. */
const DRIFT = { x: (c1x - (16.5 + 85) / 2) * PPU, y: (c1y - (16 + 84.5) / 2) * PPU };

function budRadius(b: number) {
  'worklet';
  return r2 * (0.45 + 0.55 * Math.min(b, 1.08));
}

/** Once per JS lifetime: a cold start, never a return from the background. */
let played = false;

/**
 * The arrival, on a cold start (iOS). The native splash shows a seed: the ink cell with
 * its mint light glowing inside. This overlay takes over with the very same picture, then
 * the light travels out as the neck stretches, settles into the bud with a soft glow, and
 * the overlay fades away over the app. About 1.2 s; a tap skips it. Reduced motion: no
 * overlay, the native splash simply fades.
 */
export function Arrival({ ready }: { ready: boolean }) {
  const reduced = useReducedMotion();
  const [active] = useState(() => !played && Platform.OS === 'ios' && !reduced);
  const [gone, setGone] = useState(false);
  if (!active) return <SplashFade />;
  if (gone) return null;
  return (
    <Birth
      ready={ready}
      onDone={() => {
        played = true;
        setGone(true);
      }}
    />
  );
}

/** Without the overlay, the splash fades out (iOS) when the app is ready. */
function SplashFade() {
  useEffect(() => {
    SplashScreen.setOptions({ fade: true, duration: 300 });
  }, []);
  return null;
}

function Birth({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { scheme, colors } = useTheme();
  const tone = scheme === 'dark' ? 'dark' : 'light';
  const { width, height } = useWindowDimensions();
  // The seed: the light already leans towards where the bud will be born.
  const bud = useSharedValue<number>(SPLASH.seed);
  const glow = useSharedValue(0);
  const leave = useSharedValue(0);
  const started = useSharedValue(false);

  useEffect(() => {
    // Once: later renders of the app underneath must not restart it.
    if (!ready || started.get()) return;
    started.set(true);
    // The light travels out (critically damped, barely any overshoot)…
    bud.set(withDelay(80, withSpring(1, { stiffness: 121, damping: 18, mass: 1 })));
    // …settles into the bud with one soft pulse of glow…
    glow.set(withDelay(560, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) })));
    // …then the overlay fades over the app, the mark lifting a little as it goes.
    leave.set(withDelay(820, withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }, (finished) => finished && scheduleOnRN(onDone))));
  }, [ready, started, bud, glow, leave, onDone]);

  const skip = () => {
    if (!ready) return;
    leave.set(withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }, (finished) => finished && scheduleOnRN(onDone)));
  };

  // The bud as in the Logo's mount: it starts inside the cell, and the neck forms as it crosses the edge.
  const bodyProps = useAnimatedProps(() => {
    const b = bud.value;
    return { d: bourgeonPath(c1x, c1y, r1, c1x + (c2x - c1x) * b, c1y + (c2y - c1y) * b, budRadius(b), rf) };
  });
  const budProps = useAnimatedProps(() => {
    const b = bud.value;
    return { cx: c1x + (c2x - c1x) * b, cy: c1y + (c2y - c1y) * b, r: budRadius(b) };
  });
  const haloProps = useAnimatedProps(() => {
    const b = bud.value;
    const g = glow.value;
    return { cx: c1x + (c2x - c1x) * b, cy: c1y + (c2y - c1y) * b, r: budRadius(b) * (SPLASH.haloScale + 0.9 * g), opacity: SPLASH.seedHalo * (1 - g) };
  });
  // The mark lifts and dissolves first, then the cream dissolves into the app: no ghost over the content.
  const backdrop = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, (leave.value - 0.4) / 0.6)) }));
  const mark = useAnimatedStyle(() => {
    const p = Math.min(1, (bud.value - SPLASH.seed) / (1 - SPLASH.seed));
    return {
      opacity: 1 - Math.min(1, leave.value / 0.4),
      transform: [{ translateX: DRIFT.x * p }, { translateY: DRIFT.y * p }, { scale: 1 + 0.3 * leave.value }],
    };
  });

  return (
    <Pressable
      onPress={skip}
      accessible={false}
      // The native splash goes as soon as the same picture is on screen underneath it.
      onLayout={() => requestAnimationFrame(() => SplashScreen.hide())}
      style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, backdrop]} />
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (width - SIZE) / 2, top: (height - SIZE) / 2, width: SIZE, height: SIZE }, mark]}>
        <Svg width={SIZE} height={SIZE} viewBox={VIEW}>
          <Defs>
            <LinearGradient id="arrival-ink" gradientUnits="userSpaceOnUse" x1="27" y1="80" x2="78" y2="21">
              <Stop offset={0} stopColor={INK[tone][0]} />
              <Stop offset={1} stopColor={INK[tone][1]} />
            </LinearGradient>
            <RadialGradient id="arrival-bud" cx="0.38" cy="0.34" r="0.72">
              {BUD[tone].map((color, i) => (
                <Stop key={color} offset={[0, 0.55, 1][i]} stopColor={color} />
              ))}
            </RadialGradient>
            <RadialGradient id="arrival-halo" cx="0.5" cy="0.5" r="0.5">
              <Stop offset={0} stopColor={HALO[tone]} stopOpacity={0.55} />
              <Stop offset={1} stopColor={HALO[tone]} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="arrival-sheen" cx="0.5" cy="0.5" r="0.5">
              <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.22} />
              <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <AnimatedPath animatedProps={bodyProps} fill="url(#arrival-ink)" />
          {tone === 'light' ? <Circle cx={36} cy={51} r={13} fill="url(#arrival-sheen)" /> : null}
          <AnimatedCircle animatedProps={haloProps} fill="url(#arrival-halo)" />
          <AnimatedCircle animatedProps={budProps} fill="url(#arrival-bud)" />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}
